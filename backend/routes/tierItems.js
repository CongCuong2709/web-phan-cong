/**
 * routes/tierItems.js — CRUD cho TierItem (cây 4 tầng).
 *
 * GET    /api/tier-items             → Filter theo role+department
 * GET    /api/tier-items/:id         → 1 item (kèm deliverables, subtasks nếu T4)
 * POST   /api/tier-items             → Tạo (check canCreateTiers)
 * PATCH  /api/tier-items/:id         → Update (check canEditTierItem)
 * DELETE /api/tier-items/:id         → Xoá (admin only)
 *
 * Tất cả mutations đều ghi history_entries + (sau này) broadcast qua WebSocket.
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTierCreatePermission } from '../middleware/rbac.js';
import { canEditTierItem, inDepartment, uid } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/**
 * Quyết định xem user có thấy 1 tier item không (mirror với frontend).
 */
function canSee(user, item) {
  if (user.role === 'admin' || user.role === 'director') return true;
  if (user.role === 'manager') return inDepartment(user, item.department_code);
  // employee: chỉ T4 của chính mình (dùng để check sau khi join owner_username)
  return item.tier === 4 && item.owner_username_str === user.username;
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
  const deliverables = db.prepare('SELECT * FROM deliverables WHERE tier_item_id = ? ORDER BY sort_order, id').all(item.id);
  const subtasks = db.prepare('SELECT * FROM subtasks WHERE tier_item_id = ? ORDER BY id').all(item.id);
  return res.json({ item, deliverables, subtasks });
});

/** POST /api/tier-items — Tạo mới. */
router.post('/', requireTierCreatePermission, (req, res) => {
  const body = req.body || {};
  const itemId = tx(() => {
    const info = stmt.createTierItem.run({
      code: body.code || `NEW-${uid().slice(-6).toUpperCase()}`,
      tier: Number(body.tier),
      title: String(body.title || '').trim() || 'Chưa đặt tên',
      parent_id: body.parent_id ? Number(body.parent_id) : null,
      department_code: body.department ?? null,
      // Owner mặc định là current user (resolve từ req.user.id); override nếu body chỉ định.
      owner_user_id: body.owner_user_id ? Number(body.owner_user_id) : req.user.id,
      deadline: body.deadline || '2099-12-31',
      progress: Number(body.progress ?? 0),
      status: body.status || 'Chuẩn bị',
      priority: body.priority || 'Trung bình',
      description: body.description || '',
      management_notes: body.management_notes || '',
      start_week: Number(body.start_week ?? 1),
      end_week: Number(body.end_week ?? 2),
      gantt_label: body.gantt_label || null,
      gantt_bar_color: body.gantt_bar_color || '#004ac6',
    });

    // History
    db.prepare(`INSERT INTO history_entries
      (entity_type, entity_id, action, author_user_id, author_username, author_fullname)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      Number(body.tier) === 1 ? 'project'
        : Number(body.tier) === 2 ? 'phase'
        : Number(body.tier) === 3 ? 'bundle'
        : 'task',
      info.lastInsertRowid,
      `Tạo ${body.code || 'mới'}: ${body.title || ''}`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
    return info.lastInsertRowid;
  });

  const created = stmt.getTierItem.get(Number(itemId));
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
  tx(() => {
    stmt.updateTierItem.run({
      id: item.id,
      title: body.title ?? item.title,
      progress: Number(body.progress ?? item.progress),
      status: body.status ?? item.status,
      priority: body.priority ?? item.priority,
      deadline: body.deadline ?? item.deadline,
      description: body.description ?? item.description,
      management_notes: body.management_notes ?? item.management_notes,
      blocker_alert: body.blocker_alert ?? item.blocker_alert ?? null,
      is_blocked: body.is_blocked ? 1 : 0,
      start_week: Number(body.start_week ?? item.start_week),
      end_week: Number(body.end_week ?? item.end_week),
      gantt_label: body.gantt_label ?? item.gantt_label ?? null,
      gantt_bar_color: body.gantt_bar_color ?? item.gantt_bar_color ?? '#004ac6',
    });

    // History
    db.prepare(`INSERT INTO history_entries
      (entity_type, entity_id, action, author_user_id, author_username, author_fullname)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      item.tier === 1 ? 'project'
        : item.tier === 2 ? 'phase'
        : item.tier === 3 ? 'bundle'
        : 'task',
      item.id,
      `Cập nhật ${item.code}: ${body.progress ?? item.progress}%`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );

    // Auto-rollup: nếu đổi progress của T3 hoặc T4, tính lại parent
    if (body.progress !== undefined && (item.tier === 3 || item.tier === 4)) {
      recomputeRollup(item.parent_id || item.id);
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
    db.prepare(`INSERT INTO history_entries
      (entity_type, entity_id, action, author_user_id, author_username, author_fullname)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'task', item.id, `Xoá ${item.code}: ${item.title}`,
      req.user.id, req.user.username, req.user.fullname,
    );
    stmt.deleteTierItem.run(item.id);
  });
  return res.status(204).send();
});

/**
 * Auto-rollup: sau khi T3 hoặc T4 đổi progress, tính lại T2 → T1.
 * @param {number|null} parentId Tier item cha (T2 hoặc T3).
 */
function recomputeRollup(parentId) {
  if (!parentId) return;
  const children = db.prepare('SELECT progress FROM tier_items WHERE parent_id = ?').all(parentId);
  if (children.length === 0) return;
  const avg = Math.round(children.reduce((acc, c) => acc + c.progress, 0) / children.length);
  const status = avg === 100 ? 'Đã xong' : avg > 90 ? 'Sắp xong' : 'Đang chạy';
  db.prepare('UPDATE tier_items SET progress = ?, status = ? WHERE id = ?').run(avg, status, parentId);
  // Đệ quy lên parent của parent
  const parent = db.prepare('SELECT id, parent_id FROM tier_items WHERE id = ?').get(parentId);
  if (parent?.parent_id) recomputeRollup(parent.parent_id);
}

export default router;