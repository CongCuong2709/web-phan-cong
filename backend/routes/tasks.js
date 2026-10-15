/**
 * routes/tasks.js — UNIFIED task CRUD cho schema v3 (4-tier normalized)
 *
 * Phase C refactor: 1 endpoint /api/tasks nhưng dispatch theo tier:
 *   tier 1 → bảng projects
 *   tier 2 → bảng phases
 *   tier 3 → bảng bundles
 *   tier 4 → bảng tasks
 *
 * Client (frontend) vẫn gọi /api/tasks/:tier?... như cũ, transform layer ở FE
 * sẽ map TierItemDto về đúng bảng. Hoặc client gọi riêng /api/projects, /api/phases...
 *
 * Endpoints:
 *   GET    /api/tasks                — List TẤT CẢ tier 1-4 (cho Gantt view)
 *   GET    /api/tasks/:tier/:id      — Chi tiết theo tier
 *   POST   /api/tasks                — Tạo mới (dispatch theo tier)
 *   PATCH  /api/tasks/:tier/:id      — Update theo tier
 *   DELETE /api/tasks/:tier/:id      — Xoá theo tier
 *   POST   /api/tasks/:tier/:id/notes    — Thêm note
 *   POST   /api/tasks/:tier/:id/approve  — Manager duyệt
 *   POST   /api/tasks/:tier/:id/help     — NV xin hỗ trợ
 *   POST   /api/tasks/:tier/:id/toggle   — Đổi status
 *
 * Phase B:
 *   - canTransition() enforce state machine
 *   - authorize() dùng centralized policy
 *   - recomputeRollup() respect manual status (Fix C9)
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../lib/policies.js';
import { inDepartment, uid } from '../utils/permissions.js';
import { canTransition } from '../lib/stateMachine.js';

const router = Router();
router.use(requireAuth);

/** Trừ N ngày từ ISO date. */
function dateMinusDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Normalize status text legacy → enum. */
function normalizeStatus(status) {
  if (!status) return 'pending';
  const s = String(status).toLowerCase();
  if (['done', 'đã xong', 'hoàn thành'].includes(s)) return 'done';
  if (['doing', 'đang chạy', 'đang làm', 'sắp xong'].includes(s)) return 'doing';
  if (['pending_approval', 'pending approval', 'chờ duyệt'].includes(s)) return 'pending_approval';
  if (['blocked', 'đang nghẽn', 'điểm nghẽn'].includes(s)) return 'blocked';
  if (['pending', 'chuẩn bị'].includes(s)) return 'pending';
  return 'pending';
}
function normalizePriority(p) {
  if (!p) return 'normal';
  const s = String(p).toLowerCase();
  if (['low', 'thấp'].includes(s)) return 'low';
  if (['high', 'critical', 'khẩn', 'cao'].includes(s)) return 'high';
  return 'normal';
}

/** canSee: filter theo role + dept. */
function canSee(user, item) {
  // item phải có tier, department_code (nếu có), owner_username_str
  if (user.role === 'admin' || user.role === 'director') return true;
  if (user.role === 'manager') {
    if (item.tier === 1) return true; // BGĐ-owned project
    return inDepartment(user, item.department_code);
  }
  // Employee
  if (item.tier === 4) return item.owner_username_str === user.username;
  return true;
}

/** Auto-rollup progress — Phase C: giờ rollup theo hierarchy thật (task → bundle → phase → project). */
function recomputeRollup(taskId) {
  if (!taskId) return;
  const task = stmt.getTaskBundlePhase.get(taskId);
  if (!task) return;

  // 1. Tính avg progress của T4 tasks trong bundle
  if (task.bundle_id) {
    const children = stmt.getChildrenProgress.all(task.bundle_id);
    if (children.length > 0) {
      const avg = Math.round(children.reduce((a, c) => a + c.progress, 0) / children.length);
      const bundle = stmt.getBundle.get(task.bundle_id);
      if (bundle) {
        const newStatus = avg === 100 ? 'done' : avg > 90 ? 'pending_approval' : 'doing';
        // B6: respect manual status
        const AUTOMATIC = new Set(['pending', 'doing']);
        if (AUTOMATIC.has(bundle.status)) {
          db.prepare('UPDATE bundles SET progress_rollup = ?, status = ? WHERE id = ?')
            .run(avg, newStatus, task.bundle_id);
        } else {
          db.prepare('UPDATE bundles SET progress_rollup = ? WHERE id = ?').run(avg, task.bundle_id);
        }
      }
    }
  }
  // 2. Rollup bundle → phase
  if (task.phase_id) {
    const phaseBundles = db.prepare('SELECT progress_rollup FROM bundles WHERE phase_id = ?').all(task.phase_id);
    if (phaseBundles.length > 0) {
      const avg = Math.round(phaseBundles.reduce((a, c) => a + (c.progress_rollup || 0), 0) / phaseBundles.length);
      const phase = stmt.getPhase.get(task.phase_id);
      if (phase) {
        const newStatus = avg === 100 ? 'done' : avg > 90 ? 'pending_approval' : 'doing';
        const AUTOMATIC = new Set(['pending', 'doing']);
        if (AUTOMATIC.has(phase.status)) {
          db.prepare('UPDATE phases SET progress_rollup = ?, status = ? WHERE id = ?')
            .run(avg, newStatus, task.phase_id);
        } else {
          db.prepare('UPDATE phases SET progress_rollup = ? WHERE id = ?').run(avg, task.phase_id);
        }
      }
    }
  }
  // 3. Rollup phase → project
  if (task.project_id) {
    const projectPhases = db.prepare('SELECT progress_rollup FROM phases WHERE project_id = ?').all(task.project_id);
    if (projectPhases.length > 0) {
      const avg = Math.round(projectPhases.reduce((a, c) => a + (c.progress_rollup || 0), 0) / projectPhases.length);
      const project = stmt.getProject.get(task.project_id);
      if (project) {
        const newStatus = avg === 100 ? 'done' : avg > 90 ? 'pending_approval' : 'doing';
        const AUTOMATIC = new Set(['pending', 'doing']);
        if (AUTOMATIC.has(project.status)) {
          db.prepare('UPDATE projects SET progress_rollup = ?, status = ? WHERE id = ?')
            .run(avg, newStatus, task.project_id);
        } else {
          db.prepare('UPDATE projects SET progress_rollup = ? WHERE id = ?').run(avg, task.project_id);
        }
      }
    }
  }
}

/** Helper: load 1 item theo tier. */
function loadItem(tier, id) {
  switch (Number(tier)) {
    case 1: return stmt.getProject.get(Number(id));
    case 2: return stmt.getPhase.get(Number(id));
    case 3: return stmt.getBundle.get(Number(id));
    case 4: return stmt.getTask.get(Number(id));
    default: return null;
  }
}

/** Helper: thêm tier + parent_ids vào row để canSee + transform xử lý. */
function enrichWithTier(row, tier) {
  if (!row) return null;
  return { ...row, tier: Number(tier) };
}

/** Resolve owner_user_id. */
function resolveOwner(req) {
  const body = req.body || {};
  if (body.owner_user_id && Number.isFinite(Number(body.owner_user_id))) {
    return { ownerId: Number(body.owner_user_id), source: 'user_id' };
  }
  if (body.owner_username && typeof body.owner_username === 'string') {
    const u = db.prepare(
      'SELECT id FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1'
    ).get(body.owner_username.trim());
    if (!u) return { ownerId: null, source: 'username_not_found', username: body.owner_username };
    return { ownerId: u.id, source: 'username' };
  }
  return { ownerId: req.user.id, source: 'fallback' };
}

/** Audit log helper. */
function logAudit(entityType, entityId, action, oldValues, newValues, req) {
  stmt.insertAuditLog.run(
    entityType,
    entityId,
    action,
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    req.user.id,
    req.user.username,
    req.ip || null,
    (req.headers['user-agent'] || '').slice(0, 255),
  );
}

// ============================================================================
// CRUD
// ============================================================================

/** GET /api/tasks — List tất cả 4 tier (cho Gantt). */
router.get('/', (req, res) => {
  // Tier 4 (tasks)
  const tasks = stmt.listTasks.all();
  const projects = stmt.listProjects.all();
  const phases = stmt.listPhases.all();
  const bundles = stmt.listBundles.all();

  const all = [
    ...projects.map((p) => ({ ...p, tier: 1 })),
    ...phases.map((p) => ({ ...p, tier: 2 })),
    ...bundles.map((b) => ({ ...b, tier: 3 })),
    ...tasks.map((t) => ({ ...t, tier: 4 })),
  ];
  const visible = all.filter((item) => canSee(req.user, item));
  return res.json({ items: visible });
});

/** GET /api/tasks/:tier(\\d)/:id(\\d+) — Chi tiết 1 item theo tier. */
router.get('/:tier(\\d+)/:id(\\d+)', (req, res) => {
  const item = loadItem(req.params.tier, req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(item, req.params.tier);
  if (!canSee(req.user, enriched)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // Phase F: chi tra ve item. 3 sub-resource cu (notes/deliverables/helpMessages) da
  // xoa. daily_logs frontend lay rieng qua GET /api/daily-logs?taskId=...
  return res.json({ item: enriched });
});

/** POST /api/tasks — Tạo mới. */
router.post('/', (req, res) => {
  const body = req.body || {};
  const tierNum = Number(body.tier);
  if (!Number.isInteger(tierNum) || tierNum < 1 || tierNum > 4) {
    return res.status(400).json({ error: 'invalid_tier' });
  }
  const authz = authorize('task:create', req.user, { tier: tierNum, targetDept: body.department_code });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const ownerResult = resolveOwner(req);
  if (ownerResult.source === 'username_not_found') {
    return res.status(404).json({ error: 'owner_username_not_found', message: `Không tìm thấy user '${ownerResult.username}'.` });
  }

  let lastId = 0;
  let entityType = '';
  tx(() => {
    const code = body.code || `NEW-${uid().slice(-6).toUpperCase()}`;
    const title = String(body.title || '').trim() || 'Chưa đặt tên';
    const startDate = body.start_date
      || (body.end_date ? dateMinusDays(body.end_date, 14) : null)
      || new Date().toISOString().slice(0, 10);
    const endDate = body.end_date || '2099-12-31';
    const status = normalizeStatus(body.status);
    const priority = normalizePriority(body.priority);

    if (tierNum === 1) {
      const info = stmt.insertProject.run(
        code, title, body.description || '',
        ownerResult.ownerId, startDate, endDate, status,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
      entityType = 'project';
    } else if (tierNum === 2) {
      const projectId = body.parent_id ? Number(body.parent_id) : null;
      if (!projectId) return res.status(400).json({ error: 'parent_id_required', message: 'Phase phải thuộc 1 project.' });
      const info = stmt.insertPhase.run(
        projectId, code, title, body.description || '',
        ownerResult.ownerId, startDate, endDate, status,
        body.management_notes || '',
        body.blocker_alert || null,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
      entityType = 'phase';
    } else if (tierNum === 3) {
      const phaseId = body.parent_id ? Number(body.parent_id) : null;
      if (!phaseId) return res.status(400).json({ error: 'parent_id_required', message: 'Bundle phải thuộc 1 phase.' });
      const info = stmt.insertBundle.run(
        phaseId, code, title, body.description || '',
        ownerResult.ownerId, startDate, endDate, status,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
      entityType = 'bundle';
    } else { // tier 4
      const bundleId = body.parent_id ? Number(body.parent_id) : null; // null OK (standalone)
      const info = stmt.insertTask.run(
        bundleId, code, title, body.description || '',
        ownerResult.ownerId,
        body.assigned_by_user_id ? Number(body.assigned_by_user_id) : req.user.id,
        body.department_code ?? null,
        startDate, endDate,
        Number(body.progress ?? 0), status, priority,
        body.is_today ? 1 : 0,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
      entityType = 'task';
    }
    logAudit(entityType, lastId, 'create', null, { code, title }, req);
  });

  const created = loadItem(tierNum, lastId);
  return res.status(201).json({ item: enrichWithTier(created, tierNum) });
});

/** PATCH /api/tasks/:tier/:id — Update. */
router.patch('/:tier(\\d+)/:id(\\d+)', (req, res) => {
  const tier = Number(req.params.tier);
  const id = Number(req.params.id);
  const item = loadItem(tier, id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(item, tier);
  const authz = authorize('task:edit', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const body = req.body || {};
  const oldValues = { ...item };

  // Validate status transition (state machine)
  if (body.status) {
    const newStatus = normalizeStatus(body.status);
    if (newStatus !== item.status) {
      const tr = canTransition(item.status, newStatus, req.user, enriched);
      if (!tr.ok) {
        return res.status(403).json({ error: 'invalid_transition', message: tr.reason });
      }
      body.status = newStatus;
    }
  }

  let updated = null;
  tx(() => {
    if (tier === 1) {
      stmt.updateProject.run(
        body.title ?? item.title,
        body.description ?? item.description,
        body.owner_user_id ? Number(body.owner_user_id) : item.owner_user_id,
        body.start_date ?? item.start_date,
        body.end_date ?? item.end_date,
        body.status ?? item.status,
        body.collapsed !== undefined ? (body.collapsed ? 1 : 0) : item.collapsed,
        id,
      );
      updated = stmt.getProject.get(id);
    } else if (tier === 2) {
      stmt.updatePhase.run(
        body.title ?? item.title,
        body.description ?? item.description,
        body.owner_user_id ? Number(body.owner_user_id) : item.owner_user_id,
        body.start_date ?? item.start_date,
        body.end_date ?? item.end_date,
        body.status ?? item.status,
        body.management_notes ?? item.management_notes,
        body.blocker_alert ?? item.blocker_alert,
        body.collapsed !== undefined ? (body.collapsed ? 1 : 0) : item.collapsed,
        id,
      );
      updated = stmt.getPhase.get(id);
    } else if (tier === 3) {
      stmt.updateBundle.run(
        body.title ?? item.title,
        body.description ?? item.description,
        body.owner_user_id ? Number(body.owner_user_id) : item.owner_user_id,
        body.start_date ?? item.start_date,
        body.end_date ?? item.end_date,
        body.status ?? item.status,
        body.collapsed !== undefined ? (body.collapsed ? 1 : 0) : item.collapsed,
        id,
      );
      updated = stmt.getBundle.get(id);
    } else { // tier 4
      const oldProgress = item.progress;
      const newProgress = Number(body.progress ?? oldProgress);
      stmt.updateTask.run(
        body.title ?? item.title,
        body.description ?? item.description,
        body.owner_user_id ? Number(body.owner_user_id) : item.owner_user_id,
        body.assigned_by_user_id !== undefined
          ? (body.assigned_by_user_id ? Number(body.assigned_by_user_id) : null)
          : item.assigned_by_user_id,
        body.department_code ?? item.department_code,
        body.start_date ?? item.start_date,
        body.end_date ?? item.end_date,
        newProgress,
        body.status ?? item.status,
        body.priority ? normalizePriority(body.priority) : item.priority,
        body.is_today !== undefined ? (body.is_today ? 1 : 0) : item.is_today,
        body.collapsed !== undefined ? (body.collapsed ? 1 : 0) : item.collapsed,
        body.blocker_note ?? item.blocker_note ?? '',
        id,
      );
      updated = stmt.getTask.get(id);
      // Rollup nếu progress đổi
      if (newProgress !== oldProgress) {
        recomputeRollup(id);
      }
    }
    logAudit(
      tier === 1 ? 'project' : tier === 2 ? 'phase' : tier === 3 ? 'bundle' : 'task',
      id,
      'update',
      oldValues,
      body,
      req,
    );
  });

  return res.json({ item: enrichWithTier(updated, tier) });
});

/** DELETE /api/tasks/:tier/:id — Admin only. */
router.delete('/:tier(\\d+)/:id(\\d+)', (req, res) => {
  const tier = Number(req.params.tier);
  const id = Number(req.params.id);
  const item = loadItem(tier, id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(item, tier);
  const authz = authorize('task:delete', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);

  tx(() => {
    logAudit(
      tier === 1 ? 'project' : tier === 2 ? 'phase' : tier === 3 ? 'bundle' : 'task',
      id, 'delete', item, null, req,
    );
    if (tier === 1) stmt.deleteProject.run(id);
    else if (tier === 2) stmt.deletePhase.run(id);
    else if (tier === 3) stmt.deleteBundle.run(id);
    else stmt.deleteTask.run(id);
  });
  return res.status(204).send();
});

// ============================================================================
// Sub-resources
// ============================================================================
// Phase F: chi con daily_logs la sub-resource 1:N cua task.
// Da xoa: notes, deliverables, help_messages endpoints (cac bang tuong ung da drop).

/** POST /api/tasks/:tier/:id/approve — Manager nghiệm thu. */
router.post('/:tier(\\d+)/:id(\\d+)/approve', (req, res) => {
  const tier = Number(req.params.tier);
  const id = Number(req.params.id);
  const item = loadItem(tier, id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(item, tier);
  const authz = authorize('task:approve', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);
  const tr = canTransition(item.status, 'done', req.user, enriched);
  if (!tr.ok) {
    return res.status(403).json({ error: 'invalid_transition', message: tr.reason });
  }

  tx(() => {
    const progress = tier === 4 && item.deliverable_completed ? 100 : (item.progress || 0);
    if (tier === 1) stmt.updateProject.run(item.title, item.description, item.owner_user_id, item.start_date, item.end_date, 'done', item.collapsed, id);
    else if (tier === 2) stmt.updatePhase.run(item.title, item.description, item.owner_user_id, item.start_date, item.end_date, 'done', item.management_notes, item.blocker_alert, item.collapsed, id);
    else if (tier === 3) stmt.updateBundle.run(item.title, item.description, item.owner_user_id, item.start_date, item.end_date, 'done', item.collapsed, id);
    else stmt.updateTask.run(item.title, item.description, item.owner_user_id, item.assigned_by_user_id, item.department_code, item.start_date, item.end_date, progress, 'done', item.priority, item.is_today, item.collapsed, item.blocker_note || '', id);
    logAudit(
      tier === 1 ? 'project' : tier === 2 ? 'phase' : tier === 3 ? 'bundle' : 'task',
      id, 'status_change', { status: item.status }, { status: 'done' }, req,
    );
    if (tier === 4) recomputeRollup(id);
  });

  const updated = loadItem(tier, id);
  return res.json({ item: enrichWithTier(updated, tier) });
});

/** POST /api/tasks/:tier/:id/blocker — NV ghi 1 dong `blocker_note` cho task (Phase F).
 *  Thay the POST /help (da xoa). Frontend:
 *    POST { taskId, note } → 200 { blocker_note }
 *  Quyen: owner task hoac admin/manager trong phong ban.
 */
router.post('/:tier(\\d+)/:id(\\d+)/blocker', (req, res) => {
  const tier = Number(req.params.tier);
  if (tier !== 4) return res.status(400).json({ error: 'blocker_only_for_task' });
  const id = Number(req.params.id);
  const task = stmt.getTask.get(id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(task, tier);
  const authz = authorize('task:edit', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const body = req.body || {};
  const note = String(body.note ?? '').trim();
  if (!note) return res.status(400).json({ error: 'note_required' });

  tx(() => {
    stmt.updateTask.run(
      task.title, task.description, task.owner_user_id, task.assigned_by_user_id,
      task.department_code, task.start_date, task.end_date,
      task.progress, task.status, task.priority, task.is_today, task.collapsed,
      note, // ← blocker_note
      id,
    );
    logAudit('task', id, 'update', { blocker_note: task.blocker_note || '' }, { blocker_note: note }, req);
  });

  return res.json({ item: enrichWithTier(stmt.getTask.get(id), tier), blocker_note: note });
});

/** POST /api/tasks/:tier/:id/toggle — Owner tick. */
router.post('/:tier(\\d+)/:id(\\d+)/toggle', (req, res) => {
  const tier = Number(req.params.tier);
  if (tier !== 4) return res.status(400).json({ error: 'toggle_only_for_task' });
  const id = Number(req.params.id);
  const task = stmt.getTask.get(id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(task, tier);
  const authz = authorize('task:toggle', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);
  const next = task.status === 'done' ? 'doing' : 'done';
  const tr = canTransition(task.status, next, req.user, enriched);
  if (!tr.ok) {
    return res.status(403).json({ error: 'invalid_transition', message: tr.reason });
  }
  const nextProgress = next === 'done' ? 100 : Math.max(task.progress, 50);

  tx(() => {
    stmt.updateTask.run(
      task.title, task.description, task.owner_user_id, task.assigned_by_user_id,
      task.department_code, task.start_date, task.end_date,
      nextProgress, next, task.priority, task.is_today, task.collapsed,
      task.blocker_note || '',
      id,
    );
    logAudit('task', id, 'status_change', { status: task.status }, { status: next }, req);
    recomputeRollup(id);
  });

  const updated = stmt.getTask.get(id);
  return res.json({ item: enrichWithTier(updated, tier) });
});

export default router;
