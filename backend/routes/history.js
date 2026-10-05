/**
 * routes/history.js — Read-only audit log.
 *
 * Endpoints:
 *   GET /api/history?entity_type=task&entity_id=12  — Lịch sử thao tác của 1 entity
 *   GET /api/history?limit=50                       — Global recent (admin only)
 */

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/** GET /api/history — Lấy lịch sử thao tác. */
router.get('/', (req, res) => {
  const { entity_type, entity_id, limit } = req.query;

  if (entity_type && entity_id) {
    const items = db.prepare(`
      SELECT * FROM history_entries
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(String(entity_type), Number(entity_id));
    return res.json({ items });
  }

  // Global list — chỉ admin/director
  if (!['admin', 'director'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin/director xem được lịch sử toàn hệ thống.' });
  }
  const cap = Math.min(Number(limit) || 50, 200);
  const items = db.prepare(`
    SELECT h.*, u.username AS author_username_str, u.fullname AS author_fullname_str
    FROM history_entries h LEFT JOIN users u ON u.id = h.author_user_id
    ORDER BY h.created_at DESC LIMIT ?
  `).all(cap);
  return res.json({ items });
});

export default router;