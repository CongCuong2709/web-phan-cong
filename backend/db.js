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
  // Sau khi fix ISS-001 (middleware trả array) và ISS-002 (helpRequests filter
  // thiếu dept), getUserById trả về user KHÔNG có departments. Consumers cần
  // dùng stmt.getUserDepartments.all(user.id) riêng.
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
  // Update password_hash cho user (trigger users_updated sẽ tự bump updated_at).
  // Trả về số row affected để caller biết update có thành công không.
  updateUserPasswordHash: db.prepare(
    'UPDATE users SET password_hash = ? WHERE id = ?'
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

  // --- Tasks (ISS-007: unified tier_items + team_lead_tasks + employee_tasks) ---
  // Schema 2026-10 v2: single `tasks` table với tier ∈ {1,2,3,4}.
  // Owner = người thực hiện; assigned_by = manager giao (cho 'Việc của tôi' view).
  listTasks: db.prepare(`
    SELECT t.*,
      u.username AS owner_username_str, u.fullname AS owner_fullname,
      a.username AS assigned_by_username_str, a.fullname AS assigned_by_fullname
    FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN users a ON a.id = t.assigned_by_user_id
    ORDER BY t.tier, t.code
  `),
  getTask: db.prepare(`
    SELECT t.*,
      u.username AS owner_username_str, u.fullname AS owner_fullname,
      a.username AS assigned_by_username_str, a.fullname AS assigned_by_fullname
    FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN users a ON a.id = t.assigned_by_user_id
    WHERE t.id = ?
  `),
  getTaskByCode: db.prepare(
    'SELECT id FROM tasks WHERE code = ? AND (department_code = ? OR ? IS NULL)'
  ),
  insertTask: db.prepare(`
    INSERT INTO tasks (
      code, title, description, parent_id, tier,
      owner_user_id, assigned_by_user_id, department_code,
      start_date, end_date, progress, status, priority,
      is_today, bundle_name, last_updated,
      deliverable_type, deliverable_text, deliverable_completed, file_name,
      help_message_author, help_message_body, help_message_timeago,
      management_notes, blocker_alert, start_week, end_week, collapsed
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `),
  updateTask: db.prepare(`
    UPDATE tasks SET
      title = ?, description = ?, parent_id = ?,
      owner_user_id = ?, assigned_by_user_id = ?, department_code = ?,
      start_date = ?, end_date = ?, progress = ?, status = ?, priority = ?,
      is_today = ?, bundle_name = ?, last_updated = ?,
      deliverable_type = ?, deliverable_text = ?, deliverable_completed = ?, file_name = ?,
      help_message_author = ?, help_message_body = ?, help_message_timeago = ?,
      management_notes = ?, blocker_alert = ?,
      start_week = ?, end_week = ?, collapsed = ?
    WHERE id = ?
  `),
  deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),

  // --- Subtasks + Daily logs ---
  getSubtask: db.prepare('SELECT * FROM subtasks WHERE id = ?'),
  getSubtasksByTask: db.prepare(
    'SELECT * FROM subtasks WHERE task_id = ? ORDER BY id'
  ),
  listAllSubtasks: db.prepare(`
    SELECT s.*, u.username AS assignee_username_str, u.fullname AS assignee_fullname
    FROM subtasks s LEFT JOIN users u ON u.id = s.assignee_user_id
    ORDER BY s.id
  `),
  listDailyLogsBySub: db.prepare(
    'SELECT * FROM daily_logs WHERE subtask_id = ? ORDER BY log_date DESC, id DESC'
  ),
  listAllDailyLogs: db.prepare(`
    SELECT l.*, u.username AS user_username_str, u.fullname AS user_fullname
    FROM daily_logs l LEFT JOIN users u ON u.id = l.author_user_id
    ORDER BY l.log_date DESC, l.id DESC
  `),
  insertDailyLog: db.prepare(`
    INSERT INTO daily_logs (subtask_id, log_date, description, result, obstacle,
      progress, author_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  updateSubtaskProgress: db.prepare(
    'UPDATE subtasks SET progress = MAX(progress, ?) WHERE id = ?'
  ),

  // --- Task notes (ISS-007: thay employee_task_notes) ---
  listNotesForTask: db.prepare(`
    SELECT n.*, u.username AS author_username_str, u.fullname AS author_fullname
    FROM task_notes n LEFT JOIN users u ON u.id = n.author_user_id
    WHERE n.task_id = ? ORDER BY n.created_at DESC
  `),
  insertTaskNote: db.prepare(
    'INSERT INTO task_notes (task_id, body, author_user_id) VALUES (?, ?, ?)'
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

  // --- Help requests ---
  listHelpRequestsBySender: db.prepare(
    'SELECT * FROM help_requests WHERE sender_user_id = ? ORDER BY created_at DESC'
  ),
  listAllHelpRequests: db.prepare(
    'SELECT * FROM help_requests ORDER BY created_at DESC'
  ),
  insertHelpRequest: db.prepare(`
    INSERT INTO help_requests (sender_user_id, reason, message, status, related_task_id)
    VALUES (?, ?, ?, ?, ?)
  `),
  resolveHelpRequest: db.prepare(`
    UPDATE help_requests SET status = 'resolved', resolved_at = datetime('now'),
      resolved_by_user_id = ? WHERE id = ?
  `),

  // --- Rollup helper (for progress from children) ---
  getChildrenProgress: db.prepare(
    'SELECT progress FROM tasks WHERE parent_id = ?'
  ),
  getTaskParent: db.prepare(
    'SELECT id, parent_id FROM tasks WHERE id = ?'
  ),
};

export default db;