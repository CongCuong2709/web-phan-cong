/**
 * routes/tasks.js — UNIFIED TASK CRUD (ISS-007)
 *
 * Trước ISS-007, có 3 bảng tasks riêng biệt (tier_items, team_lead_tasks,
 * employee_tasks). Giờ thay bằng 1 bảng `tasks` duy nhất với tier ∈ {1,2,3,4}
 * + các field đặc thù từ 3 bảng cũ.
 *
 * Routes:
 *   GET    /api/tasks             — Filter theo role + dept + owner
 *   GET    /api/tasks/:id         — Chi tiết (kèm subtasks + notes)
 *   POST   /api/tasks             — Tạo (check canCreateTiers + resolveOwner)
 *   PATCH  /api/tasks/:id         — Update (check canEditTask)
 *   DELETE /api/tasks/:id         — Xoá (admin only)
 *   POST   /api/tasks/:id/notes   — Thêm note
 *   POST   /api/tasks/:id/approve — Manager duyệt (status pending_approval → done)
 *   POST   /api/tasks/:id/help    — NV xin hỗ trợ (lưu help_message_*)
 *
 * Bao gồm ISS-006 fix: resolveOwner từ owner_username + cross-dept guard.
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTierCreatePermission } from '../middleware/rbac.js';
import { canEditTask, inDepartment, uid } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** Trừ N ngày từ ISO date. */
function dateMinusDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Resolve owner_user_id cho task (ISS-006 fix incorporated).
 *
 * Ưu tiên:
 *   1. `owner_user_id` (số) — explicit ID.
 *   2. `owner_username` (string) — client chỉ có username (vd. SEED_USERS
 *      dùng string ID 'u-001' không phải integer). Tra cứu DB.
 *   3. Fallback `req.user.id` — backward-compat.
 */
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

/**
 * Quyết định xem user có thấy 1 task không.
 *
 * - admin/director: thấy tất cả
 * - manager: thấy tất cả trong phòng ban mình (T1 vẫn read-only context)
 * - employee: chỉ T4 owned + toàn bộ T1/T2/T3 (read-only context)
 */
function canSee(user, item) {
  if (user.role === 'admin' || user.role === 'director') return true;
  if (user.role === 'manager') {
    if (item.tier === 1) return true; // BGĐ-owned project
    return inDepartment(user, item.department_code);
  }
  // Employee: chỉ T4 của mình + T1/T2/T3 context
  if (item.tier === 4) return item.owner_username_str === user.username;
  return true;
}

/** Auto-rollup progress lên parent chain. */
function recomputeRollup(parentId) {
  if (!parentId) return;
  const children = stmt.getChildrenProgress.all(parentId);
  if (children.length === 0) return;
  const avg = Math.round(children.reduce((acc, c) => acc + c.progress, 0) / children.length);
  const status = avg === 100 ? 'done' : avg > 90 ? 'pending_approval' : 'doing';
  db.exec(`UPDATE tasks SET progress = ${avg}, status = '${status}' WHERE id = ${parentId}`);
  const parent = stmt.getTaskParent.get(parentId);
  if (parent?.parent_id) recomputeRollup(parent.parent_id);
}

/** Map status text legacy → enum mới (khi update từ code cũ). */
function normalizeStatus(status) {
  if (!status) return 'pending';
  const s = String(status).toLowerCase();
  if (['done', 'đã xong', 'hoàn thành'].includes(s)) return 'done';
  if (['doing', 'đang chạy', 'đang làm', 'sắp xong'].includes(s)) return 'doing';
  if (['pending_approval', 'pending approval', 'chờ duyệt'].includes(s)) return 'pending_approval';
  if (['blocked', 'đang nghẽn', 'điểm nghẽn'].includes(s)) return 'blocked';
  if (['pending', 'chuẩn bị'].includes(s)) return 'pending';
  return 'pending'; // safe fallback
}

function normalizePriority(p) {
  if (!p) return 'normal';
  const s = String(p).toLowerCase();
  if (['low', 'thấp'].includes(s)) return 'low';
  if (['high', 'critical', 'khẩn', 'cao'].includes(s)) return 'high';
  return 'normal';
}

// ============================================================================
// CRUD
// ============================================================================

/** GET /api/tasks — List filtered. */
router.get('/', (req, res) => {
  const all = stmt.listTasks.all();
  const visible = all.filter((item) => canSee(req.user, item));
  return res.json({ items: visible });
});

/** GET /api/tasks/:id — Detail + subtasks + notes. */
router.get('/:id(\\d+)', (req, res) => {
  const item = stmt.getTask.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not_found' });
  if (!canSee(req.user, item)) return res.status(403).json({ error: 'forbidden' });
  const subtasks = stmt.getSubtasksByTask.all(item.id);
  const notes = stmt.listNotesForTask.all(item.id);
  return res.json({ item, subtasks, notes });
});

/** POST /api/tasks — Tạo mới. */
router.post('/', requireTierCreatePermission, (req, res) => {
  const body = req.body || {};
  const tierNum = Number(body.tier);
  if (!Number.isInteger(tierNum) || tierNum < 1 || tierNum > 4) {
    return res.status(400).json({ error: 'invalid_tier' });
  }

  // Resolve owner
  const ownerResult = resolveOwner(req);
  if (ownerResult.source === 'username_not_found') {
    return res.status(404).json({
      error: 'owner_username_not_found',
      message: `Không tìm thấy user với username '${ownerResult.username}'.`,
    });
  }

  // Cross-dept guard cho manager
  if (req.user.role === 'manager') {
    const targetDeptRows = stmt.getUserDepartments.all(ownerResult.ownerId);
    const targetDepts = targetDeptRows.map((d) => d.department_code);
    const allowed = Array.isArray(req.user.departments)
      ? req.user.departments
      : String(req.user.departments ?? '').split(',').filter(Boolean);
    const isCross = targetDepts.length === 0
      || !targetDepts.some((d) => allowed.includes(d));
    if (isCross) {
      return res.status(403).json({
        error: 'cross_dept_owner',
        message: 'Manager không được giao việc cho nhân viên ngoài phòng ban của mình.',
      });
    }
  }

  // Default assigned_by = current user (manager/admin creating task)
  const assignedBy = body.assigned_by_user_id
    ? Number(body.assigned_by_user_id)
    : req.user.id;

  let lastId = 0;
  tx(() => {
    const info = stmt.insertTask.run(
      body.code || `NEW-${uid().slice(-6).toUpperCase()}`,
      String(body.title || '').trim() || 'Chưa đặt tên',
      body.description || '',
      body.parent_id ? Number(body.parent_id) : null,
      tierNum,
      ownerResult.ownerId,
      assignedBy,
      body.department_code ?? null,
      body.start_date
        || (body.end_date ? dateMinusDays(body.end_date, 14) : null)
        || new Date().toISOString().slice(0, 10),
      body.end_date || '2099-12-31',
      Number(body.progress ?? 0),
      normalizeStatus(body.status),
      normalizePriority(body.priority),
      body.is_today ? 1 : 0,
      body.bundle_name || null,
      body.last_updated || null,
      body.deliverable_type || null,
      body.deliverable_text || null,
      body.deliverable_completed ? 1 : 0,
      body.file_name || null,
      body.help_message_author || null,
      body.help_message_body || null,
      body.help_message_timeago || null,
      body.management_notes || '',
      body.blocker_alert || null,
      Number(body.start_week ?? 1),
      Number(body.end_week ?? 2),
      body.collapsed ? 1 : 0,
    );
    lastId = Number(info.lastInsertRowid);

    stmt.insertHistory.run(
      'task',
      lastId,
      `Tạo ${body.code || 'mới'}: ${body.title || ''}`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
  });

  const created = stmt.getTask.get(lastId);
  return res.status(201).json({ item: created });
});

/** PATCH /api/tasks/:id — Update. */
router.patch('/:id(\\d+)', (req, res) => {
  const item = stmt.getTask.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not_found' });
  if (!canEditTask(req.user, item)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body || {};
  const oldProgress = item.progress;

  tx(() => {
    stmt.updateTask.run(
      body.title ?? item.title,
      body.description ?? item.description,
      body.parent_id !== undefined ? (body.parent_id ? Number(body.parent_id) : null) : item.parent_id,
      body.owner_user_id ? Number(body.owner_user_id) : item.owner_user_id,
      body.assigned_by_user_id !== undefined
        ? (body.assigned_by_user_id ? Number(body.assigned_by_user_id) : null)
        : item.assigned_by_user_id,
      body.department_code ?? item.department_code,
      body.start_date ?? item.start_date,
      body.end_date ?? item.end_date,
      Number(body.progress ?? oldProgress),
      body.status ? normalizeStatus(body.status) : item.status,
      body.priority ? normalizePriority(body.priority) : item.priority,
      body.is_today !== undefined ? (body.is_today ? 1 : 0) : item.is_today,
      body.bundle_name ?? item.bundle_name,
      body.last_updated ?? item.last_updated,
      body.deliverable_type ?? item.deliverable_type,
      body.deliverable_text ?? item.deliverable_text,
      body.deliverable_completed !== undefined
        ? (body.deliverable_completed ? 1 : 0)
        : item.deliverable_completed,
      body.file_name ?? item.file_name,
      body.help_message_author ?? item.help_message_author,
      body.help_message_body ?? item.help_message_body,
      body.help_message_timeago ?? item.help_message_timeago,
      body.management_notes ?? item.management_notes,
      body.blocker_alert ?? item.blocker_alert,
      Number(body.start_week ?? item.start_week),
      Number(body.end_week ?? item.end_week),
      body.collapsed !== undefined ? (body.collapsed ? 1 : 0) : item.collapsed,
      item.id,
    );

    stmt.insertHistory.run(
      'task',
      item.id,
      `Cập nhật ${item.code}: ${body.progress ?? item.progress}%`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );

    const newProgress = Number(body.progress ?? oldProgress);
    if (newProgress !== oldProgress && (item.tier === 3 || item.tier === 4)) {
      recomputeRollup(item.parent_id);
    }
  });

  const updated = stmt.getTask.get(item.id);
  return res.json({ item: updated });
});

/** DELETE /api/tasks/:id — Admin only. */
router.delete('/:id(\\d+)', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin mới được xoá.' });
  }
  const item = stmt.getTask.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not_found' });
  tx(() => {
    stmt.insertHistory.run(
      'task',
      item.id,
      `Xoá ${item.code}: ${item.title}`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
    stmt.deleteTask.run(item.id);
  });
  return res.status(204).send();
});

// ============================================================================
// Sub-resources
// ============================================================================

/** POST /api/tasks/:id/notes — Thêm note. */
router.post('/:id(\\d+)/notes', (req, res) => {
  const task = stmt.getTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (!canSee(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const body = req.body || {};
  if (!body.body?.trim()) {
    return res.status(400).json({ error: 'body_required', message: 'body không được rỗng.' });
  }

  let lastId = 0;
  tx(() => {
    const info = stmt.insertTaskNote.run(task.id, body.body.trim(), req.user.id);
    lastId = Number(info.lastInsertRowid);
    stmt.insertHistory.run(
      'task_note',
      lastId,
      `Thêm note cho ${task.code}`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
  });
  return res.status(201).json({ noteId: lastId });
});

/** POST /api/tasks/:id/approve — Manager nghiệm thu (status → done). */
router.post('/:id(\\d+)/approve', (req, res) => {
  const task = stmt.getTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin/manager mới duyệt.' });
  }
  if (req.user.role === 'manager' && !inDepartment(req.user, task.department_code)) {
    return res.status(403).json({ error: 'cross_dept_approve' });
  }

  tx(() => {
    stmt.updateTask.run(
      task.title, task.description, task.parent_id,
      task.owner_user_id, task.assigned_by_user_id, task.department_code,
      task.start_date, task.end_date,
      task.deliverable_completed ? 100 : task.progress,
      'done', task.priority,
      task.is_today, task.bundle_name, 'Vừa duyệt',
      task.deliverable_type, task.deliverable_text,
      1, // deliverable_completed
      task.file_name,
      task.help_message_author, task.help_message_body, task.help_message_timeago,
      task.management_notes, task.blocker_alert,
      task.start_week, task.end_week, task.collapsed,
      task.id,
    );
    stmt.insertHistory.run(
      'task',
      task.id,
      `Duyệt ${task.code}`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
    if (task.parent_id) recomputeRollup(task.parent_id);
  });

  const updated = stmt.getTask.get(task.id);
  return res.json({ item: updated });
});

/** POST /api/tasks/:id/help — NV gửi yêu cầu hỗ trợ. */
router.post('/:id(\\d+)/help', (req, res) => {
  const task = stmt.getTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (task.owner_user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ owner hoặc admin mới gửi help.' });
  }

  const body = req.body || {};
  if (!body.reason?.trim() || !body.message?.trim()) {
    return res.status(400).json({ error: 'reason_message_required' });
  }

  tx(() => {
    // 1. Update task.help_message_*
    stmt.updateTask.run(
      task.title, task.description, task.parent_id,
      task.owner_user_id, task.assigned_by_user_id, task.department_code,
      task.start_date, task.end_date,
      task.progress, 'blocked', task.priority,
      task.is_today, task.bundle_name, 'Vừa xin hỗ trợ',
      task.deliverable_type, task.deliverable_text,
      task.deliverable_completed, task.file_name,
      req.user.fullname, body.message.trim(), 'Vừa xong',
      task.management_notes, task.blocker_alert,
      task.start_week, task.end_week, task.collapsed,
      task.id,
    );
    // 2. Tạo help_request linked
    stmt.insertHelpRequest.run(
      req.user.id, body.reason.trim(), body.message.trim(), 'pending', task.id,
    );
    stmt.insertHistory.run(
      'task', task.id, `Xin hỗ trợ: ${body.reason.trim()}`,
      req.user.id, req.user.username, req.user.fullname,
    );
  });

  return res.status(201).json({ ok: true });
});

/** POST /api/tasks/:id/toggle — Đổi status doing ↔ done (NV tick). */
router.post('/:id(\\d+)/toggle', (req, res) => {
  const task = stmt.getTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (task.owner_user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const next = task.status === 'done' ? 'doing' : 'done';
  const nextProgress = next === 'done' ? 100 : Math.max(task.progress, 50);

  tx(() => {
    stmt.updateTask.run(
      task.title, task.description, task.parent_id,
      task.owner_user_id, task.assigned_by_user_id, task.department_code,
      task.start_date, task.end_date,
      nextProgress, next, task.priority,
      task.is_today, task.bundle_name, 'Vừa cập nhật',
      task.deliverable_type, task.deliverable_text,
      task.deliverable_completed, task.file_name,
      task.help_message_author, task.help_message_body, task.help_message_timeago,
      task.management_notes, task.blocker_alert,
      task.start_week, task.end_week, task.collapsed,
      task.id,
    );
    stmt.insertHistory.run(
      'task', task.id, `Toggle status → ${next}`,
      req.user.id, req.user.username, req.user.fullname,
    );
    if (task.parent_id) recomputeRollup(task.parent_id);
  });

  const updated = stmt.getTask.get(task.id);
  return res.json({ item: updated });
});

export default router;