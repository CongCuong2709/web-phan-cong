/**
 * db.js — Database connection dùng `node:sqlite` (built-in từ Node 22.5+).
 *
 * Ưu điểm:
 *   - Zero native compilation (npm install không cần build tools)
 *   - API gầnme như better-sqlite3 — chỉ khác một vài chỗ:
 *       • `db.prepare(...)` trả về `StatementSync` (cũng có `.get/.all/.run`)
 *       • KHÔNG có `.pragma()` — dùng `db.exec('PRAGMA ...')` thay bằng raw SQL
 *       • Auto-foreign-key mặc định OFF trong mỗi connection — phải bật explicit
 *       • KHÔNG có `db.transaction(fn)` — tự quản bằng `db.exec('BEGIN')/COMMIT`/`ROLLBACK`
 *   - Sync API (giống better-sqlite3) — không blocking event loop vì native C++
 *
 * Cú pháp parameters:
 *   - Positional: .get(value1, value2)
 *   - Named:      .get({ key: value }) — KHÔNG có prefix @
 *
 * Lưu ý: nếu dùng Node < 22.5.0 thì phải set flag --experimental-sqlite.
 * Xem https://nodejs.org/api/sqlite.html
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');
const SCHEMA_PATH = path.join(__dirname, 'sql', 'schema.sql');

const isFreshDb = !fs.existsSync(DB_PATH);

export const db = new DatabaseSync(DB_PATH);

// PRAGMA qua raw SQL (node:sqlite không có method .pragma()).
// WAL cho phép concurrent read khi write.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/**
 * Bootstrap schema khi DB mới được tạo. Idempotent nhờ CREATE IF NOT EXISTS.
 */
if (isFreshDb) {
  console.log(`[db] Fresh database detected at ${DB_PATH}. Loading schema…`);
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  console.log('[db] Schema loaded.');
}

/**
 * Manual transaction wrapper. node:sqlite không có `db.transaction()` built-in.
 * Nếu `fn` throw, rollback. Ngược lại commit.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Statement cache. Mỗi statement được prepare 1 lần, gọi nhiều lần.
 * API .get/.all/.run tương tự better-sqlite3.
 */
export const stmt = {
  // --- Users ---
  getUserByUsername: db.prepare(
    'SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1'
  ),
  getUserById: db.prepare(
    'SELECT id, username, fullname, email, role, initial, avatar_url FROM users WHERE id = ? AND is_active = 1'
  ),
  listUsers: db.prepare(`
    SELECT u.id, u.username, u.fullname, u.email, u.role, u.initial, u.avatar_url,
      (SELECT GROUP_CONCAT(department_code, ',') FROM user_departments WHERE user_id = u.id) AS departments
    FROM users u WHERE u.is_active = 1 ORDER BY u.role, u.fullname
  `),
  getUserDepartments: db.prepare(
    'SELECT department_code FROM user_departments WHERE user_id = ?'
  ),

  // --- Sessions ---
  createSession: db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `),
  getSession: db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL'
  ),
  revokeSession: db.prepare(
    "UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?"
  ),

  // --- Tier items ---
  listTierItems: db.prepare(`
    SELECT t.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM tier_items t LEFT JOIN users u ON u.id = t.owner_user_id
    ORDER BY t.tier, t.code
  `),
  getTierItem: db.prepare(`
    SELECT t.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM tier_items t LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.id = ?
  `),
  getTierItemByCode: db.prepare('SELECT id FROM tier_items WHERE code = ?'),
  insertTierItem: db.prepare(`
    INSERT INTO tier_items (code, tier, title, parent_id, department_code,
      owner_user_id, deadline, progress, status, priority, description, management_notes,
      start_week, end_week, gantt_label, gantt_bar_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateTierItem: db.prepare(`
    UPDATE tier_items SET
      title = ?, progress = ?, status = ?, priority = ?,
      deadline = ?, description = ?, management_notes = ?,
      blocker_alert = ?, is_blocked = ?,
      start_week = ?, end_week = ?, gantt_label = ?, gantt_bar_color = ?
    WHERE id = ?
  `),
  deleteTierItem: db.prepare('DELETE FROM tier_items WHERE id = ?'),

  // --- Subtasks + Daily logs ---
  getSubtask: db.prepare('SELECT * FROM subtasks WHERE id = ?'),
  getSubtasksByTier: db.prepare(
    'SELECT * FROM subtasks WHERE tier_item_id = ? ORDER BY id'
  ),
  listDailyLogsBySub: db.prepare(
    'SELECT * FROM daily_logs WHERE subtask_id = ? ORDER BY log_date DESC, id DESC'
  ),
  insertDailyLog: db.prepare(`
    INSERT INTO daily_logs (subtask_id, log_date, description, result, obstacle,
      progress, author_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  updateSubtaskProgress: db.prepare(
    'UPDATE subtasks SET progress = MAX(progress, ?) WHERE id = ?'
  ),

  // --- Deliverables ---
  listDeliverablesByTier: db.prepare(
    'SELECT * FROM deliverables WHERE tier_item_id = ? ORDER BY sort_order, id'
  ),
  insertDeliverable: db.prepare(
    'INSERT INTO deliverables (tier_item_id, title, completed, sort_order) VALUES (?, ?, ?, ?)'
  ),
  toggleDeliverable: db.prepare(
    'UPDATE deliverables SET completed = 1 - completed, updated_at = datetime(\'now\') WHERE id = ?'
  ),

  // --- History ---
  insertHistory: db.prepare(`
    INSERT INTO history_entries (entity_type, entity_id, action,
      author_user_id, author_username, author_fullname) VALUES (?, ?, ?, ?, ?, ?)
  `),
  listHistoryByEntity: db.prepare(`
    SELECT * FROM history_entries WHERE entity_type = ? AND entity_id = ?
    ORDER BY created_at DESC LIMIT 100
  `),

  // --- Team lead tasks ---
  listTeamLeadTasks: db.prepare(`
    SELECT t.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM team_lead_tasks t LEFT JOIN users u ON u.id = t.owner_user_id
    ORDER BY t.created_at DESC
  `),
  getTeamLeadTask: db.prepare('SELECT * FROM team_lead_tasks WHERE id = ?'),
  updateTeamLeadTaskStatus: db.prepare(
    'UPDATE team_lead_tasks SET status = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ),
  insertTeamLeadTask: db.prepare(`
    INSERT INTO team_lead_tasks (code, title, category, deliverable_type, deliverable_text,
      file_name, owner_user_id, department_code, submitted_at, deadline, status, priority,
      progress_text, help_message_author, help_message_body, help_message_timeago)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  // --- Employee tasks ---
  listEmployeeTasksByOwner: db.prepare(
    'SELECT * FROM employee_tasks WHERE owner_user_id = ? ORDER BY created_at DESC'
  ),
  listEmployeeTasksByDept: db.prepare(
    'SELECT * FROM employee_tasks WHERE department_code = ? ORDER BY created_at DESC'
  ),
  insertEmployeeTask: db.prepare(`
    INSERT INTO employee_tasks (code, bundle_name, title, description, current_deliverable,
      last_updated, deadline, is_today, status, manager_user_id, owner_user_id, department_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  // --- Help requests ---
  listHelpRequestsBySender: db.prepare(
    'SELECT * FROM help_requests WHERE sender_user_id = ? ORDER BY created_at DESC'
  ),
  listAllHelpRequests: db.prepare(
    'SELECT * FROM help_requests ORDER BY created_at DESC'
  ),
  insertHelpRequest: db.prepare(`
    INSERT INTO help_requests (sender_user_id, reason, message, status, related_team_lead_task_id)
    VALUES (?, ?, ?, ?, ?)
  `),
  resolveHelpRequest: db.prepare(`
    UPDATE help_requests SET status = 'resolved', resolved_at = datetime('now'),
      resolved_by_user_id = ? WHERE id = ?
  `),

  // --- Rollup helper ---
  getChildrenProgress: db.prepare(
    'SELECT progress FROM tier_items WHERE parent_id = ?'
  ),
  getTierParent: db.prepare(
    'SELECT id, parent_id FROM tier_items WHERE id = ?'
  ),
};

export default db;