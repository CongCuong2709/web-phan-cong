-- =============================================================================
-- schema.sql — Database schema v3 (2026-10) — NORMALIZED
--
-- REFACTOR (Phase C — comprehensive):
--   Trước v2: 1 bảng `tasks` wide-table 25+ cột, với tier (1-4) chỉ là cột int.
--             Trộn field của T1 (management_notes) với T4 (deliverable_*)
--             → 1NF vi phạm nhiều chỗ, khó query, khó mở rộng.
--   Sau v3:   Tách thành 4 bảng projects/phases/bundles/tasks + 2 bảng con
--             task_deliverables, task_help_messages (1:N).
--             Mỗi bảng chỉ chứa field đúng nghĩa nghiệp vụ.
--
-- Status vocab chuẩn hoá (Phase B): pending|doing|done|pending_approval|blocked
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
-- 3. Sub-resources (1:N — thay vì inline columns)
-- ============================================================================

-- 1 task có N deliverables (giải quyết 1NF violation: trước đây chỉ 1 deliverable/task)
CREATE TABLE IF NOT EXISTS task_deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('pdf','spreadsheet','text','photo')),
  text TEXT,
  file_name TEXT,
  file_url TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_deliv_task ON task_deliverables(task_id);

-- 1 task có N help messages (lưu lịch sử, không overwrite)
CREATE TABLE IF NOT EXISTS task_help_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0,1)),
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_help_task ON task_help_messages(task_id);
CREATE INDEX IF NOT EXISTS idx_task_help_author ON task_help_messages(author_user_id);

-- ============================================================================
-- 4. SubTask + DailyLog (giữ nguyên cấu trúc, ref FK đúng)
-- ============================================================================

CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'doing'
    CHECK (status IN ('doing','done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subtask_id INTEGER NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  obstacle TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_logs_subtask ON daily_logs(subtask_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(log_date);

-- ============================================================================
-- 5. Task notes (ghi chú trên task, không phải daily log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);

-- ============================================================================
-- 6. Help requests (giữ — 1 user gửi 1 help request linked 1 task)
-- ============================================================================

CREATE TABLE IF NOT EXISTS help_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  message TEXT NOT NULL,
  related_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_help_requests_sender ON help_requests(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_help_requests_status ON help_requests(status);

-- ============================================================================
-- 7. Audit log (Phase D — upgrade: thêm old_values, new_values, IP, UA)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project','phase','bundle','task','subtask','task_note','task_deliverable','task_help_message','help_request','user')),
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
-- 8. Sessions + Messages + Attachments (giữ nguyên, ít dùng)
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

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  context_type TEXT NOT NULL DEFAULT 'help_request'
    CHECK (context_type IN ('help_request','task_note')),
  context_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_user_id, read_at);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('task','task_note','message','task_deliverable')),
  owner_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id);

-- ============================================================================
-- 9. Triggers (auto-rollup progress — Phase B đã loại bỏ JS rollup trùng)
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

CREATE TRIGGER IF NOT EXISTS subtasks_updated AFTER UPDATE ON subtasks
  BEGIN UPDATE subtasks SET updated_at = datetime('now') WHERE id = NEW.id; END;
