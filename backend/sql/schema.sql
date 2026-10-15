-- =============================================================================
-- schema.sql — Database schema v5 (2026-10) — TEXT-ONLY, SIMPLIFIED
--
-- REFACTOR (Phase F — drop over-engineered sub-resources):
--   Mục tiêu: "Phân công task → nhân viên điền kết quả hàng ngày (text-only)".
--   Schema trước có 3 lớp overlap để lưu text trên task (task_deliverables.type=text,
--   task_notes, daily_logs.result). Bỏ 2 lớp trùng → chỉ giữ daily_logs (đã đúng
--   pattern "nhật ký thi công" 4-cột description/result/obstacle/progress).
--
--   DROP: task_deliverables, task_help_messages, help_requests, task_notes, messages, attachments
--   ADD : tasks.blocker_note TEXT  (thay task_help_messages — 1 dòng, manager xem khi mở task)
--   KEEP: daily_logs (4 cột: description, result, obstacle, progress) + log_date + author
--         Mỗi task có 1 daily_log/ngày (UPSERT pattern ở routes/dailyLogs.js).
--
-- Status vocab chuẩn hoá: pending|doing|done|pending_approval|blocked
-- Priority vocab chuẩn hoá: low|normal|high|critical
-- State machine định nghĩa ở backend/lib/stateMachine.js
-- =============================================================================

-- ============================================================================
-- 1. Users + Departments
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  fullname TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','director','manager','employee')),
  initial TEXT,
  avatar_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS user_departments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_code TEXT NOT NULL REFERENCES departments(code) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_code)
);

CREATE INDEX IF NOT EXISTS idx_user_dept_dept ON user_departments(department_code);

-- ============================================================================
-- 2. Project Hierarchy (4 bảng tách riêng — Phase C chuẩn hoá)
--
-- Tier 1 = projects    (Dự án)         — có owner, dates
-- Tier 2 = phases      (Giai đoạn)     — có project_id, management_notes, blocker_alert
-- Tier 3 = bundles     (Hạng mục)      — có phase_id
-- Tier 4 = tasks       (Đầu việc)      — có bundle_id, is_today
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','doing','done','pending_approval','blocked')),
  progress_rollup INTEGER NOT NULL DEFAULT 0 CHECK (progress_rollup BETWEEN 0 AND 100),
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','doing','done','pending_approval','blocked')),
  progress_rollup INTEGER NOT NULL DEFAULT 0 CHECK (progress_rollup BETWEEN 0 AND 100),
  -- Chỉ phase mới có management_notes + blocker_alert
  management_notes TEXT NOT NULL DEFAULT '',
  blocker_alert TEXT,
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON phases(project_id);
CREATE INDEX IF NOT EXISTS idx_phases_owner ON phases(owner_user_id);

CREATE TABLE IF NOT EXISTS bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','doing','done','pending_approval','blocked')),
  progress_rollup INTEGER NOT NULL DEFAULT 0 CHECK (progress_rollup BETWEEN 0 AND 100),
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(phase_id, code)
);
CREATE INDEX IF NOT EXISTS idx_bundles_phase ON bundles(phase_id);
CREATE INDEX IF NOT EXISTS idx_bundles_owner ON bundles(owner_user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id INTEGER REFERENCES bundles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department_code TEXT REFERENCES departments(code) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','doing','done','pending_approval','blocked')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  -- Chỉ T4 (tasks) mới có is_today (employee view flag)
  is_today INTEGER NOT NULL DEFAULT 0 CHECK (is_today IN (0,1)),
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),
  -- Phase F: thay thế task_help_messages (1:N) bằng 1 cột text trên task.
  -- NV ghi 1 dòng "đang vướng ở đâu / cần hỗ trợ gì", manager xem khi mở task.
  blocker_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bundle_id, code)
);
CREATE INDEX IF NOT EXISTS idx_tasks_bundle ON tasks(bundle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dept ON tasks(department_code);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_today ON tasks(is_today);
CREATE INDEX IF NOT EXISTS idx_tasks_end_date ON tasks(end_date);

-- ============================================================================
-- 3. DailyLog (nhật ký thi công) — sub-resource duy nhất còn lại
-- ============================================================================
--
-- Phase F: giờ chỉ còn 1 sub-resource trên task là daily_logs. Trước đây có thêm
--   task_deliverables (1:N), task_help_messages (1:N), task_notes (1:N) — đã drop
--   vì text-only use case không cần 3 lớp overlap.
--
-- 1 task có N daily_logs (mỗi ngày 1 row — UPSERT ở routes/dailyLogs.js).
-- 4 cột text: description (công việc), result (kết quả), obstacle (vướng mắc),
-- progress (0-100, dùng để rollup tiến độ task).
--
-- Lưu ý: KHÔNG đặt UNIQUE(task_id, log_date) ở schema — UPSERT dùng
-- ON CONFLICT trong SQL thông qua WHERE để tìm row cùng ngày trước khi insert.

CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  obstacle TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_logs_task ON daily_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_daily_logs_task_date ON daily_logs(task_id, log_date);

-- ============================================================================
-- 4. Audit log (Phase D — upgrade: thêm old_values, new_values, IP, UA)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project','phase','bundle','task','daily_log','user')),
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete','status_change','login','logout','resolve')),
  old_values TEXT,  -- JSON snapshot trước
  new_values TEXT,  -- JSON snapshot sau
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_username TEXT,  -- snapshot (giữ lại kể cả user bị xoá)
  actor_ip TEXT,
  actor_user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- ============================================================================
-- 5. Sessions (auth) — giữ nguyên
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ============================================================================
-- 6. Triggers (auto-rollup progress — Phase B đã loại bỏ JS rollup trùng)
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS users_updated AFTER UPDATE ON users
  BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS projects_updated AFTER UPDATE ON projects
  BEGIN UPDATE projects SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS phases_updated AFTER UPDATE ON phases
  BEGIN UPDATE phases SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS bundles_updated AFTER UPDATE ON bundles
  BEGIN UPDATE bundles SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS tasks_updated AFTER UPDATE ON tasks
  BEGIN UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id; END;

-- Phase E: bỏ trigger subtasks_updated (bảng subtasks đã bị xoá)
