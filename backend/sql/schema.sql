-- =============================================================================
-- schema.sql — SQLite schema cho 4-Tier Enterprise Execution System
-- Backend: Express + better-sqlite3 (Node.js)
-- Generated: Sprint 5 — Backend Foundation
--
-- Cách dùng:
--   sqlite3 database.db < schema.sql
--   hoặc từ Node.js:  db.exec(fs.readFileSync('schema.sql', 'utf8'));
-- =============================================================================

-- Bật foreign key enforcement (SQLite mặc định TẮT!)
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;      -- Concurrent read/write tốt hơn

-- =============================================================================
-- 1. DEPARTMENTS & USERS (Identity)
-- =============================================================================

-- Bảng master cho 4 phòng ban. Đơn giản nhưng cần để FK + label mapping.
CREATE TABLE departments (
  code TEXT PRIMARY KEY CHECK (code IN ('ĐH','QLDA','KTTC','TC')),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Seed departments ngay tại schema (idempotent).
INSERT OR IGNORE INTO departments (code, label, sort_order) VALUES
  ('ĐH',   'Ban Điều hành',             1),
  ('QLDA', 'Phòng Quản lý Dự án',       2),
  ('KTTC', 'Phòng Kế toán – Tài chính', 3),
  ('TC',   'Phòng Tổ chức – Hành chính',4);

-- Users có role nhưng KHÔNG có department ở đây (1 user có thể thuộc nhiều phòng).
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,        -- bcrypt hash; KHÔNG BAO GIỜ lưu plaintext
  fullname TEXT NOT NULL,
  email TEXT UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin','director','manager','employee')),
  initial TEXT,
  avatar_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active);

-- N:M relationship user ↔ department. Admin có thể thuộc nhiều dept (sentinel).
CREATE TABLE user_departments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_code TEXT NOT NULL REFERENCES departments(code) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_code)
);

CREATE INDEX idx_user_depts_dept ON user_departments(department_code);

-- Sessions: track JWT (jti = session id) cho logout-all + audit.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- JWT jti claim
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  revoked_at TEXT                    -- Soft-revoke; null = active
);

CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at);
CREATE INDEX idx_sessions_active ON sessions(expires_at) WHERE revoked_at IS NULL;

-- =============================================================================
-- 2. TIER ITEMS (4-Tier Tree)
-- =============================================================================
-- Self-referencing tree: T1 (Dự án) → T2 (Giai đoạn) → T3 (Hạng mục) → T4 (Đầu việc)
-- Roll-up progress được tính bằng app code, không lưu trigger để giữ đơn giản.

CREATE TABLE tier_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,                -- Mã hiển thị (DA-001, GD-01, GOI-01, NV-101)
  tier INTEGER NOT NULL CHECK (tier IN (1,2,3,4)),
  title TEXT NOT NULL,
  parent_id INTEGER REFERENCES tier_items(id) ON DELETE CASCADE,
  department_code TEXT REFERENCES departments(code) ON DELETE SET NULL,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deadline TEXT NOT NULL,            -- ISO date 'YYYY-MM-DD' hoặc display string
  days_remaining INTEGER,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status TEXT NOT NULL,              -- 'Đang chạy' | 'Sắp xong' | 'Đã xong' | ...
  priority TEXT NOT NULL,            -- 'Cao (Critical Path)' | 'Trung bình' | 'Thấp'
  description TEXT NOT NULL DEFAULT '',
  management_notes TEXT NOT NULL DEFAULT '',
  blocker_alert TEXT,
  start_week REAL NOT NULL DEFAULT 1,  -- Gantt: 1..4 (có thể 2.5)
  end_week REAL NOT NULL DEFAULT 1,
  gantt_label TEXT,
  gantt_bar_color TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0,1)),
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tier_parent   ON tier_items(parent_id);
CREATE INDEX idx_tier_dept     ON tier_items(department_code);
CREATE INDEX idx_tier_owner    ON tier_items(owner_user_id);
CREATE INDEX idx_tier_tier     ON tier_items(tier);
CREATE INDEX idx_tier_code     ON tier_items(code);  -- Cho search nhanh

-- =============================================================================
-- 3. DELIVERABLES (Kết quả bàn giao — con của TierItem, thường T4)
-- =============================================================================

CREATE TABLE deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier_item_id INTEGER NOT NULL REFERENCES tier_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  file_url TEXT,
  file_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_deliv_tier ON deliverables(tier_item_id);

-- =============================================================================
-- 4. SUBTASKS + DAILY LOGS (Construction-domain: T4.5 + nhật ký thi công)
-- =============================================================================

CREATE TABLE subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier_item_id INTEGER NOT NULL REFERENCES tier_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL,         -- Display 'dd/MM' hoặc ISO
  end_date TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','completed','blocked','review')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','critical')),
  results TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sub_tier     ON subtasks(tier_item_id);
CREATE INDEX idx_sub_assignee ON subtasks(assignee_user_id);

CREATE TABLE daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subtask_id INTEGER NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,           -- ISO 'YYYY-MM-DD'
  description TEXT NOT NULL,
  result TEXT,
  obstacle TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_log_sub    ON daily_logs(subtask_id);
CREATE INDEX idx_log_author ON daily_logs(author_user_id);
CREATE INDEX idx_log_date   ON daily_logs(log_date DESC);

-- =============================================================================
-- 5. TEAM LEAD TASKS (Giao việc nhóm view)
-- =============================================================================
-- Tách riêng khỏi TierItem (frontend hiện derive). Lý do: thực tế Manager giao
-- task cho nhân viên không phải lúc nào cũng map 1-1 với TierItem; tách ra để
-- model đúng nghiệp vụ.

CREATE TABLE team_lead_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,                    -- 'Kế hoạch' | 'Thiết kế' | ...
  deliverable_type TEXT NOT NULL CHECK (deliverable_type IN ('pdf','spreadsheet','text','photo')),
  deliverable_text TEXT,
  file_name TEXT,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department_code TEXT REFERENCES departments(code) ON DELETE SET NULL,
  submitted_at TEXT NOT NULL,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('pending_approval','need_help','in_progress','done')),
  priority TEXT CHECK (priority IN ('Cao','Thường')),
  progress_text TEXT,               -- '60%' (display)
  -- Help message: inline trong seed, nhưng tách cột để query nhanh.
  help_message_author TEXT,
  help_message_body TEXT,
  help_message_timeago TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tlt_owner  ON team_lead_tasks(owner_user_id);
CREATE INDEX idx_tlt_dept   ON team_lead_tasks(department_code);
CREATE INDEX idx_tlt_status  ON team_lead_tasks(status);

-- =============================================================================
-- 6. EMPLOYEE TASKS (Việc của tôi view)
-- =============================================================================

CREATE TABLE employee_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  bundle_name TEXT,                 -- Tên nhóm việc (VD: 'Đợt 1 — Khảo sát')
  title TEXT NOT NULL,
  description TEXT,
  current_deliverable TEXT,
  last_updated TEXT,
  deadline TEXT,
  is_today INTEGER NOT NULL DEFAULT 0 CHECK (is_today IN (0,1)),
  status TEXT NOT NULL DEFAULT 'doing'
    CHECK (status IN ('doing','done','pending')),
  manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_code TEXT REFERENCES departments(code) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_et_owner   ON employee_tasks(owner_user_id);
CREATE INDEX idx_et_status  ON employee_tasks(status);
CREATE INDEX idx_et_manager ON employee_tasks(manager_user_id);

-- Employee task notes (1 employee_task ↔ N notes — hiện đang là string[]).
CREATE TABLE employee_task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_task_id INTEGER NOT NULL REFERENCES employee_tasks(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_etn_task ON employee_task_notes(employee_task_id);

-- =============================================================================
-- 7. HELP REQUESTS (Xin hỗ trợ từ nhân viên)
-- =============================================================================

CREATE TABLE help_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,             -- Lý do ngắn (1 dòng)
  message TEXT NOT NULL,            -- Nội dung chi tiết
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  related_team_lead_task_id INTEGER REFERENCES team_lead_tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX idx_hr_sender  ON help_requests(sender_user_id);
CREATE INDEX idx_hr_status  ON help_requests(status, created_at DESC);

-- =============================================================================
-- 8. HISTORY ENTRIES (Audit log — không FK để polymorphic)
-- =============================================================================
-- entity_id là INTEGER (id của bảng tương ứng với entity_type). Vì SQLite không
-- hỗ trợ polymorphic FK, mình KHÔNG tạo FK ở đây — toàn vẹn dữ liệu do app
-- đảm bảo.

CREATE TABLE history_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project','phase','bundle','task','subtask','team_lead_task','employee_task')),
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  -- Denormalized author info để hiển thị tuy rằng user bị xoá/vô hiệu hoá.
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_username TEXT NOT NULL,
  author_fullname TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_hist_entity  ON history_entries(entity_type, entity_id);
CREATE INDEX idx_hist_created ON history_entries(created_at DESC);
CREATE INDEX idx_hist_author  ON history_entries(author_user_id);

-- =============================================================================
-- 9. MESSAGES (1-1 messaging — future-proof, MessageModal chỉ toast hiện tại)
-- =============================================================================

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  context_type TEXT,                -- 'task'|'subtask'|'team_lead_task'|null
  context_id INTEGER,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_msg_recipient_unread ON messages(recipient_user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_msg_sender ON messages(sender_user_id, created_at DESC);

-- =============================================================================
-- 10. ATTACHMENTS (File uploads — future-proof)
-- =============================================================================

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('deliverable','subtask','team_lead_task','employee_task','message')),
  owner_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,           -- local path hoặc S3 URL
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_attach_owner ON attachments(owner_type, owner_id);

-- =============================================================================
-- TRIGGERS — auto-update updated_at
-- =============================================================================

CREATE TRIGGER trg_users_updated AFTER UPDATE ON users
BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_tier_items_updated AFTER UPDATE ON tier_items
BEGIN UPDATE tier_items SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_subtasks_updated AFTER UPDATE ON subtasks
BEGIN UPDATE subtasks SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_deliverables_updated AFTER UPDATE ON deliverables
BEGIN UPDATE deliverables SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_team_lead_tasks_updated AFTER UPDATE ON team_lead_tasks
BEGIN UPDATE team_lead_tasks SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_employee_tasks_updated AFTER UPDATE ON employee_tasks
BEGIN UPDATE employee_tasks SET updated_at = datetime('now') WHERE id = NEW.id; END;

-- =============================================================================
-- DONE. Schema đã sẵn sàng. Seed data sẽ insert qua `seed.ts` (xem file riêng).
-- =============================================================================