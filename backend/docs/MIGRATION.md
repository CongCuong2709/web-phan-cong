# Migration plan: localStorage → SQLite

## Quy trình 3 giai đoạn

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  PHASE 1 (Hôm nay)  │     │ PHASE 2 (1-2 ngàyue)│     │ PHASE 3 (3-5 ngày)  │
│  Dual-write         │ ──► │  Backend only        │ ──► │  Multi-user prod    │
│                     │     │                     │     │                     │
│ • App ghi cả local  │     │ • Bỏ localStorage   │     │ • JWT + refresh     │
│   + gọi API        │     │ • Chỉ dùng API      │     │ • Rate limit        │
│ • Sync nền async    │     │ • Cache offline?    │     │ • Audit log đầy đủ  │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

---

## Phase 1 — Dual-write (bước đầu)

Trong Phase 1, frontend **vẫn dùng localStorage làm source of truth** nhưng mỗi khi thay đổi state, **đồng thời gọi API để sync lên backend**. Nếu API lỗi → vẫn dùng localStorage (graceful degradation).

### Wrapper đề xuất

```ts
// src/lib/apiClient.ts (mới)
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function apiRequest<T>(
  method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE',
  path: string,
  body?: unknown
): Promise<T | null> {
  try {
    const token = localStorage.getItem('mvp_token');
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      console.warn(`[API] ${method} ${path} failed: ${res.status}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn(`[API] ${method} ${path} error:`, err);
    return null;
  }
}

// Helper riêng cho từng action
export const api = {
  createTierItem:  (item)      => apiRequest('POST', '/api/tier-items', item),
  updateTierItem:  (id, item)  => apiRequest('PATCH', `/api/tier-items/${id}`, item),
  addDailyLog:     (subId, log)=> apiRequest('POST', `/api/subtasks/${subId}/logs`, log),
  approveTask:     (id)        => apiRequest('POST', `/api/team-tasks/${id}/approve`),
  resolveHelp:      (id)        => apiRequest('POST', `/api/team-tasks/${id}/resolve`),
  sendHelpRequest: (req)       => apiRequest('POST', '/api/help-requests', req),
  logHistory:      (entry)     => apiRequest('POST', '/api/history', entry),
};
```

### App.tsx patch pattern (mỗi handler)

```ts
// Trước (chỉ localStorage)
const handleUpdateTierItem = (updated: TierItem) => {
  const newItems = tierItems.map((i) => i.id === updated.id ? updated : i);
  setTierItems(recalculateRollup(newItems));
  // ...
};

// Sau (dual-write)
const handleUpdateTierItem = (updated: TierItem) => {
  const newItems = tierItems.map((i) => i.id === updated.id ? updated : i);
  setTierItems(recalculateRollup(newItems));
  api.updateTierItem(updated.id, updated);  // fire-and-forget
  logHistory('task', updated.id, `...`);
};
```

⚠️ **Quan trọng**: Dual-write không đảm bảo consistency tuyệt đối. Đây là **trade-off có chủ đích** để tăng tốc ship MVP. Phase 3 mới enforce strict consistency.

---

## Phase 2 — Backend only

Sau khi backend ổn định (~1-2 ngày):

```ts
// src/lib/state.ts (mới)
// Thay vì useState<TierItem[]>, dùng React Query / SWR:
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useTierItems() {
  return useQuery({
    queryKey: ['tier-items'],
    queryFn: () => fetch(`${API_BASE}/api/tier-items`).then(r => r.json()),
    staleTime: 30_000,
  });
}
```

Toàn bộ code `localStorage.setItem(...)` được **xoá**. App load → call API → render.

---

## Phase 3 — Production hardening

- JWT access token (15 phút) + refresh token (7 ngày, httpOnly cookie)
- Rate limit cho `/api/auth/login` (5 attempts / 15 phút / IP)
- HTTPS only
- Audit log đầy đủ (mọi thay đổi ghi vào `history_entries`)
- Backup SQLite hàng ngày (cron script)

---

## Migration script từ localStorage seed data

```ts
// backend/scripts/seed-from-frontend.ts
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import {
  CONSTRUCTION_TIER_ITEMS,
  CONSTRUCTION_TEAM_MEMBERS,
  CONSTRUCTION_SUBTASKS,
  CONSTRUCTION_DAILY_LOGS,
  CONSTRUCTION_HISTORY,
  CONSTRUCTION_TEAM_LEAD_TASKS,
  CONSTRUCTION_EMPLOYEE_TASKS,
} from '../src/data/constructionData';
import { SEED_USERS } from '../src/data/users';

const db = new Database('database.db');
db.pragma('foreign_keys = ON');

const insert = db.transaction(() => {
  // 1. Departments
  // (đã có trong schema.sql)

  // 2. Users
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, fullname, email, role, initial, avatar_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertUserDept = db.prepare(`
    INSERT OR IGNORE INTO user_departments (user_id, department_code) VALUES (?, ?)
  `);
  const userIdMap = new Map<string, number>();
  for (const u of SEED_USERS) {
    const hash = bcrypt.hashSync(u.password, 10);
    const info = insertUser.run(u.username, hash, u.fullname, u.email ?? null,
      u.role, u.initial ?? null, u.avatar ?? null);
    userIdMap.set(u.username, Number(info.lastInsertRowid));
    for (const dept of u.departments) insertUserDept.run(info.lastInsertRowid, dept);
  }

  // 3. Tier items (2-pass: T1 trước → T2 → T3 → T4 vì parent_id FK)
  const insertTier = db.prepare(`
    INSERT INTO tier_items (id, code, tier, title, parent_id, department_code,
      owner_user_id, deadline, progress, status, priority, description,
      management_notes, start_week, end_week, gantt_label, gantt_bar_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // TierItem.id là string 'tier-item-XXX' → map sang INTEGER ID mới
  const tierIdMap = new Map<string, number>();
  const sorted = [...CONSTRUCTION_TIER_ITEMS].sort((a, b) => a.tier - b.tier);
  for (const t of sorted) {
    const parentId = t.parentId && tierIdMap.has(t.parentId)
      ? tierIdMap.get(t.parentId) : null;
    const ownerId = t.ownerUsername ? userIdMap.get(t.ownerUsername) ?? null : null;
    const info = insertTier.run(
      null, t.code, t.tier, t.title, parentId, t.department ?? null,
      ownerId, t.deadline, t.progress, t.status, t.priority, t.description,
      t.managementNotes, t.gantt.startWeek, t.gantt.endWeek,
      t.gantt.label ?? null, t.gantt.barColor ?? null
    );
    tierIdMap.set(t.id, Number(info.lastInsertRowid));
  }

  // 4. Deliverables
  const insertDeliv = db.prepare(`
    INSERT INTO deliverables (tier_item_id, title, completed) VALUES (?, ?, ?)
  `);
  for (const t of CONSTRUCTION_TIER_ITEMS) {
    if (!tierIdMap.has(t.id) || !t.deliverables?.length) continue;
    for (const d of t.deliverables) {
      insertDeliv.run(tierIdMap.get(t.id), d.title, d.completed ? 1 : 0);
    }
  }

  // 5. Subtasks + Daily logs
  const insertSub = db.prepare(`
    INSERT INTO subtasks (tier_item_id, name, description, assignee_user_id,
      start_date, end_date, progress, status, priority, results)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const subtaskIdMap = new Map<string, number>();
  for (const s of CONSTRUCTION_SUBTASKS) {
    const assignee = s.assigneeUsername ? userIdMap.get(s.assigneeUsername) ?? null : null;
    const info = insertSub.run(
      tierIdMap.get(s.taskId) ?? null, s.name, s.description ?? null,
      assignee, s.startDate, s.endDate, s.progress, s.status, s.priority,
      s.results ?? null
    );
    subtaskIdMap.set(s.id, Number(info.lastInsertRowid));
  }

  const insertLog = db.prepare(`
    INSERT INTO daily_logs (subtask_id, log_date, description, result, obstacle,
      progress, author_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of CONSTRUCTION_DAILY_LOGS) {
    insertLog.run(
      subtaskIdMap.get(l.subtaskId) ?? null,
      l.logDate, l.description, l.result ?? null, l.obstacle ?? null,
      l.progress, userIdMap.get(l.username) ?? null
    );
  }

  // 6. History
  const insertHist = db.prepare(`
    INSERT INTO history_entries (entity_type, entity_id, action,
      author_username, author_fullname) VALUES (?, ?, ?, ?, ?)
  `);
  for (const h of CONSTRUCTION_HISTORY) {
    insertHist.run(h.entityType, 0, h.action, h.username, h.userName);
  }

  // 7. Team lead tasks
  const insertTLT = db.prepare(`
    INSERT INTO team_lead_tasks (code, title, deliverable_type, deliverable_text,
      owner_user_id, department_code, submitted_at, deadline, status, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const t of CONSTRUCTION_TEAM_LEAD_TASKS) {
    insertTLT.run(
      t.code, t.title, t.deliverableType, t.deliverableText,
      userIdMap.get(t.ownerUsername ?? '') ?? null,
      t.department ?? null, t.submittedAt, t.deadline ?? null,
      t.status, t.priority ?? null
    );
  }

  // 8. Employee tasks
  const insertET = db.prepare(`
    INSERT INTO employee_tasks (code, bundle_name, title, description, deadline,
      status, owner_user_id, department_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const t of CONSTRUCTION_EMPLOYEE_TASKS) {
    insertET.run(
      t.code, t.bundleName, t.title, t.description, t.deadline, t.status,
      userIdMap.get(t.ownerUsername ?? '') ?? null, t.department ?? null
    );
  }
});

insert();
console.log('✅ Migration complete:');
console.log(`   ${db.prepare('SELECT COUNT(*) as c FROM users').get()}`);
console.log(`   ${db.prepare('SELECT COUNT(*) as c FROM tier_items').get()}`);
console.log(`   ${db.prepare('SELECT COUNT(*) as c FROM subtasks').get()}`);
console.log(`   ${db.prepare('SELECT COUNT(*) as c FROM daily_logs').get()}`);
db.close();
```

---

## API endpoints cần thiết (gợi ý cho Express)

```
POST   /api/auth/login              → {token, user}
POST   /api/auth/logout             → 204
POST   /api/auth/refresh            → {token}
GET    /api/me                      → User hiện tại

GET    /api/users                   → [User]   (admin only)
GET    /api/users/:username         → User
PATCH  /api/users/:id               → Update profile (admin only)

GET    /api/departments             → [Department]

GET    /api/tier-items              → [TierItem] (filtered theo role)
POST   /api/tier-items              → Create
PATCH  /api/tier-items/:id          → Update
DELETE /api/tier-items/:id          → Admin only

GET    /api/tier-items/:id/deliverables → [Deliverable]
POST   /api/tier-items/:id/deliverables → Create
PATCH  /api/deliverables/:id
DELETE /api/deliverables/:id

GET    /api/tier-items/:id/subtasks → [SubTask]
POST   /api/tier-items/:id/subtasks → Create
PATCH  /api/subtasks/:id
DELETE /api/subtasks/:id

GET    /api/subtasks/:id/logs       → [DailyLog]
POST   /api/subtasks/:id/logs       → Create (check ownership)

GET    /api/team-tasks              → [TeamLeadTask]
POST   /api/team-tasks
PATCH  /api/team-tasks/:id
POST   /api/team-tasks/:id/approve  → Manager action
POST   /api/team-tasks/:id/resolve  → Manager action

GET    /api/employee-tasks          → [EmployeeTask] (filtered theo user)
POST   /api/employee-tasks
PATCH  /api/employee-tasks/:id
POST   /api/employee-tasks/:id/notes

GET    /api/help-requests           → Manager: all; Employee: their own
POST   /api/help-requests
POST   /api/help-requests/:id/resolve

GET    /api/history/:entityType/:entityId → [HistoryEntry]
GET    /api/messages                → Inbox
POST   /api/messages

GET    /api/attachments/:ownerType/:ownerId → [Attachment]
POST   /api/upload                  → Multipart upload → returns attachment
```

---

## Tổng kết effort

| Phase | Thời gian | Output |
|---|---|---|
| **1. Dual-write** | 0.5 ngày | App chạy cả 2 nguồn, không vỡ nếu backend down |
| **2. Backend-only** | 1 ngày | Bỏ localStorage, dùng React Query/SWR |
| **3. Production** | 2-3 ngày | JWT refresh, rate limit, audit log |
| **Migration script** | 0.5 ngày | Seed DB từ constructionData.ts |
| **API endpoints** | 1-2 ngày | Express handlers + RBAC middleware |

**Tổng**: ~5-7 ngày để có production-ready backend.