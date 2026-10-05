# Backend — Hướng dẫn sử dụng

Backend API cho 4-Tier Enterprise Execution System.

**Stack**: Express + better-sqlite3 + bcrypt + JWT.

## 🚀 Cài đặt & Chạy

```bash
# 1. Cài dependencies
cd backend
npm install

# 2. Copy env template (optional — defaults OK cho dev)
copy .env.example .env   # Windows
# hoặc
cp .env.example .env     # Unix

# 4. Khởi tạo schema (file database.db sẽ được tạo + schema.sql áp dụng)
npm run dev

# 5. Ctrl+C để dừng, rồi seed data
npm run seed

# 6. Chạy lại dev
npm run dev
```

## 🧪 Test nhanh với curl

```bash
# Health check
curl http://localhost:3001/api/health
# → { "ok": true, "time": "..." }

# Login (sau khi seed)
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
# → { "token": "eyJ...", "user": { ... } }

# Lưu token vào biến
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

Xem chi tiết trong [`backend/docs/MIGRATION.md`](./docs/MIGRATION.md).

| Endpoint | Method | Auth | Quyền |
|---|---|---|---|
| `/api/health` | GET | — | Public |
| `/api/auth/login` | POST | — | Public |
| `/api/auth/logout` | POST | ✓ | Auth |
| `/api/me` | GET | ✓ | Admin+ |
| `/api/users` | GET | ✓ | Admin / Manager |
| `/api/users/:username` | GET | ✓ | Admin / Manager (in dept) |
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
├── db.js                   ← DB connection + prepared cache
├── package.json
├── .env.example
├── sql/
│   └── schema.sql          ← SQLite DDL
├── scripts/
│   └── seed.ts             ← Import seed data từ frontend
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

**`Error: Cannot find module 'better-sqlite3'`**  
→ Chạy `npm install` trong `backend/`.

**`Error: SQLITE_BUSY: database is locked`**  
→ Bật WAL mode (đã có trong `db.js`). Nếu vẫn lỗi, restart server.

**`Error: FOREIGN KEY constraint failed`**  
→ Khi seed: thứ tự insert đúng (T1 → T4, parent trước children). Nếu tự insert, dùng `db.transaction(...)`.

**Token hết hạn sau 7 ngày**  
→ MVP: re-login. Phase 3 sẽ có refresh token.

## 📝 License

Internal project.