-- =============================================================================
-- schema.sql — Database schema v6 (2026-10) — TEXT-ONLY, SIMPLIFIED + AUDIT FIXES
--
-- Lịch sử refactor:
--   Phase B (2026-10): bỏ JS rollup trùng với trigger (sau đó rollback vì
--     trigger chỉ update updated_at, JS rollup vẫn cần — xem routes/tasks.js).
--   Phase C (2026-10): chuẩn hoá 4-tier (projects/phases/bundles/tasks).
--   Phase D (2026-10): đổi history_entries → audit_log có JSON snapshot.
--   Phase E (2026-10): bỏ bảng subtasks; daily_logs FK trực tiếp vào tasks.
--   Phase F (2026-10): bỏ 3 lớp text overlap → chỉ giữ daily_logs.
--   Phase G (2026-10 — BẢN NÀY): vá các vấn đề thiết kế còn lại:
--     G1. UNIQUE(task_id, log_date) trên daily_logs + dùng ON CONFLICT
--         trong code (atomic UPSERT, hết race condition).
--     G2. is_today_date TEXT trên tasks — "today" có ngày cụ thể, tự reset.
--     G3. created_by_user_id trên projects/phases/bundles/tasks — truy vết
--         người tạo (audit_log chỉ có cho mutations, không có cho lúc tạo).
--     G4. CHECK format ngày (YYYY-MM-DD) cho start_date/end_date/log_date.
--     G5. CHECK độ dài password_hash (bcrypt ~60 ký tự).
--     G6. Comment đúng về "JS rollup vs trigger" (trigger chỉ updated_at).
--     G7. Khôi phục bảng task_help_messages (lịch sử escalation) — bổ sung
--         cho tasks.blocker_note (chỉ giữ 1 dòng hiện tại). Bảng này
--         đơn giản hơn daily_logs: chỉ body + author + is_resolved.
--
-- Status vocab chuẩn hoá: pending|doing|done|pending_approval|blocked
-- Priority vocab chuẩn hoá: low|normal|high|critical
-- State machine định nghĩa ở backend/lib/stateMachine.js
-- =============================================================================

-- ============================================================================
-- 0. Reusable CHECK expression cho date format YYYY-MM-DD
-- ============================================================================
-- Lưu ý: SQLite không có native DATE; dùng TEXT với GLOB pattern.
-- Cho phép NULL (date optional), nhưng nếu set phải đúng format.
-- Áp dụng trong CHECK constraints bên dưới.

-- ============================================================================
-- 1. Users + Departments
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- bcrypt hash luôn ~60 ký tự; reject rỗng hoặc quá ngắn để chặn bug.
  password_hash TEXT NOT NULL CHECK (length(password_hash) >= 20),
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
-- Tier 4 = tasks       (Đầu việc)      — có bundle_id, is_today_date
--
-- Phase G3: tất cả 4 tier có created_by_user_id (người tạo) — khác với
--   owner_user_id (người chịu trách nhiệm hiện tại). tasks còn có
--   assigned_by_user_id (người giao việc).
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','doing','done','pending_approval','blocked')),
  progress_rollup INTEGER NOT NULL DEFAULT 0 CHECK (progress_rollup BETWEEN 0 AND 100),
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_creator ON projects(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
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
CREATE INDEX IF NOT EXISTS idx_phases_creator ON phases(created_by_user_id);

CREATE TABLE IF NOT EXISTS bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
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
CREATE INDEX IF NOT EXISTS idx_bundles_creator ON bundles(created_by_user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id INTEGER REFERENCES bundles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department_code TEXT REFERENCES departments(code) ON DELETE SET NULL,
  start_date TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','doing','done','pending_approval','blocked')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  -- Phase G2: is_today + is_today_date.
  --   is_today       — boolean cờ nhanh (back-compat, có thể derive từ is_today_date)
  --   is_today_date  — nếu set và = hôm nay → task hiện trong "Today" view.
  --                    Nếu set nhưng < hôm nay → coi như đã hết hạn, view bỏ qua.
  --                    Tự reset qua logic app: mỗi lần toggle, set date = today().
  -- Chỉ T4 (tasks) mới có 2 cột này (employee view flag).
  is_today INTEGER NOT NULL DEFAULT 0 CHECK (is_today IN (0,1)),
  is_today_date TEXT CHECK (is_today_date IS NULL OR is_today_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),
  -- Phase F: thay thế task_help_messages (1:N) bằng 1 cột text trên task.
  -- Phase G7: KHÔI PHỤC task_help_messages (lịch sử 1:N) bên dưới — bổ sung
  --   cho blocker_note (chỉ giữ dòng hiện tại). NV/manager có thể xem lịch sử.
  blocker_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bundle_id, code)
);
CREATE INDEX IF NOT EXISTS idx_tasks_bundle ON tasks(bundle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dept ON tasks(department_code);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
-- Phase G2: composite index cho "Today" view: WHERE is_today=1 AND is_today_date=date('now')
CREATE INDEX IF NOT EXISTS idx_tasks_today ON tasks(is_today, is_today_date);
CREATE INDEX IF NOT EXISTS idx_tasks_end_date ON tasks(end_date);

-- ============================================================================
-- 3. DailyLog (nhật ký thi công) — sub-resource duy nhất còn lại
-- ============================================================================
--
-- Phase G1: UNIQUE(task_id, log_date) constraint.
--   Trước đây (Phase F): không có UNIQUE, dùng SELECT-then-UPDATE/INSERT pattern
--   trong code → race condition khi 2 request đồng thời.
--   Giờ: schema enforce uniqueness, code dùng `INSERT ... ON CONFLICT(task_id, log_date) DO UPDATE`.
--
-- 1 task có N daily_logs (mỗi ngày 1 row).
-- 4 cột text: description (công việc), result (kết quả), obstacle (vướng mắc),
-- progress (0-100, dùng để rollup tiến độ task).

CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL CHECK (log_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  description TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  obstacle TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Phase G1: 1 task có tối đa 1 daily_log/ngày
  UNIQUE(task_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_logs_task ON daily_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(log_date);

-- ============================================================================
-- 4. TaskHelpMessage (lịch sử escalation) — Phase G7 khôi phục
-- ============================================================================
--
-- Phase F đã bỏ bảng này vì coi là "3 lớp overlap". Phase G nhận ra:
--   tasks.blocker_note (1 dòng text hiện tại) + task_help_messages (lịch sử
--   1:N) phục vụ 2 mục đích khác nhau:
--     - blocker_note: manager xem nhanh khi mở task
--     - help_messages: NV/manager xem lại lịch sử hội thoại escalation
--
-- Schema tối giản: chỉ body + author + is_resolved. KHÔNG có description/result
-- /obstacle/progress (vì đã có daily_logs cho mục đích đó).

CREATE TABLE IF NOT EXISTS task_help_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0,1)),
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_help_msg_task ON task_help_messages(task_id);
CREATE INDEX IF NOT EXISTS idx_help_msg_unresolved ON task_help_messages(task_id, is_resolved);

-- ============================================================================
-- 5. Audit log (Phase D — upgrade: thêm old_values, new_values, IP, UA)
-- ============================================================================
--
-- Phase G: thêm 'task_help_message' vào entity_type. Đối với DB đã tồn tại
-- (Phase F trở về trước), CHECK constraint không thể sửa bằng ALTER TABLE;
-- cần wipe + bootstrap lại nếu muốn enforce chặt. App-layer vẫn ghi đúng
-- entity_type, CHECK chỉ là defense-in-depth.

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project','phase','bundle','task','daily_log','task_help_message','user')),
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
-- 6. Sessions (auth) — giữ nguyên
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
-- 7. Triggers (auto-update updated_at)
-- ============================================================================
--
-- Phase G6: SỬA COMMENT. Trigger CHỈ update updated_at. Progress rollup được
-- thực hiện ở JS (routes/tasks.js:recomputeRollup) vì:
--   - Cần JOIN các bảng con theo hierarchy thật (task→bundle→phase→project)
--   - Cần biết entity gốc là gì (progress của task đổi → rollup lên bundle, etc.)
--   - SQLite trigger không có cách clean để "biết" parent chain từ con update.
-- Trigger rollup tự động (theo comment cũ) KHÔNG tồn tại — đã bị loại bỏ từ
-- Phase B vì không hoạt động đúng với hierarchy 4-tier.
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
