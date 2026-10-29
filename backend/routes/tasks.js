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
 *   POST   /api/tasks/:tier/:id/approve  — Manager duyệt ({ note?, with_files? } với T4)
 *   POST   /api/tasks/:tier/:id/blocker  — NV ghi blocker_note
 *   POST   /api/tasks/:tier/:id/toggle   — Đổi status ({ note?, with_files? })
 *   POST   /api/tasks/4/:id/return   — TP trả việc chờ duyệt về làm lại ({ reason, with_files? } — reason bắt buộc)
 *   POST   /api/tasks/4/:id/unblock  — TP gỡ vướng mắc ({ note?, with_files? })
 *   GET    /api/tasks/4/:id/messages — Luồng trao đổi (cũ → mới, kèm tệp của từng tin)
 *   POST   /api/tasks/4/:id/messages — Gửi ghi chú / vướng mắc ({ body, kind: 'note'|'blocker', with_files? })
 *   POST   /api/tasks/:tier/:id/archive|unarchive — Lưu trữ / khôi phục dự án (T1), giai đoạn (T2)
 *
 * Người phụ trách (owner_user_id) theo tầng — xem lib/policies.js:
 *   T1 dự án: 1 Điều hành, do HĐQT chọn. T2 giai đoạn: luôn là Điều hành phụ trách dự án.
 *   T3 hạng mục: 1 Trưởng phòng + phòng của hạng mục. T4 đầu việc: Trưởng phòng đó hoặc NV cùng phòng.
 * Ngày của mục con nằm trong khoảng ngày của mục cha; sửa ngày mục cha không được làm con lọt ra ngoài.
 *
 * Ghi chú kèm thao tác: nếu có `note` (hoặc `with_files: true` để gắn tệp ngay sau đó),
 * server tạo 1 tin trong luồng trao đổi và trả `message_id` — client tải tệp lên với id đó
 * (xem routes/attachments.js).
 *
 * Lưu ý:
 *   - recomputeRollup dùng subquery UPDATE single-statement (atomic).
 *   - DELETE T4 snapshot daily_logs + help_messages vào audit_log trước khi CASCADE xoá.
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize, uid } from '../lib/policies.js';
import { canTransition } from '../lib/stateMachine.js';
import { today } from '../lib/dates.js';
import { recomputeRollup, rollupFrom } from '../lib/rollup.js';
import { removeStoredFiles, storedNamesUnder } from '../lib/attachments.js';

const router = Router();
router.use(requireAuth);

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
/** 4 mức ưu tiên: critical (Khẩn cấp) > high (Cao) > normal (Bình thường) > low (Thấp). */
function normalizePriority(p) {
  if (!p) return 'normal';
  const s = String(p).toLowerCase();
  if (['low', 'thấp'].includes(s)) return 'low';
  if (['critical', 'khẩn', 'khẩn cấp'].includes(s)) return 'critical';
  if (['high', 'cao'].includes(s)) return 'high';
  return 'normal';
}

/** Xem được mục này không — cùng luật với policy `task:read`. */
function canSee(user, item) {
  return authorize('task:read', user, { task: item }).ok;
}

const TIER_LABEL = { 1: 'dự án', 2: 'giai đoạn', 3: 'hạng mục', 4: 'đầu việc' };
const TIER_ENTITY = { 1: 'project', 2: 'phase', 3: 'bundle', 4: 'task' };

/** Bảng con trực tiếp của mục cha (T1–T3) — dùng khi nghiệm thu. */
const CHILDREN_OF = {
  1: { table: 'phases', fk: 'project_id', label: 'giai đoạn', where: 'AND archived_at IS NULL' },
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

/**
 * Mục nằm trong nhánh đã lưu trữ? (chính nó, hoặc giai đoạn / dự án chứa nó có `archived_at`).
 * Nhánh lưu trữ là chỉ đọc: không tạo con, không sửa, không nghiệm thu.
 */
const ARCHIVED_SQL = {
  1: `SELECT p.archived_at AS a FROM projects p WHERE p.id = ?`,
  2: `SELECT COALESCE(ph.archived_at, p.archived_at) AS a
        FROM phases ph JOIN projects p ON p.id = ph.project_id WHERE ph.id = ?`,
  3: `SELECT COALESCE(ph.archived_at, p.archived_at) AS a
        FROM bundles b JOIN phases ph ON ph.id = b.phase_id JOIN projects p ON p.id = ph.project_id
       WHERE b.id = ?`,
  4: `SELECT COALESCE(ph.archived_at, p.archived_at) AS a
        FROM tasks t LEFT JOIN bundles b ON b.id = t.bundle_id
        LEFT JOIN phases ph ON ph.id = b.phase_id LEFT JOIN projects p ON p.id = ph.project_id
       WHERE t.id = ?`,
};
export function isInArchive(tier, id) {
  const sql = ARCHIVED_SQL[Number(tier)];
  return !!(sql && db.prepare(sql).get(Number(id))?.a);
}
export const ARCHIVED_ERROR = {
  error: 'archived',
  message: 'Mục này thuộc dự án / giai đoạn đã lưu trữ — khôi phục trước khi chỉnh sửa.',
};

/** Helper: thêm tier vào row để policy + transform xử lý. */
function enrichWithTier(row, tier) {
  if (!row) return null;
  return { ...row, tier: Number(tier) };
}

/** Mục theo tier + id, đã gắn `tier` (null nếu không có). */
export function loadTierItem(tier, id) {
  return enrichWithTier(loadItem(tier, id), tier);
}

/**
 * Người được chọn làm phụ trách (body.owner_user_id hoặc body.owner_username), kèm phòng ban.
 * undefined = body không chỉ định; null = không tìm thấy user đang hoạt động.
 */
function loadAssignee(body) {
  let row;
  if (body.owner_user_id != null && body.owner_user_id !== '') {
    row = db.prepare('SELECT id, role, fullname FROM users WHERE id = ? AND is_active = 1').get(Number(body.owner_user_id));
  } else if (typeof body.owner_username === 'string' && body.owner_username.trim()) {
    row = db.prepare('SELECT id, role, fullname FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1')
      .get(body.owner_username.trim());
  } else {
    return undefined;
  }
  if (!row) return null;
  return { ...row, departments: stmt.getUserDepartments.all(row.id).map((d) => d.department_code) };
}

/** dd/mm/yyyy cho thông báo lỗi. */
function viDate(iso) {
  return iso ? iso.split('-').reverse().join('/') : '';
}

/**
 * Ngày [start, end] của mục tầng `tier` phải nằm trong mục cha `parent`, và (khi sửa mục
 * `id` đã có) vẫn chứa mọi mục con trực tiếp. Trả `{ error, message }` hoặc null.
 */
function checkDateBounds(tier, parent, start, end, id) {
  if (parent && ((parent.start_date && start < parent.start_date) || (parent.end_date && end > parent.end_date))) {
    return {
      error: 'outside_parent_range',
      message: `Thời gian phải nằm trong ${TIER_LABEL[tier - 1]} cấp trên (${viDate(parent.start_date)} – ${viDate(parent.end_date)}).`,
    };
  }
  const child = id ? CHILDREN_OF[tier] : null;
  if (child) {
    const r = db.prepare(
      `SELECT MIN(start_date) AS s, MAX(end_date) AS e FROM ${child.table} WHERE ${child.fk} = ?`,
    ).get(id);
    if ((r.s && start > r.s) || (r.e && end < r.e)) {
      return {
        error: 'children_outside_range',
        message: `Các ${child.label} bên trong đang kéo dài ${viDate(r.s)} – ${viDate(r.e)}; thời gian mới phải bao trọn khoảng này.`,
      };
    }
  }
  return null;
}

/** Audit log helper. */
export function logAudit(entityType, entityId, action, oldValues, newValues, req) {
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

/**
 * Thêm 1 tin vào luồng trao đổi của task (gọi trong tx()). Trả id tin.
 * `kind` xem schema.sql (note | blocker | start | submit | approve | return | unblock).
 */
function addMessage(taskId, kind, body, req) {
  const info = stmt.insertHelpMessage.run(taskId, body, req.user.id, kind);
  const id = Number(info.lastInsertRowid);
  logAudit('task_help_message', id, 'create', null, { task_id: taskId, kind, body }, req);
  return id;
}

/**
 * Ghi chú kèm thao tác đổi trạng thái: tạo tin khi có nội dung, hoặc khi client
 * báo sẽ gắn tệp (`with_files`). Trả id tin hoặc null.
 */
function addActionNote(taskId, kind, req, text = req.body?.note) {
  const body = String(text ?? '').trim();
  if (!body && !req.body?.with_files) return null;
  return addMessage(taskId, kind, body, req);
}

/** Ghi vướng mắc: cập nhật `blocker_note` (dòng hiện tại) + 1 tin `blocker` trong luồng trao đổi. */
function reportBlocker(task, note, req) {
  rewriteTask(task, { blocker_note: note });
  logAudit('task', task.id, 'update', { blocker_note: task.blocker_note || '' }, { blocker_note: note }, req);
  return addMessage(task.id, 'blocker', note, req);
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

  // `archived` = 1 nếu chính mục hoặc dự án / giai đoạn chứa nó đã lưu trữ.
  const archivedProjects = new Set(projects.filter((p) => p.archived_at).map((p) => p.id));
  const archivedPhases = new Set(
    phases.filter((ph) => ph.archived_at || archivedProjects.has(ph.project_id)).map((ph) => ph.id),
  );
  const archivedBundles = new Set(bundles.filter((b) => archivedPhases.has(b.phase_id)).map((b) => b.id));

  const all = [
    ...projects.map((p) => ({ ...p, tier: 1, archived: archivedProjects.has(p.id) ? 1 : 0 })),
    ...phases.map((p) => ({ ...p, tier: 2, archived: archivedPhases.has(p.id) ? 1 : 0 })),
    ...bundles.map((b) => ({ ...b, tier: 3, archived: archivedBundles.has(b.id) ? 1 : 0 })),
    ...tasks.map((t) => ({ ...t, tier: 4, archived: archivedBundles.has(t.bundle_id) ? 1 : 0 })),
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

/**
 * POST /api/tasks — Tạo mới.
 * Body: { tier, parent_id (T2–T4), title, owner_user_id | owner_username, department_code (T3), ... }
 *   T1: owner bắt buộc, là 1 Điều hành. T2: owner = Điều hành phụ trách dự án (bỏ qua body).
 *   T3: owner bắt buộc, là Trưởng phòng; department_code mặc định = phòng đầu tiên của người đó.
 *   T4: owner mặc định = người tạo; phòng ban = phòng của hạng mục.
 */
router.post('/', (req, res) => {
  const body = req.body || {};
  const tierNum = Number(body.tier);
  if (!Number.isInteger(tierNum) || tierNum < 1 || tierNum > 4) {
    return res.status(400).json({ error: 'invalid_tier' });
  }

  // ============================================================
  // IMPORTANT: All pre-tx() validation MUST send response and early-return.
  // Sending any response (res.status().json/send) inside tx() callback AND
  // then letting control flow fall through to the post-tx return causes
  // ERR_HTTP_HEADERS_SENT. Move validation OUT of tx() below.
  // ============================================================

  let parent = null;
  if (tierNum > 1) {
    if (!(body.parent_id && Number(body.parent_id))) {
      return res.status(400).json({ error: 'parent_id_required', message: `Cần chọn ${TIER_LABEL[tierNum - 1]} cấp trên.` });
    }
    parent = enrichWithTier(loadItem(tierNum - 1, body.parent_id), tierNum - 1);
    if (!parent) return res.status(404).json({ error: 'parent_not_found', message: `Không tìm thấy ${TIER_LABEL[tierNum - 1]} cấp trên.` });
  }
  const authz = authorize('task:create', req.user, { tier: tierNum, parent });
  if (!authz.ok) return res.status(authz.status).json(authz);
  if (parent && isInArchive(tierNum - 1, parent.id)) {
    return res.status(409).json(ARCHIVED_ERROR);
  }

  // Người phụ trách theo tầng.
  let assignee = loadAssignee(body);
  if (assignee === null) {
    return res.status(404).json({ error: 'owner_not_found', message: 'Không tìm thấy người được giao.' });
  }
  if (tierNum === 1 || tierNum === 3) {
    if (!assignee) {
      return res.status(400).json({
        error: 'owner_required',
        message: tierNum === 1 ? 'Cần chọn Điều hành phụ trách dự án.' : 'Cần chọn Trưởng phòng phụ trách hạng mục.',
      });
    }
  }
  if (tierNum === 4 && !assignee) {
    assignee = { id: req.user.id, role: req.user.role, departments: req.user.departments };
  }
  const department = tierNum === 3
    ? (body.department_code || assignee.departments[0] || null)
    : tierNum === 4 ? parent.department_code : null;
  const ownerId = tierNum === 2 ? parent.owner_user_id : assignee.id;
  if (tierNum !== 2) {
    const ok = authorize('task:assign', req.user, { tier: tierNum, assignee, department, bundle: parent });
    if (!ok.ok) return res.status(ok.status).json(ok);
  }

  // Ngày: mặc định theo mục cha; luôn nằm trong khoảng của mục cha.
  if (!isIsoDate(body.start_date) || !isIsoDate(body.end_date)) {
    return res.status(400).json({ error: 'invalid_date', message: 'start_date và end_date phải có format YYYY-MM-DD.' });
  }
  const startDate = body.start_date
    || (parent?.start_date && parent.start_date > today() ? parent.start_date : today());
  const endDate = body.end_date || parent?.end_date || '2099-12-31';
  if (startDate > endDate) {
    return res.status(400).json({ error: 'invalid_date_range', message: 'Ngày bắt đầu phải trước hoặc bằng hạn chót.' });
  }
  const bounds = checkDateBounds(tierNum, parent, startDate, endDate, null);
  if (bounds) return res.status(400).json(bounds);

  // Validate is_today_date format for T4
  if (tierNum === 4 && body.is_today_date && !isIsoDate(body.is_today_date)) {
    return res.status(400).json({ error: 'invalid_is_today_date' });
  }

  let lastId = 0;
  tx(() => {
    const code = body.code || `NEW-${uid().slice(-6).toUpperCase()}`;
    const title = String(body.title || '').trim() || 'Chưa đặt tên';
    const status = normalizeStatus(body.status);
    const priority = normalizePriority(body.priority);

    if (tierNum === 1) {
      const info = stmt.insertProject.run(
        code, title, body.description || '',
        ownerId, req.user.id,
        startDate, endDate, status,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
    } else if (tierNum === 2) {
      const info = stmt.insertPhase.run(
        parent.id, code, title, body.description || '',
        ownerId, req.user.id,
        startDate, endDate, status,
        body.management_notes || '',
        body.blocker_alert || null,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
    } else if (tierNum === 3) {
      const info = stmt.insertBundle.run(
        parent.id, code, title, body.description || '',
        ownerId, req.user.id, department,
        startDate, endDate, status,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
    } else { // tier 4
      // is_today_date mặc định = hôm nay nếu is_today=1, else null.
      const isToday = body.is_today ? 1 : 0;
      const isTodayDate = isToday
        ? (body.is_today_date ?? today())
        : null;
      const info = stmt.insertTask.run(
        parent.id, code, title, body.description || '',
        ownerId, req.user.id, req.user.id,
        department,
        startDate, endDate,
        Number(body.progress ?? 0), status, priority,
        isToday, isTodayDate,
        body.collapsed ? 1 : 0,
      );
      lastId = Number(info.lastInsertRowid);
    }
    logAudit(TIER_ENTITY[tierNum], lastId, 'create', null, { code, title, owner_user_id: ownerId }, req);
    // Mục cha có thêm 1 con (0%) → tính lại tiến độ.
    if (parent) rollupFrom(tierNum - 1, parent.id);
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
  if (isInArchive(tier, id)) return res.status(409).json(ARCHIVED_ERROR);

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
  if (body.start_date !== undefined || body.end_date !== undefined) {
    const parentRef = PARENT_OF[tier];
    const parent = parentRef ? loadItem(parentRef.tier, item[parentRef.fk]) : null;
    const bounds = checkDateBounds(tier, parent, nextStart, nextEnd, id);
    if (bounds) return res.status(400).json(bounds);
  }

  // Đổi người phụ trách: cần quyền `task:reassign`, người mới phải hợp lệ với tầng (`task:assign`).
  let nextOwnerId = item.owner_user_id;
  const assignee = loadAssignee(body);
  if (assignee === null) {
    return res.status(404).json({ error: 'owner_not_found', message: 'Không tìm thấy người được giao.' });
  }
  if (assignee && assignee.id !== item.owner_user_id) {
    const can = authorize('task:reassign', req.user, { task: enriched });
    if (!can.ok) return res.status(can.status).json(can);
    const bundle = tier === 4 ? stmt.getBundle.get(item.bundle_id) : null;
    const ok = authorize('task:assign', req.user, { tier, assignee, department: item.department_code, bundle });
    if (!ok.ok) return res.status(ok.status).json(ok);
    nextOwnerId = assignee.id;
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
        nextOwnerId,
        body.start_date ?? item.start_date,
        body.end_date ?? item.end_date,
        body.status ?? item.status,
        body.collapsed !== undefined ? (body.collapsed ? 1 : 0) : item.collapsed,
        id,
      );
      // Giai đoạn luôn do Điều hành phụ trách dự án quản lý.
      if (nextOwnerId !== item.owner_user_id) stmt.setPhaseOwnersOfProject.run(nextOwnerId, id);
      updated = stmt.getProject.get(id);
    } else if (tier === 2) {
      stmt.updatePhase.run(
        body.title ?? item.title,
        body.description ?? item.description,
        nextOwnerId,
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
        nextOwnerId,
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
        nextOwnerId,
        // Giao lại cho người khác → người giao là người vừa đổi.
        nextOwnerId !== item.owner_user_id ? req.user.id : item.assigned_by_user_id,
        item.department_code,
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
    logAudit(TIER_ENTITY[tier], id, 'update', oldValues, body, req);
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

  // Tệp đính kèm của cả nhánh — xoá khỏi đĩa sau khi DB đã xoá xong.
  const storedFiles = storedNamesUnder(tier, id);
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
        TIER_ENTITY[tier],
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
  removeStoredFiles(storedFiles);
  return res.status(204).send();
});

// ============================================================================
// Sub-resources
// ============================================================================

/**
 * POST /api/tasks/:tier/:id/archive | unarchive — Lưu trữ / khôi phục dự án (T1) hoặc giai đoạn (T2).
 * Lưu trữ thay cho xoá: dữ liệu giữ nguyên, cả nhánh con ẩn khỏi app (GET trả `archived = 1`).
 * Quyền: `task:archive` (Điều hành phụ trách; HĐQT với dự án; admin).
 */
router.post('/:tier(\\d+)/:id(\\d+)/:op(archive|unarchive)', (req, res) => {
  const tier = Number(req.params.tier);
  const id = Number(req.params.id);
  const item = loadItem(tier, id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const authz = authorize('task:archive', req.user, { task: enrichWithTier(item, tier) });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const archive = req.params.op === 'archive';
  if (archive && item.archived_at) {
    return res.status(409).json({ error: 'already_archived', message: 'Mục này đã được lưu trữ.' });
  }
  if (!archive && !item.archived_at) {
    return res.status(409).json({ error: 'not_archived', message: 'Mục này không ở trạng thái lưu trữ.' });
  }
  if (!archive && tier === 2 && isInArchive(1, item.project_id)) {
    return res.status(409).json({ error: 'parent_archived', message: 'Dự án chứa giai đoạn này đang lưu trữ — khôi phục dự án trước.' });
  }

  tx(() => {
    if (tier === 1) stmt.setProjectArchived.run(archive ? 1 : 0, id);
    else stmt.setPhaseArchived.run(archive ? 1 : 0, id);
    logAudit(tier === 1 ? 'project' : 'phase', id, 'update',
      { archived_at: item.archived_at ?? null }, { archived: archive }, req);
    // Giai đoạn vào / ra khỏi lưu trữ → tiến độ dự án tính lại.
    if (tier === 2) rollupFrom(1, item.project_id);
  });
  return res.json({ item: enrichWithTier(loadItem(tier, id), tier) });
});

/**
 * GET /api/tasks/4/:id/messages (alias cũ: /help-messages) — Luồng trao đổi, cũ → mới.
 * Mỗi tin kèm `attachments` (tệp gắn trong tin đó).
 */
router.get('/:tier(\\d+)/:id(\\d+)/:res(messages|help-messages)', (req, res) => {
  const tier = Number(req.params.tier);
  if (tier !== 4) return res.status(400).json({ error: 'help_messages_only_for_task' });
  const id = Number(req.params.id);
  const task = stmt.getTask.get(id);
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  const authz = authorize('task:read', req.user, { task: { ...task, tier: 4 } });
  if (!authz.ok) return res.status(authz.status).json(authz);
  const files = stmt.listAttachmentsByTask.all(id).filter((f) => f.message_id != null);
  const items = stmt.listHelpMessagesByTask.all(id).map((m) => ({
    ...m,
    attachments: files.filter((f) => f.message_id === m.id),
  }));
  return res.json({ items });
});

/**
 * POST /api/tasks/4/:id/messages — Gửi ghi chú (`kind: 'note'`) hoặc báo vướng mắc
 * (`kind: 'blocker'`, như /blocker). Body: { body, kind, with_files? }.
 * Quyền: như sửa task (`task:edit` — NV làm việc đó, TP phòng đó, admin).
 */
router.post('/:tier(\\d+)/:id(\\d+)/messages', (req, res) => {
  if (Number(req.params.tier) !== 4) return res.status(400).json({ error: 'messages_only_for_task' });
  const task = stmt.getTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  const authz = authorize('task:edit', req.user, { task: enrichWithTier(task, 4) });
  if (!authz.ok) return res.status(authz.status).json(authz);
  if (isInArchive(4, task.id)) return res.status(409).json(ARCHIVED_ERROR);

  const kind = req.body?.kind === 'blocker' ? 'blocker' : 'note';
  const body = String(req.body?.body ?? '').trim();
  if (!body && (kind === 'blocker' || !req.body?.with_files)) {
    return res.status(400).json({ error: 'body_required', message: 'Cần nhập nội dung.' });
  }

  let messageId = 0;
  tx(() => {
    messageId = kind === 'blocker' ? reportBlocker(task, body, req) : addMessage(task.id, 'note', body, req);
  });
  return res.status(201).json({ message_id: messageId, item: enrichWithTier(stmt.getTask.get(task.id), 4) });
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
  if (isInArchive(tier, id)) return res.status(409).json(ARCHIVED_ERROR);

  if (tier < 4) {
    const authz = authorize('task:close', req.user, { task: enriched });
    if (!authz.ok) return res.status(authz.status).json(authz);
    const child = CHILDREN_OF[tier];
    const { n } = db.prepare(
      `SELECT COUNT(*) AS n FROM ${child.table} WHERE ${child.fk} = ? AND status <> 'done' ${child.where ?? ''}`,
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

  let messageId = null;
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
    logAudit(TIER_ENTITY[tier], id, 'status_change', { status: item.status }, { status: 'done' }, req);
    if (tier === 4) {
      messageId = addActionNote(id, 'approve', req);
      recomputeRollup(id);
    }
  });

  const updated = loadItem(tier, id);
  return res.json({ item: enrichWithTier(updated, tier), message_id: messageId });
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
 * Body: { reason: string, with_files? } — lý do BẮT BUỘC, thành 1 tin `return` trong luồng trao đổi.
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
  if (!reason) {
    return res.status(400).json({ error: 'reason_required', message: 'Cần nhập lý do trả về để nhân viên biết phải sửa gì.' });
  }
  let messageId = null;
  tx(() => {
    rewriteTask(task, { status: 'doing' });
    logAudit('task', task.id, 'status_change', { status: task.status }, { status: 'doing', returned: true, reason }, req);
    messageId = addActionNote(task.id, 'return', req, reason);
    recomputeRollup(task.id);
  });
  return res.json({ item: enrichWithTier(stmt.getTask.get(task.id), 4), message_id: messageId });
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
  let messageId = null;
  tx(() => {
    rewriteTask(task, { status: nextStatus, blocker_note: '' });
    db.prepare(`
      UPDATE task_help_messages
      SET is_resolved = 1, resolved_by_user_id = ?, resolved_at = datetime('now')
      WHERE task_id = ? AND kind = 'blocker' AND is_resolved = 0
    `).run(req.user.id, task.id);
    logAudit(
      'task', task.id, 'update',
      { status: task.status, blocker_note: task.blocker_note || '' },
      { status: nextStatus, blocker_note: '', unblocked: true, note },
      req,
    );
    messageId = addActionNote(task.id, 'unblock', req, note);
  });
  return res.json({ item: enrichWithTier(stmt.getTask.get(task.id), 4), message_id: messageId });
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
  if (isInArchive(4, id)) return res.status(409).json(ARCHIVED_ERROR);

  const body = req.body || {};
  const note = String(body.note ?? '').trim();
  if (!note) return res.status(400).json({ error: 'note_required' });

  let helpMsgId = 0;
  tx(() => {
    helpMsgId = reportBlocker(task, note, req);
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
  const can = authorize('task:approve', req.user, { task: { ...task, tier: 4 } });
  if (!can.ok) return res.status(can.status).json(can);
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
   *                      → done              nếu chính owner có quyền duyệt (TP phụ trách hạng mục / admin)
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
  let next = TOGGLE_NEXT[task.status];
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
  // Người báo xong cũng là người duyệt → đóng luôn, không tự gửi duyệt cho chính mình.
  if (next === 'pending_approval' && authorize('task:approve', req.user, { task: enriched }).ok) {
    next = 'done';
  }
  // Progress: đạt 100 khi báo xong / hoàn thành; các bước khác giữ nguyên
  // tiến độ thật do nhân viên ghi qua nhật ký.
  const nextProgress = next === 'pending_approval' || next === 'done' ? 100 : task.progress;
  // Loại tin trao đổi cho ghi chú đi kèm (nếu có).
  const noteKind =
    next === 'pending_approval' ? 'submit'
      : next === 'done' ? 'approve'
        : task.status === 'pending' ? 'start'
          : task.status === 'blocked' ? 'unblock'
            : 'return';

  let messageId = null;
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
    messageId = addActionNote(id, noteKind, req);
    recomputeRollup(id);
  });

  const updated = stmt.getTask.get(id);
  return res.json({ item: enrichWithTier(updated, tier), message_id: messageId });
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
