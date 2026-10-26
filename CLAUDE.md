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

- `progress_rollup` is calculated in JS (`recomputeRollup` in `backend/routes/tasks.js`). SQLite triggers only update `updated_at`.
- Schema bootstrap (`backend/db.js`): `schema.sql` is only applied when the DB file is **new**. On an existing DB, `db.js` runs `sql/migration.sql` if it exists, and that file is not tracked. When you change the schema, either reset the DB or write idempotent migration SQL.
- `node:sqlite` differs from better-sqlite3: there is no `.transaction()` (use the `tx(fn)` helper from `db.js`) and no `.pragma()` (use `db.exec('PRAGMA …')`). Prepared statements are cached in the `stmt` object exported from `db.js`; add new queries there.

### API
- One task endpoint for all tiers: `/api/tasks` and `/api/tasks/:tier/:id[/approve|/toggle|/toggle-today|/blocker|/help-messages…]`. Tier is 1–4 and the handler dispatches on it. The parent is passed as `parent_id`. `/api/tier-items`, `/api/team-tasks` and `/api/employee-tasks` are legacy aliases mounted on the same router.
- Manager actions on a T4 task: `/approve` (→ done), `/return` (pending_approval → doing, optional `reason` stored in the audit row) and `/unblock` (clears `blocker_note`, resolves open help messages, blocked → doing). All three use the `task:approve` policy. Reassigning and rescheduling go through `PATCH` (`owner_user_id`, `end_date`).
- An employee reporting an obstacle (`/blocker`) only sets `blocker_note` and does **not** change status. "Needs help" therefore means `status === 'blocked' || blocker_note` (`TeamLeadTask.needsHelp`), so never filter on status alone.
- Other routers: `auth`, `users`, `dailyLogs` (mounted at `/api`), `teamMembers`, `history` (audit log), `weeklyReports` (`GET`/`PUT /api/weekly-reports?week=YYYY-MM-DD`, using ISO Monday week start, plus `/history`, `/team` and `/:userId/review`).
- Auth: JWT bearer token (7-day expiry, no refresh token) plus a row in `sessions` (`middleware/auth.js` → `requireAuth`).

### Authorization: one source of truth
- `backend/lib/policies.js` → `authorize(action, user, ctx)` makes every RBAC decision (`task:create|edit|delete|approve|toggle|read`, `daily_log:create`, `user:list|read`, `history:read_all`). Do not put role checks inline in route handlers. `middleware/rbac.js` delegates to this file, and `backend/utils/permissions.js` is a deprecated re-export shim, so new imports should go to `lib/policies.js`.
- `backend/lib/stateMachine.js` is a separate boundary for **status** transitions. `done` is terminal, and only a manager or admin can clear `blocked`. Employees may only move `pending→doing→pending_approval`, `doing→blocked` and `blocked→pending`.
- Roles: `admin` (everything), `director` (read-only, can create T1/T2), `manager` (own department, can create T3/T4 and approve), `employee` (only their own T4 tasks).
- `src/auth/permissions.ts` only shows and hides UI. It is not a security boundary, so any rule change must happen in `policies.js`.

### Frontend
- **The server is the only source of truth.** `src/lib/useWorkspaceData.ts` loads `/api/tasks`, `/api/daily-logs` and `/api/team-members` into one raw store with a `loading | ready | error` status. `App.tsx` derives every view's list (`tierItems`, `teamTasks`, `employeeTasks`) from it with `useMemo`. Don't add parallel copies of that data in component state.
- **Writes go through `commit()` in `App.tsx`.** It awaits the API call. On failure it shows `describeApiError()` as an error toast and changes nothing. On success it calls `reload()` and only then shows the success toast. Don't do optimistic updates, don't use temp ids (create calls wait for the real id), and don't swallow errors. Handlers return `Promise<boolean>` (or the saved ids) so views can disable buttons and close modals only on success.
- Views must not say anything ("không có việc gấp", "đúng hạn"…) until `loadStatus === 'ready'`. Every label must be computed from data. "Overdue" means `end_date < today` and not finished: use `isTierItemOverdue` in `transforms.ts`.
- Tabs (`ActiveAppTab`): `cay-gantt-4-tang` (Gantt4TangView), `giao-viec-nhom` (GiaoViecNhomView), `viec-cua-toi` (ViecCuaToiView, inline daily-log sheet whose drafts persist in sessionStorage via `useSessionState`) and `bao-cao` (BaoCaoTongQuanView plus the weekly report views).
- **Routing** is hash-based (`src/lib/useHashRoute.ts`, no dependency): `#/cay-cong-viec`, `#/giao-viec`, `#/viec-cua-toi`, `#/bao-cao/tuan` and `#/bao-cao/tong-quan`. `App.tsx` reads the route and redirects (replace, not push) when a tab isn't in `visibleTabsFor(user)` (`auth/permissions.ts`). Page changes push a history entry; filters use `setParam` (replace) and live in the query: `loc` (filter), `nv` (member), `xem` (Gantt range `thang` | `13-tuan`; there is no year view), `muc` (item open in the Drawer, e.g. `muc=4-12`). Views get filter values and change handlers as props instead of keeping filter state themselves.
- `src/lib/apiClient.ts`: `api.*` methods return `ApiResponse` (they never throw), plus typed DTOs that match the real responses. The base URL comes from `VITE_API_URL` (default `http://localhost:3001`). Global `/api/history` is admin/director only, so the Drawer loads per-entity history with `api.listEntityHistory`.
- `src/lib/transforms.ts` maps snake_case rows to the camelCase types in `src/types.ts`, typed against DTOs (no `any`). Frontend ids are composite `"<tier>-<id>"` (`toCompositeId` / `extractBackendId`). `daily_logs.task_id` and audit `entity_id` are raw numbers, so compare after conversion. Status labels map 1:1 to the 5 state-machine enums (`STATUS_VI`). Never add synonym labels.
- Modals and the drawer use `src/components/ui/Dialog.tsx`, which provides Esc to close, a focus trap, `role="dialog"` and the shared input/button classes. Toasts are queued through `useToasts()` in `components/Toast.tsx`.

### Styling
- Tailwind v4 via `@tailwindcss/vite`. Colors are tokens in `@theme` in `src/index.css` (`bg-primary`, `text-on-surface`, `bg-warning-container`, `gantt-t1..t4`…). Don't write hex values or Tailwind default palettes (`slate-*`, `red-*`) in components. Add a token instead.
- Type scale: `text-xs` (12px) up to `text-display` (32px). Nothing smaller than 12px, because Vietnamese diacritics stop being readable.
- Icons are Material Symbols ligatures (`<span aria-hidden="true" className="material-symbols-outlined">name</span>`). Set icon size with `[--icon-size:16px]`, not `text-*`: Google's unlayered stylesheet overrides Tailwind's layered utilities.
- The `@/*` path alias resolves to the repo root.

## Conventions
- Historical context ("Phase C/D/…", "TD-xx" fixes) lives in `CHANGELOG.md`. Don't leave history comments in source; comments should describe current behaviour and API contracts. When you make a big change (a table added or removed, a schema change, an architecture refactor), add a row to `CHANGELOG.md`.
- PDF/Excel export doesn't exist (the old fake `ExportModal` was deleted), so don't restore a fake export.
