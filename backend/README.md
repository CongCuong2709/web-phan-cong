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
| `/api/tasks/:tier/:id/approve` | POST | `task:approve` (TP phụ trách / admin) |
| `/api/tasks/:tier/:id/toggle` | POST | `task:toggle` (owner/admin) |
| `/api/tasks/:tier/:id/toggle-today` | POST | `task:edit` (chỉ T4) |
| `/api/tasks/:tier/:id/blocker` | POST | `task:edit` (chỉ T4) |
| `/api/tasks/:tier/:id/help-messages` | GET | `task:read` (chỉ T4) |
| `/api/tasks/:tier/:id/help-messages/:msgId/resolve` | POST | `task:approve` (chỉ T4) |

> Khi POST/PATCH, cha được truyền bằng `parent_id` (numeric id của bảng cha theo tier).
> T2→project, T3→phase, T4→bundle (T4 có thể `null` = task độc lập).

### Sub-resource + danh mục

| Endpoint | Method | Quyền |
|---|---|---|
| `/api/tasks/:taskId/logs` | GET | All authed |
| `/api/tasks/:taskId/logs` | POST | `daily_log:create` |
| `/api/daily-logs` | GET | All authed (cho Báo cáo) |
| `/api/daily-logs/:id` | DELETE | admin, Trưởng phòng |
| `/api/users` | GET | `user:list` (mọi vai trò trừ employee) |
| `/api/users/:username` | GET | `user:read` |
| `/api/team-members` | GET | All authed (derived workload) |
| `/api/history` | GET | `history:read_all` (admin/board/director) hoặc truy vấn theo `entity_type`+`entity_id` |

## 🔐 Phân quyền — nguồn chuẩn duy nhất

`lib/policies.js` là **nguồn chuẩn duy nhất** cho mọi quyết định RBAC.
Route handler gọi `authorize(action, user, ctx)` — không viết check role rải rác.

Phân quyền theo **người phụ trách** (`owner_user_id`) của từng tầng, không theo phòng ban.
"Trưởng phòng" là chức vụ trong phòng (`user_departments.is_head` → `user.head_of`), không phải
cấp bậc: một Điều hành có thể kiêm Trưởng phòng (KhanhNH kiêm trưởng Ban QLDA).
Mỗi row trả về mang sẵn `project_owner_user_id` (mọi tầng) và `bundle_owner_user_id` (T4).

| Action | Quy tắc |
|---|---|
| `task:create` | T1: board (HĐQT) · T2, T3: Điều hành phụ trách dự án · T4: Trưởng phòng phụ trách hạng mục |
| `task:assign` | T1 → 1 director · T3 → Trưởng phòng của phòng hạng mục (`head_of`, mọi cấp bậc) · T4 → chính TP phụ trách hoặc employee cùng phòng |
| `task:reassign` | T1: board · T3: Điều hành phụ trách · T4: TP phụ trách · T2 đi theo dự án |
| `task:edit` | T1: board, Điều hành phụ trách · T2, T3: Điều hành phụ trách · T4: TP phụ trách, người làm |
| `task:close` | T3: TP phụ trách · T2, T1: Điều hành phụ trách |
| `task:approve` | TP phụ trách hạng mục chứa việc |
| `task:archive` | T1: board, Điều hành phụ trách · T2: Điều hành phụ trách |
| `task:attach` | T1–T3: như `task:edit` · T4: người giao, TP phụ trách |
| `task:delete` | admin only |
| `task:toggle` | người làm hoặc admin |
| `task:read` | board/director: tất cả · Trưởng phòng: T1–T3 tất cả, T4 trong hạng mục / phòng mình làm trưởng / của mình · employee: T4 của mình |
| `daily_log:create` | người làm, TP phụ trách |
| `user:list` / `user:read` | board/director tất cả · Trưởng phòng trong phòng mình · employee thường: không |
| `history:read_all` | admin/board/director |
| `weekly_report:write` | employee (kể cả Trưởng phòng cấp nhân viên); director kiêm Trưởng phòng không viết |
| `weekly_report:read` | board/director tất cả · Trưởng phòng trong phòng mình · chính mình |

admin luôn được phép. State machine (`lib/stateMachine.js`) là ranh giới riêng cho **status**:
`done` là terminal; admin, Điều hành phụ trách (T1–T3), TP phụ trách (T3, T4) đổi tự do;
người làm chỉ được `pending→doing`, `doing→pending_approval`, `doing→blocked`, `blocked→pending`.

## 🔐 Tài khoản demo (sau khi seed)

| Username | Password | Cấp bậc | Phòng (★ = Trưởng phòng) |
|---|---|---|---|
| `admin` | `admin123` | admin | Tất cả |
| `DungDN` | `123456` | board (HĐQT) | HDQT |
| `DungDA` | `123457` | board (HĐQT) | HDQT |
| `KhanhNH` | `123456` | director (phụ trách DA-68, DA-69) | DH, QLDA ★ |
| `HaLT` / `HongNN` / `HungNV` | `123456` | employee | QLDA |
| `CuongNC` | `123456` | employee (Thu mua) | KTTM ★ |
| `HangNT` / `TuBQ` | `123456` | employee | KTTM |
| `NamNH` | `123456` | employee (Nhân sự) | NS ★ |
| `NguyetDTA` / `NhiNT` | `123456` | employee | NS |
| `ThanhNX` | `123456` | employee (Ban chỉ huy) | BCT ★ |
| `HaiNS` / `LongDN` / `ThaoNV` / `NgocVT` | `123456` | employee | BCT |

Đăng nhập không phân biệt hoa thường (`khanhnh` cũng được).

`npm run seed` tạo tài khoản + dữ liệu mẫu; `npm run seed:accounts` (hoặc `start-dev.bat /accounts`)
chỉ tạo phòng ban + tài khoản, không có dự án.

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