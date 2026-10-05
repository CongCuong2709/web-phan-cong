/**
 * routes/deliverables.js — CRUD cho Deliverable (kết quả bàn giao).
 *
 * Endpoints:
 *   GET    /api/tier-items/:tierId/deliverables   — List (parent's children)
 *   POST   /api/tier-items/:tierId/deliverables   — Tạo (canEditTier)
 *   PATCH  /api/deliverables/:id/toggle          — Toggle completed
 *   DELETE /api/deliverables/:id                 — Xoá (canEditTier)
 *
 * Toggle là endpoint riêng vì frontend cần nó thường xuyên nhất (đánh dấu
 * "đạt" / "chưa đạt" → auto-tính progress của tier_item cha).
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canEditTierItem } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** GET /api/tier-items/:tierId/deliverables — List deliverables của tier item. */
router.get('/tier-items/:tierId/deliverables', (req, res) => {
  const tierItem = stmt.getTierItem.get(Number(req.params.tierId));
  if (!tierItem) return res.status(404).json({ error: 'not_found' });
  const items = stmt.listDeliverablesByTier.all(tierItem.id);
  return res.json({ items });
});

/** POST /api/tier-items/:tierId/deliverables — Tạo deliverable mới. */
router.post('/tier-items/:tierId/deliverables', (req, res) => {
  const tierItem = stmt.getTierItem.get(Number(req.params.tierId));
  if (!tierItem) return res.status(404).json({ error: 'not_found' });
  if (!canEditTierItem(req.user, tierItem)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body || {};
  if (!body.title?.trim()) {
    return res.status(400).json({ error: 'missing_title' });
  }

  const info = stmt.insertDeliverable.run(
    tierItem.id,
    body.title.trim(),
    0, // completed = false
    body.sort_order ?? 0,
  );

  stmt.insertHistory.run(
    'task',
    tierItem.id,
    `Thêm deliverable: ${body.title.trim()}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const created = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ item: created });
});

/** PATCH /api/deliverables/:id/toggle — Toggle completed + auto-recompute parent progress. */
router.patch('/deliverables/:id(\\d+)/toggle', (req, res) => {
  const deliv = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(Number(req.params.id));
  if (!deliv) return res.status(404).json({ error: 'not_found' });
  const tierItem = stmt.getTierItem.get(deliv.tier_item_id);
  if (!tierItem) return res.status(404).json({ error: 'parent_not_found' });
  if (!canEditTierItem(req.user, tierItem)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  tx(() => {
    stmt.toggleDeliverable.run(deliv.id);

    // Auto-recompute tier item progress: % deliverables completed.
    const all = stmt.listDeliverablesByTier.all(tierItem.id);
    const completedCount = all.filter((d) => d.completed).length;
    const newProgress = all.length > 0
      ? Math.round((completedCount / all.length) * 100)
      : tierItem.progress;

    db.prepare(`
      UPDATE tier_items SET progress = ?, status = ?
      WHERE id = ?
    `).run(
      newProgress,
      newProgress === 100 ? 'Đã xong' : newProgress > 90 ? 'Sắp xong' : tierItem.status,
      tierItem.id,
    );

    stmt.insertHistory.run(
      'task',
      tierItem.id,
      `Toggle deliverable #${deliv.id} → ${deliv.completed ? 'chưa đạt' : 'đạt'}. Progress=${newProgress}%`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );

    // Roll-up nếu là T3/T4
    if (tierItem.parent_id) {
      recomputeRollup(tierItem.parent_id);
    }
  });

  const updated = stmt.getTierItem.get(tierItem.id);
  return res.json({ item: updated });
});

/** DELETE /api/deliverables/:id — Xoá. */
router.delete('/deliverables/:id(\\d+)', (req, res) => {
  const deliv = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(Number(req.params.id));
  if (!deliv) return res.status(404).json({ error: 'not_found' });
  const tierItem = stmt.getTierItem.get(deliv.tier_item_id);
  if (!tierItem) return res.status(404).json({ error: 'parent_not_found' });
  if (!canEditTierItem(req.user, tierItem)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  db.exec(`DELETE FROM deliverables WHERE id = ${deliv.id}`);
  stmt.insertHistory.run(
    'task',
    tierItem.id,
    `Xoá deliverable #${deliv.id}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );
  return res.status(204).send();
});

/** Auto-rollup helper (shared logic với tierItems). */
function recomputeRollup(parentId) {
  if (!parentId) return;
  const children = stmt.getChildrenProgress.all(parentId);
  if (children.length === 0) return;
  const avg = Math.round(children.reduce((acc, c) => acc + c.progress, 0) / children.length);
  const status = avg === 100 ? 'Đã xong' : avg > 90 ? 'Sắp xong' : 'Đang chạy';
  db.exec(`UPDATE tier_items SET progress = ${avg}, status = '${status}' WHERE id = ${parentId}`);
  const parent = stmt.getTierParent.get(parentId);
  if (parent?.parent_id) recomputeRollup(parent.parent_id);
}

export default router;