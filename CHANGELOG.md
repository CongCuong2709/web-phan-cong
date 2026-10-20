# Changelog — Web Phân Công (4-Tier Enterprise Execution System)

Tài liệu này gom lại ngữ cảnh lịch sử của các thay đổi lớn đã ship.
Mục đích: tránh để các comment `// Phase X` / `// Fix Bổ sung-N` / `// Fix TD-NN`
rải rác trong source — gây nhiễu khi đọc code.

## Tóm tắt các đợt refactor lớn

| Phase | Ngày | Nội dung chính |
|-------|------|----------------|
| **Phase B** | 2026-10 | `PRAGMA journal_mode = WAL`, `foreign_keys = ON`. Progress rollup vẫn ở JS (xem `routes/tasks.js:recomputeRollup`); trigger DB chỉ `updated_at`. |
| **Phase C** | 2026-10 | Tách 1 wide-table `tasks` thành 4 bảng `projects` / `phases` / `bundles` / `tasks` (T1–T4). Mỗi entity có stmt cache riêng. Sub-resource (deliverable, help message, daily_log, note) là 1:N với task. Audit log đổi tên `history_entries` → `audit_log`, có JSON snapshot. Chuẩn hoá `createTask` (bỏ alias `createEmployeeTask` / `createTeamLeadTask`). |
| **Phase D** | 2026-10 | Schema audit log ổn định (`entity_type`, `entity_id`, `action`, `old_values`, `new_values`, `actor_*`). Đồng thời chuẩn hoá endpoint `/api/tasks` (ISS-007 unified) — 1 route duy nhất, dispatch theo `tier` (1→projects, 2→phases, 3→bundles, 4→tasks). Bỏ alias `tier-items`, `team-tasks`, `employee-tasks` (route & DTO cũ). |
| **Phase E** | 2026-10 | Xoá bảng `subtasks`. `daily_logs` FK trực tiếp vào `tasks` (không qua subtask). Thay subtasks routes bằng dailyLogs routes. |
| **Phase F** | 2026-10 | **Lược bỏ use-case nặng**: <br>• Xoá bảng `task_deliverables` + component `DeliverablePreviewModal` (text-only qua `daily_logs.result`). <br>• Xoá bảng `messages` + component `MessageModal` (escalation qua `tasks.blocker_note`). <br>• Xoá bảng `help_requests` (giờ là 1 cột `blocker_note` trên `tasks`). <br>• Xoá bảng `task_notes` (NV ghi 1 dòng trong daily log). <br>• Xoá quyền `task:request_help` (giờ dùng `task:edit` để ghi `blocker_note`). <br>• Bỏ `notesCount`, `previewTask`, `messageTarget`, `currentDeliverable`. <br>• `helpRequests` route chỉ trả `410 Gone` (giữ làm safety net tới 2027-04-01). |
| **Phase G** | 2026-10 | **Khôi phục lịch sử + chống race + tracking người tạo**: <br>• **G1** — `daily_logs` có `UNIQUE(task_id, log_date)` + `ON CONFLICT DO UPDATE` (UPSERT atomic, hết race). <br>• **G2** — Thêm `tasks.is_today_date` (hết "today vĩnh viễn"). Toggle `is_today` đồng bộ `is_today_date` = hôm nay (hoặc `null` khi tắt). <br>• **G3** — Thêm `created_by_user_id` trên 4 tier (audit "ai tạo"). <br>• **G7** — Khôi phục bảng `task_help_messages` (lịch sử 1:N escalation) — endpoint mới: `GET/POST /api/tasks/:tier/:id/help-messages` + `POST /api/tasks/:tier/:id/help-messages/:msgId/resolve`. Snapshot help_messages + daily_logs vào audit trước khi `DELETE` task (giữ truy vết). |

## Fix đơn lẻ (Bổ sung / TD)

| Mã | Ngữ cảnh |
|----|----------|
| **Bổ sung-1** | Tier 1 (Project) giờ cho phép update status (trước chỉ Tier 2–4). |
| **Bổ sung-5** | `Toast` thêm type `'error'` (đỏ, icon `error`). Trước phải fake bằng `'warning'`. |
| **TD-05** | Typed DTOs thay cho `unknown[]` ở `apiClient.ts`. TypeScript bắt lỗi runtime khi schema đổi. |
| **TD-06** | `GiaoViecNhomView` filter "thành viên" hiển thị **tên** thay vì raw value. |
| **TD-07** | `DetailsDrawer.history` filter đúng theo ý đồ: bao gồm cả descendants của items user đang mở (cần truyền `allTierItems`). |

## Quy ước tương lai

- Khi có thay đổi lớn (xoá/thêm bảng, đổi schema, refactor kiến trúc) → thêm 1 dòng vào bảng trên.
- Không để comment lịch sử trong source — chỉ comment giải thích **hành vi hiện tại / hợp đồng API**.