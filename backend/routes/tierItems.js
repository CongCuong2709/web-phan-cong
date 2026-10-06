/**
 * routes/tierItems.js — CRUD cho TierItem (cây 4 tầng).
 *
 * GET    /api/tier-items             → Filter theo role+department
 * GET    /api/tier-items/:id         → 1 item (kèm deliverables, subtasks nếu T4)
 * POST   /api/tier-items             → Tạo (check canCreateTiers)
 * PATCH  /api/tier-items/:id         → Update (check canEditTierItem)
 * DELETE /api/tier-items/:id         → Xoá (admin only)
 *
 * Tất cả mutations đều:
 *   - Chạy trong `tx()` để auto rollback nếu có lỗi
 *   - Ghi history_entries
 *   - (PATCH T3/T4) trigger auto-rollup parent
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTierCreatePermission } from '../middleware/rbac.js';
import { canEditTierItem, inDepartment, uid } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** Quyết định xem user có thấy 1 tier item không (mirror frontend). */
function canSee(user, item) {
  if (user.role === 'admin' || user.role === 'director') return true;
  if (user.role === 'manager') {
    // T1 projects: manager LUÔN thấy như read-only context header — đúng pattern
    // enterprise (BGĐ-owned project mà manager phụ trách phase bên dưới).
    // Edit bị chặn bởi canEditTierItem ở middleware/check riêng.
    if (item.tier === 1) return true;
    return inDepartment(user, item.department_code);
  }
  // employee: chỉ T4 của chính mình
  return item.tier === 4 && item.owner_username_str === user.username;
}

/** Auto-rollup: tính lại progress của parent (và đệ quy lên trên). */
function recomputeRollup(parentId) {
  if (!parentId) return;
  const children = stmt.getChildrenProgress.all(parentId);
  if (children.length === 0) return;
  const avg = Math.round(children.reduce((acc, c) => acc + c.progress, 0) / children.length);
  const status = avg === 100 ? 'Đã xong' : avg > 90 ? 'Sắp xong' : 'Đang chạy';
  db.exec(`UPDATE tier_items SET progress = ${avg}, status = '${status}' WHERE id = ${parentId}`);
  // Đệ quy lên parent của parent
  const parent = stmt.getTierParent.get(parentId);
  if (parent?.parent_id) recomputeRollup(parent.parent_id);
}

/** GET /api/tier-items — List filtered theo role. */
router.get('/', (req, res) => {
  const all = stmt.listTierItems.all();
  const visible = all.filter((item) => canSee(req.user, item));
  return res.json({ items: visible });
});

/** GET /api/tier-items/:id — Chi tiết 1 item + deliverables + subtasks. */
router.get('/:id(\\d+)', (req, res) => {
  const item = stmt.getTierItem.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not_found' });
  if (!canSee(req.user, item)) return res.status(403).json({ error: 'forbidden' });
  const deliverables = stmt.listDeliverablesByTier.all(item.id);
  const subtasks = stmt.getSubtasksByTier.all(item.id);
  return res.json({ item, deliverables, subtasks });
});

/** POST /api/tier-items — Tạo mới. */
router.post('/', requireTierCreatePermission, (req, res) => {
  const body = req.body || {};
  const tierNum = Number(body.tier);

  let lastId = 0;
  tx(() => {
    const info = stmt.insertTierItem.run(
      body.code || `NEW-${uid().slice(-6).toUpperCase()}`,
      tierNum,
      String(body.title || '').trim() || 'Chưa đặt tên',
      body.parent_id ? Number(body.parent_id) : null,
      body.department ?? null,
      body.owner_user_id ? Number(body.owner_user_id) : req.user.id,
      body.deadline || '2099-12-31',
      Number(body.progress ?? 0),
      body.status || 'Chuẩn bị',
      body.priority || 'Trung bình',
      body.description || '',
      body.management_notes || '',
      Number(body.start_week ?? 1),
      Number(body.end_week ?? 2),
      body.gantt_label || null,
      body.gantt_bar_color || '#004ac6',
    );
    lastId = Number(info.lastInsertRowid);

    // History
    const entityType = tierNum === 1 ? 'project'
      : tierNum === 2 ? 'phase'
      : tierNum === 3 ? 'bundle'
      : 'task';
    stmt.insertHistory.run(
      entityType,
      lastId,
      `Tạo ${body.code || 'mới'}: ${body.title || ''}`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
  });

  const created = stmt.getTierItem.get(lastId);
  return res.status(201).json({ item: created });
});

/** PATCH /api/tier-items/:id — Update (progress, status, ...). */
router.patch('/:id(\\d+)', (req, res) => {
  const item = stmt.getTierItem.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not_found' });
  if (!canEditTierItem(req.user, item)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body || {};
  const oldProgress = item.progress;

  tx(() => {
    stmt.updateTierItem.run(
      body.title ?? item.title,
      Number(body.progress ?? item.progress),
      body.status ?? item.status,
      body.priority ?? item.priority,
      body.deadline ?? item.deadline,
      body.description ?? item.description,
      body.management_notes ?? item.management_notes,
      body.blocker_alert ?? item.blocker_alert ?? null,
      body.is_blocked ? 1 : 0,
      Number(body.start_week ?? item.start_week),
      Number(body.end_week ?? item.end_week),
      body.gantt_label ?? item.gantt_label ?? null,
      body.gantt_bar_color ?? item.gantt_bar_color ?? '#004ac6',
      item.id,
    );

    // History
    const entityType = item.tier === 1 ? 'project'
      : item.tier === 2 ? 'phase'
      : item.tier === 3 ? 'bundle'
      : 'task';
    stmt.insertHistory.run(
      entityType,
      item.id,
      `Cập nhật ${item.code}: ${body.progress ?? item.progress}%`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );

    // Auto-rollup nếu đổi progress của T3/T4
    const newProgress = Number(body.progress ?? oldProgress);
    if (newProgress !== oldProgress && (item.tier === 3 || item.tier === 4)) {
      recomputeRollup(item.parent_id);
    }
  });

  const updated = stmt.getTierItem.get(item.id);
  return res.json({ item: updated });
});

/** DELETE /api/tier-items/:id — Admin only (cascade to subtasks/deliverables). */
router.delete('/:id(\\d+)', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin mới được xoá.' });
  }
  const item = stmt.getTierItem.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not_found' });
  tx(() => {
    // History trước khi xoá (vì cascade sẽ xoá hết)
    stmt.insertHistory.run(
      'task',
      item.id,
      `Xoá ${item.code}: ${item.title}`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
    stmt.deleteTierItem.run(item.id);
  });
  return res.status(204).send();
});

export default router;