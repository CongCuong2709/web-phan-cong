/**
 * routes/tasks.js — UNIFIED task CRUD cho schema v6 (4-tier normalized)
 *
 * 1 endpoint /api/tasks, dispatch theo tier:
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
 *   DELETE /api/tasks/:tier/:id      — Xoá theo tier (T4 snapshot daily_logs/help_messages)
 *   POST   /api/tasks/:tier/:id/notes    — Thêm note (reserved)
 *   POST   /api/tasks/:tier/:id/approve  — Manager duyệt
 *   POST   /api/tasks/:tier/:id/blocker  — NV ghi blocker_note
 *   POST   /api/tasks/:tier/:id/toggle   — Đổi status
 *   POST   /api/tasks/4/:id/return   — TP trả việc chờ duyệt về làm lại ({ reason? })
 *   POST   /api/tasks/4/:id/unblock  — TP gỡ vướng mắc ({ note? })
 *
 * Lưu ý:
 *   - recomputeRollup dùng subquery UPDATE single-statement (atomic).
 *   - DELETE T4 snapshot daily_logs + help_messages vào audit_log trước khi CASCADE xoá.
 *   - canSee T2/T3 giữ nguyên "org-level" (xem CHÍNH SÁCH ở policies.js).
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize, inDepartment, uid } from '../lib/policies.js';
import { canTransition } from '../lib/stateMachine.js';
import { today } from '../lib/dates.js';
import { recomputeRollup, rollupFrom } from '../lib/rollup.js';

const router = Router();
router.use(requireAuth);

/** Trừ N ngày từ ISO date. */
function dateMinusDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Validate YYYY-MM-DD. Return true nếu hợp lệ hoặc null/undefined. */
function isIsoDate(s) {
  if (!s) return true;
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
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

/**
 * canSee: filter theo role + dept.
 *
 *   - T1 (project) là BGĐ-owned → admin/director/manager thấy hết (không gắn department_code).
 *   - T2/T3 (phase/bundle) KHÔNG có department_code → "org-level" theo thiết kế.
 *     policies.js:task:read xử lý: manager cùng dept nào cũng thấy (vì
 *     inDepartment(user, null) = true). Đây là policy hiện tại, không phải bug.
 *   - T4 (task) có department_code → manager phải cùng phòng ban.
 */
function canSee(user, item) {
  if (user.role === 'admin' || user.role === 'director') return true;
  if (user.role === 'manager') {
    if (item.tier === 1) return true; // BGĐ-owned project
    return inDepartment(user, item.department_code);
  }
  // Employee
  if (item.tier === 4) return item.owner_username_str === user.username;
  return true;
}

/** Bảng con trực tiếp của mục cha (T1–T3) — dùng khi nghiệm thu. */
const CHILDREN_OF = {
  1: { table: 'phases', fk: 'project_id', label: 'giai đoạn' },
  2: { table: 'bundles', fk: 'phase_id', label: 'hạng mục' },
  3: { table: 'tasks', fk: 'bundle_id', label: 'đầu việc' },
};

/** Cột khoá ngoại tới mục cha, theo tier của mục con. */
const PARENT_OF = {
  2: { tier: 1, fk: 'project_id' },
  3: { tier: 2, fk: 'phase_id' },
  4: { tier: 3, fk: 'bundle_id' },
};

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

/**
 * Resolve created_by_user_id. Mặc định = req.user.id (người tạo request).
 * Cho phép override qua body.created_by_user_id (chỉ admin mới nên — caller
 * kiểm tra authorize 'task:create' đã cover).
 */
function resolveCreatedBy(req) {
  const body = req.body || {};
  if (body.created_by_user_id && Number.isFinite(Number(body.created_by_user_id))) {
    return Number(body.created_by_user_id);
  }
  return req.user.id;
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
  const createdById = resolveCreatedBy(req);

  // Validate dates
  if (!isIsoDate(body.start_date) || !isIsoDate(body.end_date)) {
    return res.status(400).json({ error: 'invalid_date', message: 'start_date và end_date phải có format YYYY-MM-DD.' });
  }
  if (body.start_date > body.end_date) {
    return res.status(400).json({ error: 'invalid_date_range', message: 'Ngày bắt đầu phải trước hoặc bằng hạn chót.' });
  }

  // ============================================================
  // IMPORTANT: All pre-tx() validation MUST send response and early-return.
  // Sending any response (res.status().json/send) inside tx() callback AND
  // then letting control flow fall through to the post-tx return causes
  // ERR_HTTP_HEADERS_SENT. Move validation OUT of tx() below.
  // ============================================================

  // Validate parent_id (early return BEFORE tx() to avoid double-response)
  if (tierNum === 2 && !(body.parent_id && Number(body.parent_id))) {
    return res.status(400).json({ error: 'parent_id_required', message: 'Phase phải thuộc 1 project.' });
  }
  if (tierNum === 3 && !(body.parent_id && Number(body.parent_id))) {
    return res.status(400).json({ error: 'parent_id_required', message: 'Bundle phải thuộc 1 phase.' });
  }

  // Validate is_today_date format for T4
  if (tierNum === 4 && body.is_today_date && !isIsoDate(body.is_today_date)) {
    return res.status(400).json({ error: 'invalid_is_today_date' });
  }

  let lastId = 0;
  let entityType = '';
  tx(() => {
    const code = body.code || `NEW-${uid().slice(-6).toUpperCase()}`;
    const title = String(body.title || '').trim() || 'Chưa đặt tên';
    const startDate = body.start_date
      || (body.end_date ? dateMinusDays(body.end_date, 14) : null)
      || today();
    const endDate = body.end_date || '2099-12-31';
    const status = normalizeStatus(body.status);
    const priority = normalizePriority(body.priority);

    if (tierNum === 1) {
      const info = stmt.insertProject.run(
        code, title, body.description || '',
        ownerResult.ownerId, createdById,
        startDate, endDate, status,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
      entityType = 'project';
    } else if (tierNum === 2) {
      const projectId = Number(body.parent_id);
      const info = stmt.insertPhase.run(
        projectId, code, title, body.description || '',
        ownerResult.ownerId, createdById,
        startDate, endDate, status,
        body.management_notes || '',
        body.blocker_alert || null,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
      entityType = 'phase';
    } else if (tierNum === 3) {
      const phaseId = Number(body.parent_id);
      const info = stmt.insertBundle.run(
        phaseId, code, title, body.description || '',
        ownerResult.ownerId, createdById,
        startDate, endDate, status,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
      entityType = 'bundle';
    } else { // tier 4
      const bundleId = body.parent_id ? Number(body.parent_id) : null; // null OK (standalone)
      // is_today_date mặc định = hôm nay nếu is_today=1, else null.
      const isToday = body.is_today ? 1 : 0;
      const isTodayDate = isToday
        ? (body.is_today_date ?? today())
        : null;
      const info = stmt.insertTask.run(
        bundleId, code, title, body.description || '',
        ownerResult.ownerId, createdById,
        body.assigned_by_user_id ? Number(body.assigned_by_user_id) : req.user.id,
        body.department_code ?? null,
        startDate, endDate,
        Number(body.progress ?? 0), status, priority,
        isToday, isTodayDate,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
      entityType = 'task';
    }
    logAudit(entityType, lastId, 'create', null, { code, title }, req);
    // Mục cha có thêm 1 con (0%) → tính lại tiến độ.
    if (tierNum > 1 && body.parent_id) rollupFrom(tierNum - 1, Number(body.parent_id));
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

  // Validate date fields nếu có
  if (body.start_date !== undefined && !isIsoDate(body.start_date)) {
    return res.status(400).json({ error: 'invalid_start_date' });
  }
  if (body.end_date !== undefined && !isIsoDate(body.end_date)) {
    return res.status(400).json({ error: 'invalid_end_date' });
  }
  if (body.is_today_date !== undefined && body.is_today_date !== null && !isIsoDate(body.is_today_date)) {
    return res.status(400).json({ error: 'invalid_is_today_date' });
  }

  // Gộp với giá trị đang có: chỉ đổi 1 trong 2 ngày cũng phải giữ thứ tự hợp lệ.
  const nextStart = body.start_date ?? item.start_date;
  const nextEnd = body.end_date ?? item.end_date;
  if (nextStart && nextEnd && nextStart > nextEnd) {
    return res.status(400).json({ error: 'invalid_date_range', message: 'Ngày bắt đầu phải trước hoặc bằng hạn chót.' });
  }

  const oldValues = { ...item };

  // Validate status transition (state machine)
  if (body.status) {
    const newStatus = normalizeStatus(body.status);
    if (tier < 4 && newStatus === 'done' && item.status !== 'done') {
      return res.status(400).json({
        error: 'use_close',
        message: 'Đóng hạng mục / giai đoạn / dự án bằng thao tác Nghiệm thu.',
      });
    }
    if (newStatus !== item.status) {
      const tr = canTransition(item.status, newStatus, req.user, enriched);
      if (!tr.ok) {
        return res.status(403).json({ error: 'invalid_transition', message: tr.reason });
      }
      body.status = newStatus;
    }
  }

  let updated = null;
  let progressChanged = false;
  let oldProgress = item.progress;
  let newProgress = oldProgress;
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
      oldProgress = item.progress;
      newProgress = Number(body.progress ?? oldProgress);
      progressChanged = newProgress !== oldProgress;

      // Nếu is_today bật lên → set is_today_date = today() khi client không truyền.
      let nextIsToday = body.is_today !== undefined ? (body.is_today ? 1 : 0) : item.is_today;
      let nextIsTodayDate = body.is_today_date !== undefined
        ? body.is_today_date
        : item.is_today_date;
      if (nextIsToday === 1 && !nextIsTodayDate) {
        nextIsTodayDate = today();
      }
      if (nextIsToday === 0) {
        nextIsTodayDate = null;
      }

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
        nextIsToday, nextIsTodayDate,
        body.collapsed !== undefined ? (body.collapsed ? 1 : 0) : item.collapsed,
        body.blocker_note ?? item.blocker_note ?? '',
        id,
      );
      updated = stmt.getTask.get(id);
      // Rollup nếu progress đổi (cùng tx → atomic)
      if (progressChanged) {
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

/** DELETE /api/tasks/:tier/:id — Admin only.
 *  T4 delete SNAPSHOT daily_logs + help_messages vào audit_log trước khi CASCADE xoá.
 *  T1/T2/T3 delete CASCADE xuống con — không snapshot từng descendant (sẽ nặng) nhưng
 *  ghi log "cascade_delete" vào audit_log của parent để trace.
 */
router.delete('/:tier(\\d+)/:id(\\d+)', (req, res) => {
  const tier = Number(req.params.tier);
  const id = Number(req.params.id);
  const item = loadItem(tier, id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(item, tier);
  const authz = authorize('task:delete', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);

  tx(() => {
    // Snapshot sub-resources trước khi CASCADE xoá (giữ truy vết audit).
    if (tier === 4) {
      const logs = stmt.listDailyLogsForTaskForSnapshot.all(id);
      const helps = stmt.listHelpMessagesForTaskForSnapshot.all(id);
      const snapshot = {
        task: { id, code: item.code, title: item.title, ...item },
        daily_logs: logs,
        help_messages: helps,
      };
      logAudit('task', id, 'delete', snapshot, null, req);
    } else {
      // T1/T2/T3: ghi log cascade metadata
      logAudit(
        tier === 1 ? 'project' : tier === 2 ? 'phase' : 'bundle',
        id, 'delete', { ...item, _cascade_note: 'Children records (phases/bundles/tasks/daily_logs/help_messages) cascaded.' }, null, req,
      );
    }
    if (tier === 1) stmt.deleteProject.run(id);
    else if (tier === 2) stmt.deletePhase.run(id);
    else if (tier === 3) stmt.deleteBundle.run(id);
    else stmt.deleteTask.run(id);
    // Mục cha mất 1 con → tính lại tiến độ (T1 không có cha).
    const parent = PARENT_OF[tier];
    if (parent && item[parent.fk]) rollupFrom(parent.tier, item[parent.fk]);
  });
  return res.status(204).send();
});

// ============================================================================
// Sub-resources
// ============================================================================

/** GET /api/tasks/4/:id/help-messages — List lịch sử escalation. */
router.get('/:tier(\\d+)/:id(\\d+)/help-messages', (req, res) => {
  const tier = Number(req.params.tier);
  if (tier !== 4) return res.status(400).json({ error: 'help_messages_only_for_task' });
  const id = Number(req.params.id);
  const task = stmt.getTask.get(id);
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  const authz = authorize('task:read', req.user, { task: { ...task, tier: 4 } });
  if (!authz.ok) return res.status(authz.status).json(authz);
  const items = stmt.listHelpMessagesByTask.all(id);
  return res.json({ items });
});

/**
 * POST /api/tasks/:tier/:id/approve — Nghiệm thu.
 *   T4: duyệt việc nhân viên báo xong (pending_approval → done), quyền `task:approve`.
 *   T1–T3: đóng hạng mục / giai đoạn / dự án, quyền `task:close`; chỉ khi MỌI mục con
 *   trực tiếp đã xong. Tầng cha không bao giờ tự sang done (xem lib/rollup.js).
 */
router.post('/:tier(\\d+)/:id(\\d+)/approve', (req, res) => {
  const tier = Number(req.params.tier);
  const id = Number(req.params.id);
  const item = loadItem(tier, id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(item, tier);

  // Explicit guard: done là terminal — KHÔNG cho phép no-op approve trên task đã done.
  // Trước đây canTransition('done','done',...) trả {ok:true} do from===to no-op,
  // cho phép manager "approve" 1 task đã done — gây audit log nhiễu.
  if (item.status === 'done') {
    return res.status(403).json({ error: 'invalid_transition', message: 'Task đã done, không thể duyệt lại.' });
  }

  if (tier < 4) {
    const childDepartments = tier === 3
      ? db.prepare('SELECT DISTINCT department_code AS d FROM tasks WHERE bundle_id = ? AND department_code IS NOT NULL')
        .all(id).map((r) => r.d)
      : [];
    const authz = authorize('task:close', req.user, { task: enriched, childDepartments });
    if (!authz.ok) return res.status(authz.status).json(authz);
    const child = CHILDREN_OF[tier];
    const { n } = db.prepare(
      `SELECT COUNT(*) AS n FROM ${child.table} WHERE ${child.fk} = ? AND status <> 'done'`,
    ).get(id);
    if (n > 0) {
      return res.status(409).json({
        error: 'children_open',
        message: `Còn ${n} ${child.label} chưa xong — chưa thể nghiệm thu.`,
      });
    }
  } else {
    const authz = authorize('task:approve', req.user, { task: enriched });
    if (!authz.ok) return res.status(authz.status).json(authz);
    const tr = canTransition(item.status, 'done', req.user, enriched);
    if (!tr.ok) {
      return res.status(403).json({ error: 'invalid_transition', message: tr.reason });
    }
  }

  tx(() => {
    // Khi manager approve T4 task → done, đảm bảo progress = 100.
    // Logic trước dùng `item.deliverable_completed` (field không tồn tại trong schema)
    // → luôn falsy → giữ progress cũ (0). Fix: force progress=100 khi approve T4.
    // Cho T1/T2/T3 progress rollup sẽ tự cập nhật qua recomputeRollup.
    const progress = tier === 4 ? 100 : (item.progress ?? 0);
    if (tier === 1) {
      stmt.updateProject.run(item.title, item.description, item.owner_user_id, item.start_date, item.end_date, 'done', item.collapsed, id);
    } else if (tier === 2) {
      stmt.updatePhase.run(item.title, item.description, item.owner_user_id, item.start_date, item.end_date, 'done', item.management_notes, item.blocker_alert, item.collapsed, id);
    } else if (tier === 3) {
      stmt.updateBundle.run(item.title, item.description, item.owner_user_id, item.start_date, item.end_date, 'done', item.collapsed, id);
    } else {
      stmt.updateTask.run(
        item.title, item.description, item.owner_user_id, item.assigned_by_user_id,
        item.department_code, item.start_date, item.end_date,
        progress, 'done', item.priority,
        item.is_today ?? 0, item.is_today_date ?? null, item.collapsed,
        item.blocker_note || '', id,
      );
    }
    logAudit(
      tier === 1 ? 'project' : tier === 2 ? 'phase' : tier === 3 ? 'bundle' : 'task',
      id, 'status_change', { status: item.status }, { status: 'done' }, req,
    );
    if (tier === 4) recomputeRollup(id);
  });

  const updated = loadItem(tier, id);
  return res.json({ item: enrichWithTier(updated, tier) });
});

/** Ghi lại 1 task T4 với các trường thay đổi (các trường khác giữ nguyên). */
function rewriteTask(task, changes) {
  const t = { ...task, ...changes };
  stmt.updateTask.run(
    t.title, t.description, t.owner_user_id, t.assigned_by_user_id,
    t.department_code, t.start_date, t.end_date,
    t.progress, t.status, t.priority,
    t.is_today ?? 0, t.is_today_date ?? null, t.collapsed,
    t.blocker_note || '', t.id,
  );
}

/**
 * POST /api/tasks/4/:id/return — Trưởng phòng trả việc "chờ duyệt" về cho NV làm lại.
 * Body: { reason?: string } — lý do không bắt buộc, được ghi vào lịch sử việc.
 * Quyền: như duyệt (`task:approve`).
 */
router.post('/:tier(\\d+)/:id(\\d+)/return', (req, res) => {
  if (Number(req.params.tier) !== 4) return res.status(400).json({ error: 'return_only_for_task' });
  const task = stmt.getTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(task, 4);
  const authz = authorize('task:approve', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);
  if (task.status !== 'pending_approval') {
    return res.status(409).json({ error: 'not_awaiting_approval', message: 'Việc này không ở trạng thái chờ duyệt.' });
  }
  const tr = canTransition(task.status, 'doing', req.user, enriched);
  if (!tr.ok) return res.status(403).json({ error: 'invalid_transition', message: tr.reason });

  const reason = String(req.body?.reason ?? '').trim();
  tx(() => {
    rewriteTask(task, { status: 'doing' });
    logAudit('task', task.id, 'status_change', { status: task.status }, { status: 'doing', returned: true, reason }, req);
    recomputeRollup(task.id);
  });
  return res.json({ item: enrichWithTier(stmt.getTask.get(task.id), 4) });
});

/**
 * POST /api/tasks/4/:id/unblock — Trưởng phòng gỡ vướng mắc: xoá `blocker_note`,
 * đánh dấu đã xử lý mọi help message đang mở, và nếu task đang `blocked` thì chuyển về `doing`.
 * Body: { note?: string } — hướng xử lý, ghi vào lịch sử việc.
 */
router.post('/:tier(\\d+)/:id(\\d+)/unblock', (req, res) => {
  if (Number(req.params.tier) !== 4) return res.status(400).json({ error: 'unblock_only_for_task' });
  const task = stmt.getTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(task, 4);
  const authz = authorize('task:approve', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);
  if (!task.blocker_note && task.status !== 'blocked') {
    return res.status(409).json({ error: 'not_blocked', message: 'Việc này không có vướng mắc nào.' });
  }
  const nextStatus = task.status === 'blocked' ? 'doing' : task.status;
  if (nextStatus !== task.status) {
    const tr = canTransition(task.status, nextStatus, req.user, enriched);
    if (!tr.ok) return res.status(403).json({ error: 'invalid_transition', message: tr.reason });
  }

  const note = String(req.body?.note ?? '').trim();
  tx(() => {
    rewriteTask(task, { status: nextStatus, blocker_note: '' });
    db.prepare(`
      UPDATE task_help_messages
      SET is_resolved = 1, resolved_by_user_id = ?, resolved_at = datetime('now')
      WHERE task_id = ? AND is_resolved = 0
    `).run(req.user.id, task.id);
    logAudit(
      'task', task.id, 'update',
      { status: task.status, blocker_note: task.blocker_note || '' },
      { status: nextStatus, blocker_note: '', unblocked: true, note },
      req,
    );
  });
  return res.json({ item: enrichWithTier(stmt.getTask.get(task.id), 4) });
});

/** POST /api/tasks/:tier/:id/blocker — NV ghi 1 dòng `blocker_note` cho task.
 *  Đồng thời INSERT 1 row vào task_help_messages để giữ lịch sử.
 *  Quyền: owner task hoặc admin/manager trong phòng ban.
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

  let helpMsgId = 0;
  tx(() => {
    stmt.updateTask.run(
      task.title, task.description, task.owner_user_id, task.assigned_by_user_id,
      task.department_code, task.start_date, task.end_date,
      task.progress, task.status, task.priority,
      task.is_today ?? 0, task.is_today_date ?? null, task.collapsed,
      note, // ← blocker_note (current state)
      id,
    );
    // Ghi lịch sử escalation vào help_messages.
    const info = stmt.insertHelpMessage.run(id, note, req.user.id);
    helpMsgId = Number(info.lastInsertRowid);
    logAudit('task', id, 'update', { blocker_note: task.blocker_note || '' }, { blocker_note: note }, req);
    logAudit('task_help_message', helpMsgId, 'create', null, { task_id: id, body: note }, req);
  });

  return res.json({ item: enrichWithTier(stmt.getTask.get(id), tier), blocker_note: note, help_message_id: helpMsgId });
});

/** POST /api/tasks/4/:id/help-messages/:msgId/resolve — Manager đánh dấu help message đã xử lý. */
router.post('/:tier(\\d+)/:id(\\d+)/help-messages/:msgId(\\d+)/resolve', (req, res) => {
  const tier = Number(req.params.tier);
  if (tier !== 4) return res.status(400).json({ error: 'help_messages_only_for_task' });
  const id = Number(req.params.id);
  const msgId = Number(req.params.msgId);
  const task = stmt.getTask.get(id);
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  const authz = authorize('task:edit', req.user, { task: { ...task, tier: 4 } });
  if (!authz.ok) return res.status(authz.status).json(authz);
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin/manager mới resolve help message.' });
  }
  let resolved = false;
  tx(() => {
    const result = stmt.resolveHelpMessage.run(req.user.id, msgId, id);
    // Chỉ ghi audit nếu UPDATE thực sự ảnh hưởng 1 row — trước đây code logAudit
    // không kiểm tra khiến audit log over-count (đặc biệt msgId không tồn tại).
    if (result && result.changes > 0) {
      resolved = true;
      logAudit('task_help_message', msgId, 'resolve', { is_resolved: 0 }, { is_resolved: 1, resolved_by: req.user.username }, req);
    }
  });
  if (!resolved) {
    return res.status(404).json({ error: 'help_message_not_found', message: `Không tìm thấy help message id=${msgId} của task ${id}.` });
  }
  return res.json({ ok: true });
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

  /**
   * Toggle semantics — nhất quán với state machine (lib/stateMachine.js):
   *   pending          → doing            (bắt đầu)
   *   doing            → pending_approval (owner tick xong, chờ manager duyệt)
   *   pending_approval → doing            (manager/admin trả về)
   *   blocked          → doing            (gỡ nghẽn)
   *   done             → KHÔNG toggle (terminal)
   *
   * TRƯỚC ĐÂY toggle tính next = (status === 'done' ? 'doing' : 'done') — nhảy thẳng
   * sang 'done', nhưng state machine KHÔNG cho phép doing→done (done phải qua
   * manager approve) → toggle luôn trả 403 invalid_transition. Fix: map sang
   * transition hợp lệ kế tiếp trong state machine.
   */
  const TOGGLE_NEXT = {
    pending: 'doing',
    doing: 'pending_approval',
    pending_approval: 'doing',
    blocked: 'doing',
  };
  const next = TOGGLE_NEXT[task.status];
  if (!next) {
    return res.status(403).json({
      error: 'invalid_transition',
      message: `Task đã ${task.status}, không thể toggle.`,
    });
  }

  const tr = canTransition(task.status, next, req.user, enriched);
  if (!tr.ok) {
    return res.status(403).json({ error: 'invalid_transition', message: tr.reason });
  }
  // Progress: đạt 100 khi báo xong (pending_approval); các bước khác giữ nguyên
  // tiến độ thật do nhân viên ghi qua nhật ký.
  const nextProgress = next === 'pending_approval' ? 100 : task.progress;

  tx(() => {
    stmt.updateTask.run(
      task.title, task.description, task.owner_user_id, task.assigned_by_user_id,
      task.department_code, task.start_date, task.end_date,
      nextProgress, next, task.priority,
      task.is_today ?? 0, task.is_today_date ?? null, task.collapsed,
      task.blocker_note || '',
      id,
    );
    logAudit('task', id, 'status_change', { status: task.status }, { status: next }, req);
    recomputeRollup(id);
  });

  const updated = stmt.getTask.get(id);
  return res.json({ item: enrichWithTier(updated, tier) });
});

/** POST /api/tasks/4/:id/toggle-today — Owner mark/unmark "today".
 *  Khi bật: set is_today=1, is_today_date=today().
 *  Khi tắt: set is_today=0, is_today_date=null.
 *  Tự động reset qua view: query "today" = is_today=1 AND is_today_date=date('now').
 */
router.post('/:tier(\\d+)/:id(\\d+)/toggle-today', (req, res) => {
  const tier = Number(req.params.tier);
  if (tier !== 4) return res.status(400).json({ error: 'toggle_today_only_for_task' });
  const id = Number(req.params.id);
  const task = stmt.getTask.get(id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  const enriched = enrichWithTier(task, tier);
  const authz = authorize('task:toggle', req.user, { task: enriched });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const currentlyToday = task.is_today === 1 && task.is_today_date === today();
  const nextIsToday = currentlyToday ? 0 : 1;
  const nextIsTodayDate = nextIsToday === 1 ? today() : null;

  tx(() => {
    stmt.setTaskToday.run(nextIsToday, nextIsTodayDate, id);
    logAudit('task', id, 'update', { is_today: task.is_today, is_today_date: task.is_today_date }, { is_today: nextIsToday, is_today_date: nextIsTodayDate }, req);
  });

  const updated = stmt.getTask.get(id);
  return res.json({ item: enrichWithTier(updated, tier) });
});

export default router;
