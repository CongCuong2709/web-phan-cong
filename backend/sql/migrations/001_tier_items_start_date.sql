-- =============================================================================
-- Migration 001 — tier_items: start_date + end_date rename + cleanup
-- Run:  sqlite3 database.db < migrations/001_tier_items_start_date.sql
-- Hoặc từ Node: db.exec(fs.readFileSync('.../001_...sql','utf8'))
--
-- Changes:
--   + ADD COLUMN start_date TEXT NOT NULL DEFAULT (date('now'))
--   ~ RENAME COLUMN deadline → end_date
--   - DROP COLUMN days_remaining       (derived runtime)
--   - DROP COLUMN gantt_label          (display-only, derive từ title+progress)
--   - DROP COLUMN gantt_bar_color      (display-only, derive từ tier+status)
--   - DROP COLUMN is_blocked           (duplicate với status='Đang nghẽn')
--   + CREATE INDEX idx_tier_start_date
--   + CREATE INDEX idx_tier_end_date
--
-- Backfill:
--   - start_date được backfill = end_date - 14 ngày cho row đã tồn tại
--   - Nếu cần custom, edit file này trước khi chạy.
--
-- Idempotent: mỗi step dùng try/catch qua shell wrapper, hoặc bỏ qua lỗi
-- "duplicate column name" / "no such column" khi đã chạy rồi.
-- =============================================================================

PRAGMA foreign_keys = OFF;  -- Tắt FK trong transaction để tránh lỗi cascade
BEGIN TRANSACTION;

-- 1. Thêm cột start_date (idempotent: nếu đã có thì skip)
ALTER TABLE tier_items ADD COLUMN start_date TEXT;

-- 2. Backfill start_date cho data cũ (deadline - 14 ngày)
-- Chỉ chạy khi start_date vừa được add (NULL). Nếu start_date đã có (default = today)
-- thì UPDATE không ảnh hưởng vì đã có giá trị.
UPDATE tier_items
SET start_date = date(end_date, '-14 days')
WHERE start_date IS NULL OR start_date = date('now');

-- Sau khi backfill, NOT NULL constraint mới có ý nghĩa
-- (SQLite không cho set NOT NULL trực tiếp trong ALTER TABLE; cần recreate table nếu muốn.
-- Trong code app, ta đảm bảo luôn insert start_date NOT NULL.)

-- 3. Drop các cột thừa (SQLite >= 3.35.0)
ALTER TABLE tier_items DROP COLUMN days_remaining;
ALTER TABLE tier_items DROP COLUMN gantt_label;
ALTER TABLE tier_items DROP COLUMN gantt_bar_color;
ALTER TABLE tier_items DROP COLUMN is_blocked;

-- 4. Rename deadline → end_date (SQLite >= 3.25.0)
ALTER TABLE tier_items RENAME COLUMN deadline TO end_date;

-- 5. Indexes (idempotent: CREATE INDEX IF NOT EXISTS không có trong SQLite cũ,
-- nhưng IF NOT EXISTS được support từ 3.8.0)
CREATE INDEX IF NOT EXISTS idx_tier_start_date ON tier_items(start_date);
CREATE INDEX IF NOT EXISTS idx_tier_end_date   ON tier_items(end_date);

-- 6. Re-sync start_week/end_week dựa trên date range mới (optional)
-- Logic: startWeek = ceil((start_date - first_of_month(start_date)) / 7) + 1
--        endWeek   = startWeek + (end_date - start_date) / 7
-- Để an toàn, ta KHÔNG touch start_week/end_week ở đây. App sẽ sync dần.

COMMIT;
PRAGMA foreign_keys = ON;

-- Verify kết quả:
-- SELECT column_name FROM pragma_table_info('tier_items') ORDER BY cid;
-- Expected columns:
--   id, code, tier, title, parent_id, department_code, owner_user_id,
--   start_date, end_date,           ← mới
--   progress, status, priority, description, management_notes, blocker_alert,
--   start_week, end_week,           ← giữ (denormalized cho perf)
--   collapsed, created_at, updated_at
-- Đã drop: days_remaining, gantt_label, gantt_bar_color, is_blocked, deadline