/**
 * routes/history.js — Read-only audit log.
 *
 * Schema mới: audit_log (JSON snapshot), thay cho history_entries cũ.
 * Endpoints:
 *   GET /api/history?entity_type=task&entity_id=12  — Lịch sử 1 entity
 *   GET /api/history?limit=50                       — Global recent (admin only)
 */

import { Router } from 'express';
import { db, stmt } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../lib/policies.js';

const router = Router();
router.use(requireAuth);

const TIER_OF = { project: 1, phase: 2, bundle: 3, task: 4 };
const LOADER = { 1: stmt.getProject, 2: stmt.getPhase, 3: stmt.getBundle, 4: stmt.getTask };

/**
 * Mục công việc mà 1 dòng lịch sử thuộc về: chính nó (project/phase/bundle/task)
 * hoặc task cha (daily_log, task_help_message). Không tìm thấy (đã xoá, user…) → null.
 */
function owningItem(entityType, entityId) {
  let tier = TIER_OF[entityType];
  let id = entityId;
  if (entityType === 'daily_log' || entityType === 'task_help_message') {
    const table = entityType === 'daily_log' ? 'daily_logs' : 'task_help_messages';
    const row = db.prepare(`SELECT task_id FROM ${table} WHERE id = ?`).get(entityId);
    if (!row) return null;
    tier = 4;
    id = row.task_id;
  }
  if (!tier) return null;
  const item = LOADER[tier].get(id);
  return item ? { ...item, tier } : null;
}

/** GET /api/history. */
router.get('/', (req, res) => {
  const { entity_type, entity_id, limit } = req.query;

  if (entity_type && entity_id) {
    // Xem lịch sử 1 mục = cần quyền xem chính mục đó. Mục đã xoá / không phải
    // mục công việc (user…) thì chỉ ai xem được toàn bộ lịch sử mới xem được.
    const item = owningItem(String(entity_type), Number(entity_id));
    const authz = item
      ? authorize('task:read', req.user, { task: item })
      : authorize('history:read_all', req.user, {});
    if (!authz.ok) return res.status(authz.status).json(authz);

    const items = db.prepare(`
      SELECT h.*, u.username AS author_username_str, u.fullname AS author_fullname_str
      FROM audit_log h LEFT JOIN users u ON u.id = h.actor_user_id
      WHERE h.entity_type = ? AND h.entity_id = ?
      ORDER BY h.created_at DESC
      LIMIT 100
    `).all(String(entity_type), Number(entity_id));
    return res.json({ items });
  }

  // Dùng centralized policy (xem lib/policies.js).
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
