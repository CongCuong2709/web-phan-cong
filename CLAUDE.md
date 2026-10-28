# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Internal task-assignment and progress-reporting system ("Hệ thống công việc và báo cáo TAG"). UI text, comments and docs are in Vietnamese — keep new user-facing strings and comments in Vietnamese to match.

## Commands

Two separate npm projects: the frontend at the repo root, the backend in `backend/`. Each needs its own `npm install`.

```bash
# Frontend (root) — Vite on :5173, proxies /api → http://localhost:3001
npm run dev            # dev:lan to bind 0.0.0.0
npm run build          # → dist/
npm run lint           # tsc --noEmit (this is the only type/lint check)

# Backend (backend/) — Express on :3001, requires Node >= 22.5 (node:sqlite)
npm run dev            # node --watch server.js; creates database.db + applies schema on first run
npm run seed           # tsx scripts/seed.ts — demo users/departments/4-tier tree
```

- `start-server.bat` (root) starts backend + frontend + browser in one go on Windows. `backend/start-dev.bat` **deletes `database.db` by default** unless you pass `/no-clean`; `/seed` and `/reset` also re-seed.
- `reset-db.ps1` deletes `backend/database.db*` so the schema gets bootstrapped again.
- Demo login after seeding: `admin`/`admin123`; every other user is `123456` (managers `hung`/`cuong`/`thanh`, directors `khanh`/`nam`, employees such as `hong`, `nguyet`).
- **There are no automated tests in the repo.** `backend/package.json` has vitest scripts, but `test/`, `*.test.*`, `vitest.config.ts`, `e2e/` and `*.mjs` are all gitignored, so `seed:test`, `migrate` and `reset:db` point at untracked files. Check the behaviour by running the app or curling the API (`backend/README.md` has curl examples).

## Architecture

### Data model: 4 tiers in 4 tables
`projects` (T1) → `phases` (T2) → `bundles` (T3) → `tasks` (T4, leaf; `bundle_id` may be null for standalone tasks). Everything is in `backend/sql/schema.sql`, along with `daily_logs` (one row per task per day, `UNIQUE(task_id, log_date)` + UPSERT), `task_help_messages` (escalation history), `weekly_reports`, `users`/`departments`/`user_departments`, `sessions` and `audit_log` (JSON `old_values`/`new_values` snapshots).

- `progress_rollup` is calculated in JS in `backend/lib/rollup.js`: a parent's value is the plain average of its direct children. Call `recomputeRollup(taskId)` / `rollupFrom(parentTier, parentId)` inside `tx()` whenever a T4's progress changes **or** a child is created or deleted (the daily-log POST counts too). SQLite triggers only update `updated_at`.
- Parent status (T1–T3) only auto-moves `pending → doing` once a child has started. It **never** auto-moves to `pending_approval` or `done`. Closing a parent goes through `POST /approve` (`task:close` policy): T3 needs admin or a manager of **every** department among its tasks (bundles have no department column), T2/T1 need admin or director, and every direct child must already be `done` (otherwise 409). `PATCH` with `status: 'done'` on T1–T3 returns 400 `use_close`.
- Archiving replaces deleting for T1/T2: `projects.archived_at` / `phases.archived_at`, set via `POST /api/tasks/:tier/:id/archive|unarchive` (`task:archive`: admin, director). `GET /api/tasks` adds an inherited `archived` flag to every row; an archived branch is read-only (409 `archived`) and is excluded from rollup, close checks and `/team-members`. The frontend drops archived rows from every view (`liveRows` in `App.tsx`); the Gantt shows them only with `?luutru=1`.
- Dates: use `backend/lib/dates.js` (`today()`), which uses local time. Never use `toISOString().slice(0, 10)`, because that is UTC and logs anything before 7am Vietnam time on the previous day. The server rejects `start_date > end_date` on both create and PATCH (the merged values are checked).
- Schema bootstrap (`backend/db.js`): `schema.sql` is only applied when the DB file is **new**. On an existing DB, `db.js` runs `sql/migration.sql` if it exists, and that file is not tracked. When you change the schema, either reset the DB or write idempotent migration SQL.
- `node:sqlite` differs from better-sqlite3: there is no `.transaction()` (use the `tx(fn)` helper from `db.js`) and no `.pragma()` (use `db.exec('PRAGMA …')`). Prepared statements are cached in the `stmt` object exported from `db.js`; add new queries there.

### API
- One task endpoint for all tiers: `/api/tasks` and `/api/tasks/:tier/:id[/approve|/toggle|/toggle-today|/blocker|/help-messages…]`. Tier is 1–4 and the handler dispatches on it. The parent is passed as `parent_id`. `/api/tier-items`, `/api/team-tasks` and `/api/employee-tasks` are legacy aliases mounted on the same router.
- Manager actions on a T4 task: `/approve` (→ done), `/return` (pending_approval → doing, optional `reason` stored in the audit row) and `/unblock` (clears `blocker_note`, resolves open help messages, blocked → doing). All three use the `task:approve` policy. When the owner of a T4 also passes `task:approve` (manager of that department, or admin), `/toggle` on `doing` goes straight to `done` instead of `pending_approval`, and the UI labels the button "Hoàn thành" instead of "Báo xong". Reassigning and rescheduling go through `PATCH` (`owner_user_id`, `end_date`).
- Conversation thread ("Trao đổi"): `task_help_messages` with a `kind` column (`note`, `blocker`, and one kind per status action). `GET/POST /api/tasks/4/:id/messages`; `/toggle`, `/approve`, `/unblock` accept an optional `note`, `/return` requires `reason`. Each creates a message and returns `message_id`. Messages are never edited or deleted.
- Attachments: `routes/attachments.js` + `lib/attachments.js`. One raw-body request per file (`POST /api/tasks/4/:id/attachments?name=&message_id=`), 25 MB max, extension + magic-byte check, stored under `UPLOAD_DIR` (default `backend/uploads`). Download only via `GET /api/attachments/:id` (needs the bearer token, so the FE fetches a blob). With `with_files: true` on an action, the FE uploads files after the action succeeds, attaching them to the returned `message_id` (`commit(..., attach)` in `App.tsx`). Files in a message cannot be deleted; task-level files can be deleted by their uploader or admin.
- `db.js` runs idempotent upgrades (add column / `CREATE TABLE IF NOT EXISTS`) on every start before preparing statements; keep them in sync with `schema.sql`.
- An employee reporting an obstacle (`/blocker`) only sets `blocker_note` and does **not** change status. "Needs help" therefore means `status === 'blocked' || blocker_note` (`TeamLeadTask.needsHelp`), so never filter on status alone.
- Other routers: `auth`, `users`, `dailyLogs` (mounted at `/api`), `teamMembers`, `history` (audit log), `weeklyReports` (`GET`/`PUT /api/weekly-reports?week=YYYY-MM-DD`, using ISO Monday week start, plus `/history`, `/team` and `/:userId/review`).
- Auth: JWT bearer token (7-day expiry, no refresh token) plus a row in `sessions` (`middleware/auth.js` → `requireAuth`).

### Authorization: one source of truth
- `backend/lib/policies.js` → `authorize(action, user, ctx)` makes every RBAC decision (`task:create|edit|delete|approve|toggle|read`, `daily_log:create`, `user:list|read`, `history:read_all`). Do not put role checks inline in route handlers. `middleware/rbac.js` delegates to this file, and `backend/utils/permissions.js` is a deprecated re-export shim, so new imports should go to `lib/policies.js`.
- `backend/lib/stateMachine.js` is a separate boundary for **status** transitions. `done` is terminal, and only a manager or admin can clear `blocked`. Employees may only move `pending→doing→pending_approval`, `doing→blocked` and `blocked→pending`.
- Roles: `admin` (everything), `director` (creates, edits and archives T1/T2, closes T1/T2; read-only on T3/T4), `manager` (own department, can create T3/T4 and approve), `employee` (only their own T4 tasks).
- `src/auth/permissions.ts` only shows and hides UI. It is not a security boundary, so any rule change must happen in `policies.js`.

### Frontend
- **The server is the only source of truth.** `src/lib/useWorkspaceData.ts` loads `/api/tasks`, `/api/daily-logs` and `/api/team-members` into one raw store with a `loading | ready | error` status. `App.tsx` derives every view's list (`tierItems`, `teamTasks`, `employeeTasks`) from it with `useMemo`. Don't add parallel copies of that data in component state.
- **Writes go through `commit()` in `App.tsx`.** It awaits the API call. On failure it shows `describeApiError()` as an error toast and changes nothing. On success it calls `reload()` and only then shows the success toast. Don't do optimistic updates, don't use temp ids (create calls wait for the real id), and don't swallow errors. Handlers return `Promise<boolean>` (or the saved ids) so views can disable buttons and close modals only on success.
- "Việc của tôi" filters (`?loc=`): `open` (default, not yet reported done), `awaiting` (pending_approval), `done`. These three partition the list. `due` (deadline ≤ today) and `blocked` (blocked or has `blocker_note`) are shortcuts inside `open`. "Today" is based **only on the deadline**. The `is_today` flag and `/toggle-today` endpoint are no longer used by the UI, so don't build on them. Every group is sorted by deadline ascending, so overdue tasks come first.
- Views must not say anything ("không có việc gấp", "đúng hạn"…) until `loadStatus === 'ready'`. Every label must be computed from data. "Overdue" means `end_date < today` and not finished: use `isTierItemOverdue` in `transforms.ts`.
- Tabs (`ActiveAppTab`): `cay-gantt-4-tang` (Gantt4TangView), `giao-viec-nhom` (GiaoViecNhomView), `viec-cua-toi` (ViecCuaToiView, inline daily-log sheet whose drafts persist in sessionStorage via `useSessionState`) and `bao-cao` (BaoCaoTongQuanView plus the weekly report views).
- **Routing** is hash-based (`src/lib/useHashRoute.ts`, no dependency): `#/cay-cong-viec`, `#/giao-viec`, `#/viec-cua-toi`, `#/bao-cao/tuan` and `#/bao-cao/tong-quan`. `App.tsx` reads the route and redirects (replace, not push) when a tab isn't in `visibleTabsFor(user)` (`auth/permissions.ts`). Page changes push a history entry; filters use `setParam` (replace) and live in the query: `loc` (filter), `nv` (member), `thang` (Gantt month `YYYY-MM`, omitted = current month; the Gantt only has a month view, with no quarter or year views), `muc` (item open in the task detail dialog, e.g. `muc=4-12`), `tab` (detail tab of a T4: `trao-doi` default or `lich-su`), `uu` (priority). Use `setParams` to change several keys in one history entry. Views get filter values and change handlers as props instead of keeping filter state themselves.
- `src/lib/apiClient.ts`: `api.*` methods return `ApiResponse` (they never throw), plus typed DTOs that match the real responses. The base URL comes from `VITE_API_URL` (default `http://localhost:3001`). Global `/api/history` is admin/director only, so the task detail dialog loads per-entity history with `api.listEntityHistory`.
- Priority is the DB enum (`critical|high|normal|low`) everywhere in the FE; labels come from `PRIORITY_VI`, sorting from `PRIORITY_RANK`. The `uu` query param filters by priority.
- Server timestamps (`datetime('now')`) are UTC without a zone: display them with `formatDateTime` / `serverTimeToLocalDate` from `transforms.ts`, never raw.
- `src/lib/transforms.ts` maps snake_case rows to the camelCase types in `src/types.ts`, typed against DTOs (no `any`). Frontend ids are composite `"<tier>-<id>"` (`toCompositeId` / `extractBackendId`). `daily_logs.task_id` and audit `entity_id` are raw numbers, so compare after conversion. Status labels map 1:1 to the 5 state-machine enums (`STATUS_VI`). Never add synonym labels.
- Item details open in `TaskDetailDialog.tsx`: a wide centered `Dialog` (`size="wide"`, full screen on phones) with the instruction, files and the Trao đổi / Lịch sử tabs on the left and status, actions (note typed inline, no stacked dialog) and info on the right. Status labels are one set everywhere: Chưa bắt đầu / Đang làm / Chờ duyệt / Đang vướng / Đã xong (`STATUS_VI`).
- Modals and the detail dialog use `src/components/ui/Dialog.tsx`, which provides Esc to close, a focus trap, `role="dialog"` and the shared input/button classes. Toasts are queued through `useToasts()` in `components/Toast.tsx`.

### Styling
- Tailwind v4 via `@tailwindcss/vite`. Colors are tokens in `@theme` in `src/index.css` (`bg-primary`, `text-on-surface`, `bg-warning-container`, `gantt-t1..t4`…). Don't write hex values or Tailwind default palettes (`slate-*`, `red-*`) in components. Add a token instead.
- Type scale: `text-xs` (12px) up to `text-display` (32px). Nothing smaller than 12px, because Vietnamese diacritics stop being readable.
- Icons are Material Symbols ligatures (`<span aria-hidden="true" className="material-symbols-outlined">name</span>`). Set icon size with `[--icon-size:16px]`, not `text-*`: Google's unlayered stylesheet overrides Tailwind's layered utilities.
- The `@/*` path alias resolves to the repo root.

## Conventions
- Historical context ("Phase C/D/…", "TD-xx" fixes) lives in `CHANGELOG.md`. Don't leave history comments in source; comments should describe current behaviour and API contracts. When you make a big change (a table added or removed, a schema change, an architecture refactor), add a row to `CHANGELOG.md`.
- PDF/Excel export doesn't exist (the old fake `ExportModal` was deleted), so don't restore a fake export.
