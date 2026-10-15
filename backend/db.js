/**
 * db.js — Database connection dùng `node:sqlite` (built-in từ Node 22.5+).
 *
 * Phase C (2026-10) refactor:
 *   - Schema đổi từ 1 wide-table `tasks` thành 4 bảng projects/phases/bundles/tasks
 *   - Mỗi loại entity có stmt cache riêng (insertX, getX, listX)
 *   - Sub-resource (deliverable, help message) là 1:N với task
 *   - Audit log đổi tên `history_entries` → `audit_log`, có JSON snapshot
 *
 * Phase B:
 *   - Bỏ JS rollup trùng với trigger (xem stateMachine.js + recomputeRollup trong routes)
 *   - PRAGMA journal_mode = WAL, foreign_keys = ON
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
 * Statement cache (Phase C: chuẩn hoá theo entity).
 * Mỗi statement được prepare 1 lần, gọi nhiều lần.
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
  insertProject: db.prepare(`
    INSERT INTO projects (code, title, description, owner_user_id, start_date, end_date, status, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
  insertPhase: db.prepare(`
    INSERT INTO phases (project_id, code, title, description, owner_user_id,
      start_date, end_date, status, management_notes, blocker_alert, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  insertBundle: db.prepare(`
    INSERT INTO bundles (phase_id, code, title, description, owner_user_id,
      start_date, end_date, status, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      b.phase_id AS phase_id, ph.project_id AS project_id
    FROM tasks t
      LEFT JOIN users u ON u.id = t.owner_user_id
      LEFT JOIN users a ON a.id = t.assigned_by_user_id
      LEFT JOIN bundles b ON b.id = t.bundle_id
      LEFT JOIN phases ph ON ph.id = b.phase_id
    WHERE t.id = ?
  `),
  getTasksByBundle: db.prepare(`
    SELECT t.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM tasks t LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.bundle_id = ? ORDER BY t.code
  `),
  insertTask: db.prepare(`
    INSERT INTO tasks (bundle_id, code, title, description, owner_user_id, assigned_by_user_id,
      department_code, start_date, end_date, progress, status, priority, is_today, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateTask: db.prepare(`
    UPDATE tasks SET
      title = ?, description = ?, owner_user_id = ?, assigned_by_user_id = ?,
      department_code = ?, start_date = ?, end_date = ?,
      progress = ?, status = ?, priority = ?, is_today = ?, collapsed = ?
    WHERE id = ?
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

  // --- Task Deliverables (1:N) ---
  listDeliverablesByTask: db.prepare(`
    SELECT * FROM task_deliverables WHERE task_id = ? ORDER BY sort_order, id
  `),
  insertDeliverable: db.prepare(`
    INSERT INTO task_deliverables (task_id, type, text, file_name, file_url, mime_type, size_bytes, completed, completed_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateDeliverable: db.prepare(`
    UPDATE task_deliverables SET
      type = ?, text = ?, file_name = ?, file_url = ?, mime_type = ?, size_bytes = ?,
      completed = ?, completed_at = ?, sort_order = ?
    WHERE id = ?
  `),
  deleteDeliverable: db.prepare('DELETE FROM task_deliverables WHERE id = ?'),
  getDeliverable: db.prepare('SELECT * FROM task_deliverables WHERE id = ?'),

  // --- Task Help Messages (1:N) ---
  listHelpMessagesByTask: db.prepare(`
    SELECT m.*, u.username AS author_username_str, u.fullname AS author_fullname
    FROM task_help_messages m LEFT JOIN users u ON u.id = m.author_user_id
    WHERE m.task_id = ? ORDER BY m.created_at DESC
  `),
  insertHelpMessage: db.prepare(`
    INSERT INTO task_help_messages (task_id, author_user_id, body, is_resolved)
    VALUES (?, ?, ?, 0)
  `),
  resolveHelpMessage: db.prepare(`
    UPDATE task_help_messages SET is_resolved = 1, resolved_by_user_id = ?, resolved_at = datetime('now')
    WHERE id = ?
  `),

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
  listDailyLogsBySub: db.prepare(`
    SELECT l.*, u.username AS user_username_str, u.fullname AS user_fullname
    FROM daily_logs l LEFT JOIN users u ON u.id = l.author_user_id
    WHERE l.subtask_id = ? ORDER BY l.log_date DESC, l.id DESC
  `),
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

  // --- Task notes ---
  listNotesForTask: db.prepare(`
    SELECT n.*, u.username AS author_username_str, u.fullname AS author_fullname
    FROM task_notes n LEFT JOIN users u ON u.id = n.author_user_id
    WHERE n.task_id = ? ORDER BY n.created_at DESC
  `),
  insertTaskNote: db.prepare(
    'INSERT INTO task_notes (task_id, body, author_user_id) VALUES (?, ?, ?)'
  ),

  // --- Audit log (Phase D — old schema: history_entries; new: audit_log) ---
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
};

export default db;
