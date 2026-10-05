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
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Lưu token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

# Gọi API có auth
curl http://localhost:3001/api/me \
  -H "Authorization: Bearer $TOKEN"

curl http://localhost:3001/api/tier-items \
  -H "Authorization: Bearer $TOKEN"
```

## 📡 API Endpoints

| Endpoint | Method | Auth | Quyền |
|---|---|---|---|
| `/api/health` | GET | — | Public |
| `/api/auth/login` | POST | — | Public |
| `/api/auth/logout` | POST | ✓ | Auth |
| `/api/me` | GET | ✓ | All authed |
| `/api/users` | GET | ✓ | Admin / Manager |
| `/api/users/:username` | GET | ✓ | Admin / Director / Manager (in dept) |
| `/api/tier-items` | GET | ✓ | All roles (filtered) |
| `/api/tier-items/:id` | GET | ✓ | All roles (visible) |
| `/api/tier-items` | POST | ✓ | Admin / Director / Manager (role-based tier guard) |
| `/api/tier-items/:id` | PATCH | ✓ | Owner + RBAC check |
| `/api/tier-items/:id` | DELETE | ✓ | Admin only |

## 🔐 Tài khoản demo (sau khi seed)

| Username | Password | Role | Phòng ban |
|---|---|---|---|
| `admin` | `admin123` | admin | Tất cả |
| `khanh` | `123456` | director | ĐH |
| `nam` | `123456` | director | ĐH |
| `hung` | `123456` | manager | QLDA |
| `cuong` | `123456` | manager | KTTC |
| `thanh` | `123456` | manager | TC |
| `hong` | `123456` | employee | QLDA |
| `nguyet` | `123456` | employee | KTTC |
| `hang` | `123456` | employee | KTTC |
| `tu` | `123456` | employee | KTTC |
| `ngoc` | `123456` | employee | TC |

> ⚠️ Production: đổi tất cả passwords + set `JWT_SECRET` mới trong `.env`.

## 📂 Cấu trúc thư mục

```
backend/
├── server.js               ← Express entry point
├── db.js                   ← node:sqlite connection + prepared cache
├── package.json
├── .env.example
├── sql/
│   └── schema.sql          ← SQLite DDL
├── scripts/
│   └── seed.ts             ← Import seed data từ frontend (TS + tsx)
├── middleware/
│   ├── auth.js             ← JWT verify + session check
│   └── rbac.js             ← Role gates
├── routes/
│   ├── auth.js             ← /login /logout /me
│   ├── users.js            ← List / get-one
│   └── tierItems.js        ← CRUD + rollup
├── utils/
│   └── permissions.js      ← RBAC helpers (mirror frontend)
└── docs/
    └── MIGRATION.md        ← Kế hoạch 3-phase migration
```

## 🛠️ Troubleshooting

**`Error: No such module 'node:sqlite'`**  
→ Node version < 22.5. Upgrade: `nvm install v22.13` (hoặc v24).

**`Error: SQLITE_BUSY: database is locked`**  
→ Đã bật WAL. Nếu vẫn lỗi, restart server.

**`Error: FOREIGN KEY constraint failed`**  
→ Khi seed: parent phải insert trước children. Nếu tự viết script, dùng `tx(() => { ... })`.

**Token hết hạn sau 7 ngày**  
→ MVP: re-login. Phase 3 sẽ có refresh token.

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