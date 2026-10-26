# Backend — Hướng dẫn sử dụng

Backend API cho 4-Tier Enterprise Execution System.

**Stack**: Express + `node:sqlite` (built-in) + `bcryptjs` (pure JS) + JWT.

> ✅ **Zero native compilation** — npm install không cần build tools / Python / MSVC.
> Có thể cài đặt trên bất kỳ môi trường Node nào ≥ 22.5.0.

## 📋 Yêu cầu

- **Node.js ≥ 22.5.0** (cho `node:sqlite`)
- **Node 22.5–22.12**: cần flag `--experimental-sqlite` (khuyến nghị upgrade)
- **Node ≥ 22.13** (LTS/24): native, không cần flag

Check version:
```bash
node --version
```

## 🚀 Cài đặt & Chạy

```bash
cd backend
npm install          # Cài Express + JWT + bcryptjs + tsx + types

# Copy env (optional, defaults OK cho dev)
cp .env.example .env  # Unix
copy .env.example .env  # Windows

# Bootstrap DB (lần đầu: tạo database.db + áp dụng schema)
npm run dev
# Ctrl+C sau khi thấy "Backend ready"

# Seed data
npm run seed

# Chạy lại
npm run dev
```

## 🧪 Test nhanh với curl

```bash
# Health
curl http://localhost:3001/api/health

# Login (sau khi seed)
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

# Gọi API có auth
curl http://localhost:3001/api/me -H "Authorization: Bearer $TOKEN"
curl http://localhost:3001/api/tasks -H "Authorization: Bearer $TOKEN"
```

## 📡 API Endpoints

### Auth

| Endpoint | Method | Auth | Quyền |
|---|---|---|---|
| `/api/health` | GET | — | Public |
| `/api/auth/login` | POST | — | Public |
| `/api/auth/logout` | POST | ✓ | Auth |
| `/api/auth/change-password` | POST | — | Public (cần mật khẩu cũ) |
| `/api/me` | GET | ✓ | All authed |

### Tasks — unified 4-tier

Một endpoint duy nhất `/api/tasks`, dispatch theo `tier`:
`1=projects`, `2=phases`, `3=bundles`, `4=tasks`.

| Endpoint | Method | Quyền |
|---|---|---|
| `/api/tasks` | GET | Theo role + department (`canSee`) |
| `/api/tasks/:tier/:id` | GET | `task:read` |
| `/api/tasks` | POST | `task:create` (role-based tier guard) |
| `/api/tasks/:tier/:id` | PATCH | `task:edit` + state machine |
| `/api/tasks/:tier/:id` | DELETE | `task:delete` (admin only) |
| `/api/tasks/:tier/:id/approve` | POST | `task:approve` (manager/admin) |
| `/api/tasks/:tier/:id/toggle` | POST | `task:toggle` (owner/admin) |
| `/api/tasks/:tier/:id/toggle-today` | POST | `task:edit` (chỉ T4) |
| `/api/tasks/:tier/:id/blocker` | POST | `task:edit` (chỉ T4) |
| `/api/tasks/:tier/:id/help-messages` | GET | `task:read` (chỉ T4) |
| `/api/tasks/:tier/:id/help-messages/:msgId/resolve` | POST | `task:edit` + admin/manager (chỉ T4) |

> Khi POST/PATCH, cha được truyền bằng `parent_id` (numeric id của bảng cha theo tier).
> T2→project, T3→phase, T4→bundle (T4 có thể `null` = task độc lập).

### Sub-resource + danh mục

| Endpoint | Method | Quyền |
|---|---|---|
| `/api/tasks/:taskId/logs` | GET | All authed |
| `/api/tasks/:taskId/logs` | POST | `daily_log:create` |
| `/api/daily-logs` | GET | All authed (cho Báo cáo) |
| `/api/daily-logs/:id` | DELETE | admin/manager |
| `/api/users` | GET | `user:list` (admin/manager) |
| `/api/users/:username` | GET | `user:read` |
| `/api/team-members` | GET | All authed (derived workload) |
| `/api/history` | GET | `history:read_all` (admin/director) hoặc truy vấn theo `entity_type`+`entity_id` |

## 🔐 Phân quyền — nguồn chuẩn duy nhất

`lib/policies.js` là **nguồn chuẩn duy nhất** cho mọi quyết định RBAC.
Route handler gọi `authorize(action, user, ctx)` — không viết check role rải rác.

| Action | Quy tắc |
|---|---|
| `task:create` | admin: T1–T4 · director: T1–T2 · manager: T3–T4 (cùng phòng) · employee: T4 |
| `task:edit` | admin: tất cả · director: không · manager: cùng phòng · employee: T4 của mình |
| `task:delete` | admin only |
| `task:approve` | admin + manager (cùng phòng) |
| `task:toggle` | owner hoặc admin |
| `task:read` | admin/director: tất cả · manager: cùng phòng (+ T1 read-only) · employee: T4 của mình |
| `daily_log:create` | owner task, hoặc manager trong phòng |
| `user:list` / `user:read` | admin/director tất cả · manager trong phòng · employee: không |
| `history:read_all` | admin/director |

State machine (`lib/stateMachine.js`) là ranh giới riêng cho **status**:
`done` là terminal, `blocked` chỉ manager/admin gỡ được, employee chỉ được
`pending→doing`, `doing→pending_approval`, `doing→blocked`, `blocked→pending`.

> `utils/permissions.js` chỉ còn là shim re-export. Import mới phải trỏ thẳng
> về `lib/policies.js`.

## 🔐 Tài khoản demo (sau khi seed)

| Username | Password | Role | Phòng ban |
|---|---|---|---|
| `admin` | `admin123` | admin | Tất cả |
| `khanh` / `nam` | `123456` | director | ĐH |
| `hung` | `123456` | manager | QLDA |
| `cuong` | `123456` | manager | KTTC |
| `thanh` | `123456` | manager | TC |
| `hong` | `123456` | employee | QLDA |
| `nguyet` / `hang` / `tu` | `123456` | employee | KTTC |
| `ngoc` | `123456` | employee | TC |

> ⚠️ Production: đổi tất cả passwords + set `JWT_SECRET` mới trong `.env`.

## 📂 Cấu trúc thư mục

```
backend/
├── server.js                  # Express entry
├── db.js                      # node:sqlite connection + prepared statement cache
├── lib/
│   ├── policies.js            # ★ NGUỒN CHUẨN RBAC — authorize(action, user, ctx)
│   └── stateMachine.js        # Status transitions
├── middleware/
│   ├── auth.js                # JWT verify + session check
│   └── rbac.js                # requireRole / requireTierCreatePermission (delegate về policies)
├── routes/
│   ├── auth.js                # /login /logout /me /change-password
│   ├── users.js               # Danh bạ user (lọc theo role + phòng ban)
│   ├── tasks.js               # Unified 4-tier CRUD + approve/toggle/blocker/help
│   ├── dailyLogs.js           # Nhật ký công việc (UPSERT 1 log/task/ngày)
│   ├── teamMembers.js         # Workload derived
│   └── history.js             # Audit log (read-only)
├── sql/
│   └── schema.sql             # SQLite DDL — 11 bảng, 26 index, 5 trigger
├── scripts/
│   └── seed.ts                # 11 users + 4 phòng ban + cây 4 tầng
└── utils/
    └── permissions.js         # ⚠️ DEPRECATED shim → lib/policies.js
```

## 🛠 Troubleshooting

**`Error: No such module 'node:sqlite'`**
→ Node version < 22.5. Upgrade: `nvm install v22.13` (hoặc v24).

**`Error: SQLITE_BUSY: database is locked`**
→ Đã bật WAL. Nếu vẫn lỗi, restart server.

**`Error: FOREIGN KEY constraint failed`**
→ Khi seed: parent phải insert trước children. Nếu tự viết script, dùng `tx(() => { ... })`.

**Token hết hạn sau 7 ngày**
→ MVP: re-login. Refresh token chưa implement.

**`password_hash` không khớp sau seed**
→ `bcryptjs` và `bcrypt` đều dùng format `$2a$` nên tương thích. Nếu lỗi, chạy `npm run seed` lại.

## 🔄 So sánh với better-sqlite3

| Tính năng | `better-sqlite3` | `node:sqlite` |
|---|---|---|
| Native compilation | ✅ (cần build tools) | ❌ (built-in) |
| `db.prepare()` | ✓ | ✓ |
| `stmt.get/all/run` | ✓ | ✓ |
| `.pragma()` method | ✓ | ❌ dùng `db.exec('PRAGMA ...')` |
| `.transaction()` | ✓ built-in | ❌ tự quản bằng `tx()` helper |
| Foreign keys mặc định | ON | OFF — phải bật |
| WAL mode | ✓ | ✓ |
| Performance | Cực nhanh | Gần tương đương |

## 📝 License

Internal project.