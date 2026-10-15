# Hệ thống công việc và báo cáo TAG

Hệ thống công việc và báo cáo TAG — điều phối công việc nhóm và quản lý tiến độ theo cấp.

**Stack**:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4
- **Backend**: Express + `node:sqlite` (built-in Node 22.5+) + `bcryptjs` + RBAC

## 🏗️ Kiến trúc (Phase C — refactor toàn diện 2026-10)

### Schema: 4 bảng hierarchy chuẩn hoá

| Tier | Bảng | Vai trò | Đặc trưng |
|---|---|---|---|
| T1 | `projects` | Dự án | Root, owner + dates |
| T2 | `phases` | Giai đoạn | `project_id`, `management_notes`, `blocker_alert` |
| T3 | `bundles` | Hạng mục | `phase_id` |
| T4 | `tasks` | Đầu việc (leaf) | `bundle_id` (nullable), `is_today`, owner = NV |

Mỗi bảng có `progress_rollup` tự động cập nhật khi children đổi.

### Sub-resource 1:N (thay vì inline columns)

- `task_deliverables` (1 task có N deliverables)
- `task_help_messages` (1 task có N help messages, lưu lịch sử)
- `subtasks` + `daily_logs`
- `task_notes`

### Audit log (Phase D)

Bảng `audit_log` với `old_values`/`new_values` (JSON snapshot) + actor + IP + user agent.

### State machine + Policy (Phase B)

- `backend/lib/stateMachine.js` — transition hợp lệ
- `backend/lib/policies.js` — centralized RBAC
- 1 endpoint `/api/tasks/:tier/:id`

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
| `/api/auth/login` | POST | Username + password → JWT |
| `/api/tasks` | GET | List 4 tier (Gantt view) |
| `/api/tasks/:tier/:id` | GET | Chi tiết (kèm subtasks, notes, deliverables, helpMessages) |
| `/api/tasks` | POST | Tạo mới (body chứa `tier`) |
| `/api/tasks/:tier/:id` | PATCH | Update (state machine validate) |
| `/api/tasks/:tier/:id/approve` | POST | Manager duyệt (status → done) |
| `/api/tasks/4/:id/toggle` | POST | Owner tick doing ↔ done |
| `/api/tasks/4/:id/help` | POST | NV gửi help request |
| `/api/users` | GET | List users (admin/manager) |
| `/api/team-members` | GET | Derived team workload |
| `/api/help-requests` | GET/POST | Help inbox |
| `/api/history` | GET | Audit log |

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
│   │   ├── stateMachine.js        # Status transitions
│   │   └── policies.js            # Centralized RBAC
│   ├── middleware/
│   │   ├── auth.js                # JWT + session
│   │   └── rbac.js                # Legacy role gate
│   ├── routes/
│   │   ├── auth.js
│   │   ├── users.js
│   │   ├── tasks.js               # Unified 4-tier
│   │   ├── subtasks.js
│   │   ├── teamMembers.js
│   │   ├── helpRequests.js
│   │   └── history.js
│   ├── sql/
│   │   └── schema.sql             # 17 tables, 6 triggers
│   ├── scripts/
│   │   └── seed.ts                # 11 users + 1 project hierarchy
│   └── utils/permissions.js
├── src/
│   ├── App.tsx                    # Main shell
│   ├── main.tsx
│   ├── auth/                      # AuthContext + permissions
│   ├── components/                # 13 components (Gantt, Drawer, Modals, etc.)
│   ├── data/users.ts              # SEED_USERS fallback
│   ├── lib/                       # apiClient, transforms, constants
│   └── types.ts
└── package.json
```

## 📝 Lưu ý cho production

1. **Đổi JWT_SECRET** trong `backend/.env` (mặc định dev)
2. **CORS allowlist** — hiện `origin: true` (cho phép tất cả) — nên giới hạn theo domain thật
3. **Rate limit** cho `/api/auth/login` và `/api/auth/change-password`
4. **Backup DB** thường xuyên (file SQLite trong `backend/database.db`)
5. **HTTPS** phải đứng sau reverse proxy (nginx/Caddy)
6. **Process manager** (PM2/systemd) để auto-restart
