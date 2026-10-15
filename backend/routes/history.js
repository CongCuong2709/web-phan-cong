/**
 * routes/history.js — Read-only audit log.
 *
 * Phase D: rename từ history_entries → audit_log, thêm JSON snapshot.
 * Endpoints:
 *   GET /api/history?entity_type=task&entity_id=12  — Lịch sử 1 entity
 *   GET /api/history?limit=50                       — Global recent (admin only)
 */

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../lib/policies.js';

const router = Router();
router.use(requireAuth);

/** GET /api/history. */
router.get('/', (req, res) => {
  const { entity_type, entity_id, limit } = req.query;

  if (entity_type && entity_id) {
    const items = db.prepare(`
      SELECT * FROM audit_log
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(String(entity_type), Number(entity_id));
    return res.json({ items });
  }

  // Global list — B3: dùng centralized policy.
  const authz = authorize('history:read_all', req.user, {});
  if (!authz.ok) return res.status(authz.status).json(authz);
  const cap = Math.min(Number(limit) || 50, 200);
  const items = db.prepare(`
    SELECT h.*, u.username AS author_username_str, u.fullname AS author_fullname_str
    FROM audit_log h LEFT JOIN users u ON u.id = h.actor_user_id
    ORDER BY h.created_at DESC LIMIT ?
  `).all(cap);
  return res.json({ items });
});

export default router;
