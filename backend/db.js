/**
 * db.js — Single Database connection + schema bootstrap.
 *
 * Sử dụng better-sqlite3 (synchronous, fastest cho MVP).
 * Schema được load 1 lần khi server khởi động; idempotent nhờ CREATE IF NOT EXISTS.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');
const SCHEMA_PATH = path.join(__dirname, 'sql', 'schema.sql');

const isFreshDb = !fs.existsSync(DB_PATH);

export const db = new Database(DB_PATH);

// Bật FK + WAL cho production-ish performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Bootstrap schema khi file DB mới được tạo. Nếu DB đã tồn tại, không
 * ghi đè — chỉ apply thủ công qua migration script.
 */
if (isFreshDb) {
  console.log(`[db] Fresh database detected at ${DB_PATH}. Loading schema…`);
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  console.log('[db] Schema loaded.');
}

/**
 * Helper: chạy query trong transaction. Tự rollback nếu có exception.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function tx(fn) {
  return db.transaction(fn)();
}

/**
 * Helper: prepare statement cache để tránh re-prepare mỗi lần.
 * Đơn giản nhưng đủ cho MVP; nếu cần scale thì dùng `db.prepare` trực tiếp.
 */
export const stmt = {
  // Users
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1'),
  getUserById: db.prepare('SELECT id, username, fullname, email, role, initial, avatar_url FROM users WHERE id = ? AND is_active = 1'),
  listUsers: db.prepare(`SELECT id, username, fullname, email, role, initial, avatar_url,
    (SELECT GROUP_CONCAT(department_code, ',') FROM user_departments WHERE user_id = users.id) AS departments
    FROM users WHERE is_active = 1 ORDER BY role, fullname`),
  getUserDepartments: db.prepare('SELECT department_code FROM user_departments WHERE user_id = ?'),

  // Sessions
  createSession: db.prepare(`INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?)`),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL'),
  revokeSession: db.prepare('UPDATE sessions SET revoked_at = datetime("now") WHERE id = ?'),

  // Tier items
  listTierItems: db.prepare(`SELECT t.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM tier_items t LEFT JOIN users u ON u.id = t.owner_user_id ORDER BY tier, code`),
  getTierItem: db.prepare(`SELECT t.*, u.username AS owner_username_str, u.fullname AS owner_fullname
    FROM tier_items t LEFT JOIN users u ON u.id = t.owner_user_id WHERE t.id = ?`),
  createTierItem: db.prepare(`INSERT INTO tier_items (code, tier, title, parent_id, department_code,
    owner_user_id, deadline, progress, status, priority, description, management_notes,
    start_week, end_week, gantt_label, gantt_bar_color)
    VALUES (@code, @tier, @title, @parent_id, @department_code, @owner_user_id, @deadline,
    @progress, @status, @priority, @description, @management_notes,
    @start_week, @end_week, @gantt_label, @gantt_bar_color)`),
  updateTierItem: db.prepare(`UPDATE tier_items SET
    title = @title, progress = @progress, status = @status, priority = @priority,
    deadline = @deadline, description = @description, management_notes = @management_notes,
    blocker_alert = @blocker_alert, is_blocked = @is_blocked,
    start_week = @start_week, end_week = @end_week, gantt_label = @gantt_label,
    gantt_bar_color = @gantt_bar_color
    WHERE id = @id`),
  deleteTierItem: db.prepare('DELETE FROM tier_items WHERE id = ?'),
};

export default db;