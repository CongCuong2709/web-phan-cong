# Hệ thống công việc và báo cáo TAG

Hệ thống công việc và báo cáo TAG — điều phối công việc nhóm và quản lý tiến độ theo cấp.

**Stack**:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4
- **Backend**: Express + `node:sqlite` (built-in Node 22.5+) + `bcryptjs` + RBAC

---

## 🚀 Chạy nhanh (1-click trên Windows)

```cmd
start-server.bat
```

Script sẽ tự động:
1. ✅ Khởi động **backend** (Express + SQLite) ở `http://localhost:3000`
2. ✅ Khởi động **frontend** (Vite + React) ở `http://localhost:5173`
3. ✅ Mở browser tới web app

**Bấm phím bất kỳ trong cửa sổ launcher để tắt tất cả servers.**

> ⚠️ Yêu cầu: Node.js **≥ 22.5.0** (cho `node:sqlite` built-in). Tải từ https://nodejs.org

---

## 📂 Cấu trúc dự án

```
web-phan-cong/
├── start-server.bat          ← Master launcher 1-click (root)
├── src/                      ← Frontend (React + Vite)
├── backend/
│   ├── start-dev.bat         ← Backend launcher riêng (advanced)
│   ├── server.js             ← Express entry point
│   ├── db.js                 ← node:sqlite connection
│   ├── routes/               ← 9 route modules (auth, users, tier-items, ...)
│   ├── middleware/           ← JWT auth + RBAC
│   ├── sql/schema.sql        ← SQLite DDL
│   ├── scripts/seed.ts       ← Import seed data từ frontend
│   └── README.md             ← Hướng dẫn backend chi tiết
└── README.md                 ← File này
```

---

## 🛠️ Chạy thủ công (nếu cần debug)

### Terminal 1 — Backend
```bash
cd backend
start-dev.bat /seed         # lần đầu: tạo DB + insert 11 users + 53 tier items
# hoặc
start-dev.bat               # các lần sau: chỉ start server
```

### Terminal 2 — Frontend
```bash
npm run dev
```

Mở browser: http://localhost:5173

---

## 🔐 Tài khoản demo

| Username | Role | Phòng ban | Mật khẩu |
|---|---|---|---|
| `admin` | admin | Tất cả | `admin123` |
| `khanh` | director | ĐH | `123456` |
| `nam` | director | ĐH | `123456` |
| `hung` | manager | QLDA | `123456` |
| `cuong` | manager | KTTC | `123456` |
| `thanh` | manager | TC | `123456` |
| `hong` | employee | QLDA | `123456` |
| `nguyet` | employee | KTTC | `123456` |
| `hang` | employee | KTTC | `123456` |
| `tu` | employee | KTTC | `123456` |
| `ngoc` | employee | TC | `123456` |

> ⚠️ Production: đổi passwords + set `JWT_SECRET` mới trong `backend/.env`.

---

## 📡 API Endpoints (34 endpoints)

Xem chi tiết trong [`backend/README.md`](backend/README.md).

Highlights:
- `POST /api/auth/login` → JWT token
- `GET/POST/PATCH/DELETE /api/tier-items`
- `GET/POST /api/tier-items/:id/deliverables`
- `GET/POST/PATCH /api/tier-items/:id/subtasks`
- `GET/POST /api/subtasks/:id/logs`
- `GET/POST /api/team-tasks` (giao việc nhóm)
- `GET/POST /api/employee-tasks` (việc cá nhân)
- `GET/POST /api/help-requests`
- `GET /api/history` (audit log)

---

## 🐛 Troubleshooting

| Lỗi | Cách sửa |
|---|---|
| `node:sqlite not found` | Upgrade Node ≥ 22.5 |
| `Port 3000 already in use` | Chạy `taskkill /f /im node.exe` rồi thử lại |
| `Port 5173 already in use` | Đổi port Vite: `npm run dev -- --port 5174` |
| Browser không mở | Mở thủ công: http://localhost:5173 |
| Backend không ready | Xem cửa sổ "Backend - TAG API" |

---

## 📝 Notes khác

File này gốc là template của AI Studio (Google AI Studio). Đã được customize cho hệ thống TAG với backend riêng.

Original instructions:
1. Install dependencies: `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key (không cần cho MVP)
3. Run the app: `npm run dev` (chỉ chạy frontend; backend riêng)

View the original AI Studio app: https://ai.studio/apps/d3ccf3cd-49a9-40c1-a40c-5ecdfef177d5