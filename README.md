# Hệ thống công việc và báo cáo TAG

Hệ thống công việc và báo cáo TAG — điều phối công việc nhóm và quản lý tiến độ theo cấp.

**Stack**:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4
- **Backend**: Express + `node:sqlite` (built-in Node 22.5+) + `bcryptjs` + RBAC

## 🏗️ Kiến trúc (Phase C — refactor toàn diện 2026-10)

### Schema: 11 bảng (4 bảng hierarchy + 7 bảng phụ trợ)

| Tier | Bảng | Vai trò | Đặc trưng |
|---|---|---|---|
| T1 | `projects` | Dự án | Root, owner + dates |
| T2 | `phases` | Giai đoạn | `project_id`, `management_notes`, `blocker_alert` |
| T3 | `bundles` | Hạng mục | `phase_id`, `department_code`, owner = Trưởng phòng |
| T4 | `tasks` | Đầu việc (leaf) | `bundle_id` (bắt buộc), owner = TP phụ trách hoặc NV cùng phòng |

Mỗi bảng hierarchy có `progress_rollup`, tính ở JS qua `recomputeRollup`
(trigger SQLite chỉ cập nhật `updated_at`).

### Sub-resource 1:N

- `daily_logs` — 1 task có N log, mỗi ngày 1 row
  (`UNIQUE(task_id, log_date)` + `ON CONFLICT DO UPDATE` = UPSERT atomic)
- `task_help_messages` — 1 task có N help message, lưu lịch sử escalation

### Bảng phụ trợ

`users` · `departments` · `user_departments` · `audit_log` · `sessions`

### Audit log (Phase D)

Bảng `audit_log` với `old_values`/`new_values` (JSON snapshot) + actor + IP + user agent.
Xoá T4 sẽ snapshot `daily_logs` + `task_help_messages` vào audit trước khi CASCADE.

### State machine + Policy (Phase B)

- `backend/lib/stateMachine.js` — transition hợp lệ (`done` là terminal)
- `backend/lib/policies.js` — **nguồn chuẩn duy nhất cho RBAC**
- 1 endpoint `/api/tasks/:tier/:id`

## 🔐 Phân quyền

**Nguồn chuẩn duy nhất: `backend/lib/policies.js`** — mọi route gọi
`authorize(action, user, ctx)`. Không viết check role rải rác trong handler.

| Role | Quyền |
|---|---|
| `admin` | Toàn quyền |
| `board` (HĐQT) | Xem tất cả; tạo dự án và chọn 1 Điều hành phụ trách |
| `director` (Điều hành) | Xem tất cả; trong dự án mình phụ trách: tạo giai đoạn, tạo hạng mục giao Trưởng phòng, nghiệm thu giai đoạn / dự án |
| `manager` (Trưởng phòng) | Trong hạng mục mình phụ trách: tạo đầu việc cho mình hoặc NV cùng phòng, duyệt, nghiệm thu hạng mục; viết báo cáo tuần |
| `employee` | Làm đầu việc của mình; viết báo cáo tuần |

Báo cáo tuần không có bước duyệt. Cả 4 tầng đính kèm được tệp / ảnh.

> `src/auth/permissions.ts` chỉ dùng để **ẩn/hiện UI**, không phải boundary bảo mật.

## 🚀 Chạy nhanh

```cmd
start-server.bat
```

Mở browser: http://localhost:5173

## 🔐 Tài khoản demo (sau khi seed)

| Username | Password | Role | Phòng ban |
|---|---|---|---|
| `admin` | `admin123` | admin | Tất cả |
| `hung` / `cuong` / `thanh` | `123456` | manager | QLDA / KTTC / TC |
| `hong` / `nguyet` / ... | `123456` | employee | (phòng ban tương ứng) |

Xem chi tiết trong `backend/README.md`.

## 📡 API Endpoints chính

| Endpoint | Method | Mô tả |
|---|---|---|
| `/api/health` | GET | Health check (public) |
| `/api/auth/login` | POST | Username + password → JWT |
| `/api/auth/logout` | POST | Revoke session |
| `/api/auth/change-password` | POST | Đổi mật khẩu (cần mật khẩu cũ) |
| `/api/me` | GET | Thông tin user hiện tại |
| `/api/tasks` | GET | List 4 tier (Gantt view), đã lọc theo role + phòng ban |
| `/api/tasks` | POST | Tạo mới (body chứa `tier` + `parent_id`) |
| `/api/tasks/:tier/:id` | GET | Chi tiết |
| `/api/tasks/:tier/:id` | PATCH | Update (state machine validate) |
| `/api/tasks/:tier/:id` | DELETE | Xoá (admin only) |
| `/api/tasks/:tier/:id/approve` | POST | Manager duyệt (status → done) |
| `/api/tasks/4/:id/toggle` | POST | Owner tick: pending → doing → pending_approval |
| `/api/tasks/4/:id/toggle-today` | POST | Bật/tắt cờ "việc hôm nay" |
| `/api/tasks/4/:id/blocker` | POST | NV ghi blocker_note + lưu lịch sử help message |
| `/api/tasks/4/:id/help-messages` | GET | Lịch sử escalation |
| `/api/tasks/4/:id/help-messages/:msgId/resolve` | POST | Manager đánh dấu đã xử lý |
| `/api/tasks/:taskId/logs` | GET/POST | Nhật ký công việc của 1 task |
| `/api/daily-logs` | GET | Toàn bộ nhật ký (cho Báo cáo) |
| `/api/daily-logs/:id` | DELETE | Xoá log (admin/manager) |
| `/api/users` | GET | Danh bạ user (admin/manager) |
| `/api/users/:username` | GET | Chi tiết user |
| `/api/team-members` | GET | Derived team workload |
| `/api/history` | GET | Audit log |

> `tier` ∈ `1`(project) `2`(phase) `3`(bundle) `4`(task). Backend dispatch theo tier.
> Chi tiết quyền từng endpoint: xem `backend/README.md`.

## 🧪 Dev workflow

```bash
# Backend (terminal 1)
cd backend
npm run dev       # bootstrap DB nếu chưa có
npm run seed      # (optional) insert data demo

# Frontend (terminal 2)
npm run dev       # Vite dev server
```

## 📁 Cấu trúc dự án (sau refactor)

```
web-phan-cong/
├── backend/
│   ├── server.js                  # Express entry
│   ├── db.js                      # node:sqlite + stmt cache
│   ├── lib/
│   │   ├── policies.js            # ★ Nguồn chuẩn RBAC
│   │   └── stateMachine.js        # Status transitions
│   ├── middleware/
│   │   ├── auth.js                # JWT + session
│   │   └── rbac.js                # Role gates (delegate về policies)
│   ├── routes/
│   │   ├── auth.js
│   │   ├── users.js
│   │   ├── tasks.js               # Unified 4-tier
│   │   ├── dailyLogs.js
│   │   ├── teamMembers.js
│   │   └── history.js
│   ├── sql/
│   │   └── schema.sql             # 11 bảng, 26 index, 5 trigger
│   ├── scripts/
│   │   └── seed.ts                # 11 users + 4 phòng ban + cây 4 tầng
│   └── utils/
│       └── permissions.js         # ⚠️ Shim deprecated → lib/policies.js
├── src/
│   ├── App.tsx                    # Main shell
│   ├── main.tsx
│   ├── auth/                      # AuthContext + permissions (chỉ ẩn/hiện UI)
│   ├── components/                # 13 components (Gantt, Drawer, Modals, etc.)
│   ├── data/users.ts              # SEED_USERS fallback
│   ├── lib/                       # apiClient (DTO types), transforms, constants
│   └── types.ts
└── package.json
```

## 🚫 Chưa có

- **Xuất PDF/Excel** — nút đã gỡ (Phase H). `ExportModal.tsx` chỉ còn `export {}`.
  Nếu cần export thật, viết mới với `jspdf`/`xlsx` (FE) hoặc `pdfkit`/`exceljs` (BE).
- **Test tự động** — chưa có test file nào (`test/`, `e2e/` đều gitignore).
- **Refresh token** — token hết hạn sau 7 ngày thì phải đăng nhập lại.

## 📝 Lưu ý cho production

1. **Đổi JWT_SECRET** trong `backend/.env` (mặc định dev)
2. **CORS allowlist** — hiện `origin: true` (cho phép tất cả) — nên giới hạn theo domain thật
3. **Rate limit** cho `/api/auth/login` và `/api/auth/change-password`
4. **Backup DB** thường xuyên (file SQLite trong `backend/database.db`)
5. **HTTPS** phải đứng sau reverse proxy (nginx/Caddy)
6. **Process manager** (PM2/systemd) để auto-restart
