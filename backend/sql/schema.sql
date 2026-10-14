/**
 * schema.sql — Database schema v2 (2026-10) — UNIFY TASKS
 *
 * REFACTOR: Hợp tục 3 bảng `tier_items`, `team_lead_tasks`, `employee_tasks`
 * (ISS-007 — "ông nói gà bà nói vịt" anti-pattern) thành 1 bảng `tasks` duy nhất.
 *
 * Trước ISS-007:
 *   - tier_items (Gantt 4 tầng view) — có parent_id, management_notes, blocker
 *   - team_lead_tasks (Giao việc nhóm view) — có deliverable_*, file_name
 *   - employee_tasks (Việc của tôi view) — có is_today, bundle_name, notes
 *   → 3 bảng cùng mô tả "task", không có FK, dễ lệch data
 *
 * Sau ISS-007:
 *   - 1 bảng `tasks` với tất cả field (tier ∈ {1,2,3,4} phân biệt cấp độ)
 *   - 1 bảng `task_notes` (thay employee_task_notes)
 *   - subtasks giờ FK vào tasks
 *   - help_requests.related_task_id (thay related_team_lead_task_id)
 *   - Inline deliverable columns (thay bảng deliverables riêng)
 *
 * Status vocab chuẩn hoá: pending|doing|done|pending_approval|blocked
 * Priority vocab chuẩn hoá: low|normal|high|critical
 *
 * Notes:
 *   - 2026-10 PR #1: ISS-001 add permissions (departments array)
 *   - 2026-10 PR #2: ISS-006 fix owner_user_id silent fallback
 *   - 2026-10 PR #3: ISS-007 unify 3 task tables (file này)
 */

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
-- 2. Unified TASKS table (ISS-007 — thay thế tier_items + team_lead_tasks +
--    employee_tasks)
--
-- tier phân biệt cấp độ trong cây dự án:
--   tier=1: Dự án (Project)
--   tier=2: Giai đoạn (Phase)
--   tier=3: Hạng mục / Gói (Bundle)
--   tier=4: Đầu việc (Task — leaf)
-- Tree structure: parent_id tự tham chiếu.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tasks (
  -- Identity
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',

  -- Tree structure (Gantt 4-tier)
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL DEFAULT 4 CHECK (tier IN (1,2,3,4)),
  -- Hierarchy collapse state for Gantt UI
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),

  -- Assignment
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Người giao (manager/admin). NULL = tự tạo.
  assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Department
  department_code TEXT REFERENCES departments(code) ON DELETE SET NULL,

  -- Schedule (ISO 'YYYY-MM-DD')
  start_date TEXT,
  end_date TEXT,

  -- Progress + Status (canonical vocab)
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','doing','done','pending_approval','blocked')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),

  -- Personal task flags (from old employee_tasks)
  is_today INTEGER NOT NULL DEFAULT 0 CHECK (is_today IN (0,1)),
  bundle_name TEXT,           -- Group label ("Gói thiết kế", "Đợt 3")
  last_updated TEXT,          -- Display string ("Vừa cập nhật")

  -- Inline deliverable (from old team_lead_tasks + deliverables table)
  deliverable_type TEXT CHECK (deliverable_type IN ('pdf','spreadsheet','text','photo')),
  deliverable_text TEXT,
  deliverable_completed INTEGER NOT NULL DEFAULT 0 CHECK (deliverable_completed IN (0,1)),
  deliverable_completed_at TEXT,
  file_name TEXT,

  -- Inline help message (from old team_lead_tasks)
  help_message_author TEXT,
  help_message_body TEXT,
  help_message_timeago TEXT,

  -- Management free-form fields (from old tier_items)
  management_notes TEXT NOT NULL DEFAULT '',
  blocker_alert TEXT,

  -- Gantt denormalized fields (week indices for chart rendering)
  start_week REAL NOT NULL DEFAULT 1,
  end_week REAL NOT NULL DEFAULT 1,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Code unique per dept (tránh trùng code giữa 2 phòng ban)
  UNIQUE(code, department_code)
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dept ON tasks(department_code);
CREATE INDEX IF NOT EXISTS idx_tasks_tier ON tasks(tier);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_today ON tasks(is_today);
CREATE INDEX IF NOT EXISTS idx_tasks_end_date ON tasks(end_date);

-- ============================================================================
-- 3. Task notes (thay employee_task_notes — ISS-007)
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
-- 4. Subtasks (giờ FK vào tasks thay vì tier_items)
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
-- 5. Help requests (giờ FK vào tasks thay team_lead_tasks)
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
-- 6. History (simplified — ISS-007: chỉ 1 entity_type = 'task' + 'task_note')
-- ============================================================================

CREATE TABLE IF NOT EXISTS history_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('task','task_note','subtask')),
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_username TEXT,
  author_fullname TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_history_entity ON history_entries(entity_type, entity_id);

-- ============================================================================
-- 7. Sessions
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
-- 8. Messages (quick help inbox)
-- ============================================================================

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

-- ============================================================================
-- 9. Attachments (polymorphic)
-- ============================================================================

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('task','task_note','message')),
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
-- Triggers
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS users_updated AFTER UPDATE ON users
  BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS tasks_updated AFTER UPDATE ON tasks
  BEGIN UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS subtasks_updated AFTER UPDATE ON subtasks
  BEGIN UPDATE subtasks SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS tasks_progress_rollup AFTER UPDATE OF progress ON tasks
  WHEN NEW.parent_id IS NOT NULL
  BEGIN
    -- Rollup progress lên parent (T3/T2/t1) — average of children
    UPDATE tasks SET progress = (
      SELECT CAST(AVG(c.progress) AS INTEGER) FROM tasks c WHERE c.parent_id = NEW.parent_id
    )
    WHERE id = NEW.parent_id;
  END;