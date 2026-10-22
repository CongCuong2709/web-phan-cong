/**
 * db.js — Database connection dùng `node:sqlite` (built-in từ Node 22.5+).
 *
 * Schema gồm 4 tier (projects / phases / bundles / tasks) + sub-resource 1:N
 * (daily_logs, task_help_messages, audit_log). Mỗi entity có stmt cache riêng.
 *
 *   - PRAGMA journal_mode = WAL, foreign_keys = ON
 *   - Progress rollup ở JS (xem routes/tasks.js:recomputeRollup); trigger DB
 *     chỉ update updated_at, không rollup.
 *   - Lịch sử thay đổi lớn (Phase B/C/D/E/F/G): xem CHANGELOG.md.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');
const SCHEMA_PATH = path.join(__dirname, 'sql', 'schema.sql');
const MIGRATION_PATH = path.join(__dirname, 'sql', 'migration.sql');

const isFreshDb = !fs.existsSync(DB_PATH);

export const db = new DatabaseSync(DB_PATH);

// PRAGMA qua raw SQL (node:sqlite không có method .pragma()).
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
} else {
  // Với DB đã có data, áp dụng migration idempotent (CREATE UNIQUE INDEX / IF NOT EXISTS).
  // ALTER TABLE có try/catch trong run-migration.mjs; ở đây chỉ chạy IF NOT EXISTS
  // để tránh duplicate-column error.
  try {
    if (fs.existsSync(MIGRATION_PATH)) {
      const mig = fs.readFileSync(MIGRATION_PATH, 'utf8');
      db.exec(mig);
    }
  } catch (err) {
    // Lỗi từ migration không nên block app khởi động — log warning.
    console.warn('[db] Migration step warning:', err.message);
  }
}

/**
 * Manual transaction wrapper. node:sqlite không có `db.transaction()` built-in.
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
 * Statement cache — mỗi entity có stmt riêng (insertX, getX, listX).
 * Prepare 1 lần, gọi nhiều lần.
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

  // --- Projects (Tier 1) ---
  listProjects: db.prepare(`
    SELECT p.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM projects p LEFT JOIN users u ON u.id = p.owner_user_id
    ORDER BY p.code
  `),
  getProject: db.prepare(`
    SELECT p.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM projects p LEFT JOIN users u ON u.id = p.owner_user_id
    WHERE p.id = ?
  `),
  // Audit columns: created_by_user_id
  insertProject: db.prepare(`
    INSERT INTO projects (code, title, description, owner_user_id, created_by_user_id,
      start_date, end_date, status, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateProject: db.prepare(`
    UPDATE projects SET
      title = ?, description = ?, owner_user_id = ?,
      start_date = ?, end_date = ?, status = ?, collapsed = ?
    WHERE id = ?
  `),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),

  // --- Phases (Tier 2) ---
  listPhases: db.prepare(`
    SELECT ph.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM phases ph LEFT JOIN users u ON u.id = ph.owner_user_id
    ORDER BY ph.code
  `),
  getPhasesByProject: db.prepare(`
    SELECT ph.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM phases ph LEFT JOIN users u ON u.id = ph.owner_user_id
    WHERE ph.project_id = ? ORDER BY ph.code
  `),
  getPhase: db.prepare(`
    SELECT ph.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM phases ph LEFT JOIN users u ON u.id = ph.owner_user_id
    WHERE ph.id = ?
  `),
  // Audit columns: created_by_user_id
  insertPhase: db.prepare(`
    INSERT INTO phases (project_id, code, title, description, owner_user_id, created_by_user_id,
      start_date, end_date, status, management_notes, blocker_alert, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updatePhase: db.prepare(`
    UPDATE phases SET
      title = ?, description = ?, owner_user_id = ?,
      start_date = ?, end_date = ?, status = ?,
      management_notes = ?, blocker_alert = ?, collapsed = ?
    WHERE id = ?
  `),
  deletePhase: db.prepare('DELETE FROM phases WHERE id = ?'),

  // --- Bundles (Tier 3) ---
  listBundles: db.prepare(`
    SELECT b.*, u.username AS owner_username_str, u.fullname AS owner_fullname,
      ph.project_id AS project_id
    FROM bundles b
      LEFT JOIN users u ON u.id = b.owner_user_id
      LEFT JOIN phases ph ON ph.id = b.phase_id
    ORDER BY b.code
  `),
  getBundlesByPhase: db.prepare(`
    SELECT b.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM bundles b LEFT JOIN users u ON u.id = b.owner_user_id
    WHERE b.phase_id = ? ORDER BY b.code
  `),
  getBundle: db.prepare(`
    SELECT b.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM bundles b LEFT JOIN users u ON u.id = b.owner_user_id
    WHERE b.id = ?
  `),
  // Audit columns: created_by_user_id
  insertBundle: db.prepare(`
    INSERT INTO bundles (phase_id, code, title, description, owner_user_id, created_by_user_id,
      start_date, end_date, status, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateBundle: db.prepare(`
    UPDATE bundles SET
      title = ?, description = ?, owner_user_id = ?,
      start_date = ?, end_date = ?, status = ?, collapsed = ?
    WHERE id = ?
  `),
  deleteBundle: db.prepare('DELETE FROM bundles WHERE id = ?'),

  // --- Tasks (Tier 4) ---
  listTasks: db.prepare(`
    SELECT t.*,
      u.username AS owner_username_str, u.fullname AS owner_fullname,
      a.username AS assigned_by_username_str, a.fullname AS assigned_by_fullname,
      b.title AS bundle_name,
      b.phase_id AS phase_id, ph.project_id AS project_id
    FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN users a ON a.id = t.assigned_by_user_id
      LEFT JOIN bundles b ON b.id = t.bundle_id
      LEFT JOIN phases ph ON ph.id = b.phase_id
    ORDER BY t.code
  `),
  getTask: db.prepare(`
    SELECT t.*,
      u.username AS owner_username_str, u.fullname AS owner_fullname,
      a.username AS assigned_by_username_str, a.fullname AS assigned_by_fullname,
      b.title AS bundle_name,
      b.phase_id AS phase_id, ph.project_id AS project_id
    FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN users a ON a.id = t.assigned_by_user_id
      LEFT JOIN bundles b ON b.id = t.bundle_id
      LEFT JOIN phases ph ON ph.id = b.phase_id
    WHERE t.id = ?
  `),
  getTasksByBundle: db.prepare(`
    SELECT t.*, u.username AS owner_username_str, u.fullname AS owner_fullname,
      b.title AS bundle_name
    FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN bundles b ON b.id = t.bundle_id
    WHERE t.bundle_id = ? ORDER BY t.code
  `),
  // Audit columns: created_by_user_id, assigned_by_user_id. Today tracking: is_today_date.
  insertTask: db.prepare(`
    INSERT INTO tasks (bundle_id, code, title, description,
      owner_user_id, created_by_user_id, assigned_by_user_id, department_code,
      start_date, end_date, progress, status, priority,
      is_today, is_today_date, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateTask: db.prepare(`
    UPDATE tasks SET
      title = ?, description = ?, owner_user_id = ?, assigned_by_user_id = ?,
      department_code = ?, start_date = ?, end_date = ?,
      progress = ?, status = ?, priority = ?,
      is_today = ?, is_today_date = ?, collapsed = ?,
      blocker_note = ?
    WHERE id = ?
  `),
  // Toggle "today" — set đồng thời is_today + is_today_date.
  setTaskToday: db.prepare(`
    UPDATE tasks SET is_today = ?, is_today_date = ? WHERE id = ?
  `),
  deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
  getChildrenProgress: db.prepare(
    'SELECT progress FROM tasks WHERE bundle_id = ?'
  ),
  getTaskBundlePhase: db.prepare(`
    SELECT t.bundle_id, b.phase_id, ph.project_id
    FROM tasks t LEFT JOIN bundles b ON b.id = t.bundle_id
      LEFT JOIN phases ph ON ph.id = b.phase_id
    WHERE t.id = ?
  `),

  // --- Daily logs (FK trực tiếp vào tasks, không qua subtasks) ---
  // ON CONFLICT(task_id, log_date) DO UPDATE — atomic UPSERT.
  upsertDailyLog: db.prepare(`
    INSERT INTO daily_logs (task_id, log_date, description, result, obstacle, progress, author_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, log_date) DO UPDATE SET
      description = excluded.description,
      result = excluded.result,
      obstacle = excluded.obstacle,
      progress = excluded.progress,
      author_user_id = excluded.author_user_id,
      created_at = datetime('now')
  `),
  listDailyLogsByTask: db.prepare(`
    SELECT l.*, u.username AS user_username_str, u.fullname AS user_fullname
    FROM daily_logs l LEFT JOIN users u ON u.id = l.author_user_id
    WHERE l.task_id = ? ORDER BY l.log_date DESC, l.id DESC
  `),
  listAllDailyLogs: db.prepare(`
    SELECT l.*, u.username AS user_username_str, u.fullname AS user_fullname
    FROM daily_logs l LEFT JOIN users u ON u.id = l.author_user_id
    ORDER BY l.log_date DESC, l.id DESC
  `),
  insertDailyLog: db.prepare(`
    INSERT INTO daily_logs (task_id, log_date, description, result, obstacle,
      progress, author_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  // UPSERT theo pattern SELECT-then-UPDATE — giữ để test/debug.
  // Code chính dùng upsertDailyLog (ON CONFLICT) ở trên.
  upsertDailyLogForToday: db.prepare(`
    UPDATE daily_logs
       SET description = ?, result = ?, obstacle = ?, progress = ?,
           author_user_id = ?, created_at = datetime('now')
     WHERE task_id = ? AND log_date = ?
  `),

  // --- Task help messages (lịch sử escalation 1:N) ---
  insertHelpMessage: db.prepare(`
    INSERT INTO task_help_messages (task_id, body, author_user_id)
    VALUES (?, ?, ?)
  `),
  listHelpMessagesByTask: db.prepare(`
    SELECT m.*, u.username AS author_username_str, u.fullname AS author_fullname
    FROM task_help_messages m
    LEFT JOIN users u ON u.id = m.author_user_id
    WHERE m.task_id = ?
    ORDER BY m.created_at DESC, m.id DESC
  `),
  resolveHelpMessage: db.prepare(`
    UPDATE task_help_messages
    SET is_resolved = 1, resolved_by_user_id = ?, resolved_at = datetime('now')
    WHERE id = ? AND task_id = ?
  `),
  // Snapshot toàn bộ help messages của 1 task (dùng khi DELETE task để giữ audit)
  listHelpMessagesForTaskForSnapshot: db.prepare(`
    SELECT m.*, u.username AS author_username_str
    FROM task_help_messages m
    LEFT JOIN users u ON u.id = m.author_user_id
    WHERE m.task_id = ?
    ORDER BY m.created_at ASC
  `),
  // Snapshot toàn bộ daily logs của 1 task (dùng khi DELETE task)
  listDailyLogsForTaskForSnapshot: db.prepare(`
    SELECT * FROM daily_logs WHERE task_id = ? ORDER BY log_date ASC
  `),

  // --- Audit log (JSON snapshot; schema mới thay cho history_entries cũ) ---
  insertAuditLog: db.prepare(`
    INSERT INTO audit_log (entity_type, entity_id, action,
      old_values, new_values,
      actor_user_id, actor_username, actor_ip, actor_user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listAuditByEntity: db.prepare(`
    SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ?
    ORDER BY created_at DESC LIMIT 100
  `),

  // --- Weekly reports (Ponytail: 1 bảng, rows lưu JSON) ---
  // UPSERT theo (user_id, week_start). Mỗi NV 1 row / tuần.
  upsertWeeklyReport: db.prepare(`
    INSERT INTO weekly_reports (user_id, week_start, week_end, rows_json, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, week_start) DO UPDATE SET
      week_end = excluded.week_end,
      rows_json = excluded.rows_json,
      updated_at = datetime('now')
  `),
  getWeeklyReport: db.prepare(`
    SELECT user_id, week_start, week_end, rows_json, updated_at
    FROM weekly_reports WHERE user_id = ? AND week_start = ?
  `),
};

export default db;
