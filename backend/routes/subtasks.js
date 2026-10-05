/**
 * routes/subtasks.js — CRUD cho SubTask (T4.5) + DailyLog (nhật ký thi công).
 *
 * Endpoints:
 *   GET    /api/tier-items/:tierId/subtasks                — List subtasks
 *   POST   /api/tier-items/:tierId/subtasks                — Tạo subtask (canEditSubtask)
 *   PATCH  /api/subtasks/:id                               — Update subtask
 *   DELETE /api/subtasks/:id                               — Xoá subtask (manager+)
 *   PATCH  /api/subtasks/:id/progress                      — Quick progress slider
 *   GET    /api/subtasks/:id/logs                          — List daily logs
 *   POST   /api/subtasks/:id/logs                          — Thêm daily log (RBAC check)
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canEditSubtask, canAddDailyLog, inDepartment, uid } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** GET /api/tier-items/:tierId/subtasks — List subtasks của tier item. */
router.get('/tier-items/:tierId/subtasks', (req, res) => {
  const tierItem = stmt.getTierItem.get(Number(req.params.tierId));
  if (!tierItem) return res.status(404).json({ error: 'not_found' });
  const items = stmt.getSubtasksByTier.all(tierItem.id);
  return res.json({ items });
});

/** POST /api/tier-items/:tierId/subtasks — Tạo subtask. */
router.post('/tier-items/:tierId/subtasks', (req, res) => {
  const tierItem = stmt.getTierItem.get(Number(req.params.tierId));
  if (!tierItem) return res.status(404).json({ error: 'not_found' });
  // Chỉ parent T4 mới có subtask
  if (tierItem.tier !== 4) {
    return res.status(400).json({ error: 'invalid_tier', message: 'Chỉ T4 mới có SubTask.' });
  }
  // Manager: trong cùng phòng ban. Admin: luôn được.
  if (req.user.role === 'director') {
    return res.status(403).json({ error: 'forbidden', message: 'Director không tạo SubTask.' });
  }
  if (req.user.role === 'manager' && !inDepartment(req.user, tierItem.department_code)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (req.user.role === 'employee') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body || {};
  if (!body.name?.trim()) {
    return res.status(400).json({ error: 'missing_name' });
  }

  const info = db.prepare(`
    INSERT INTO subtasks (tier_item_id, name, description, assignee_user_id,
      start_date, end_date, progress, status, priority, results)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tierItem.id,
    body.name.trim(),
    body.description ?? null,
    body.assignee_user_id ? Number(body.assignee_user_id) : null,
    body.start_date ?? new Date().toISOString().slice(0, 10),
    body.end_date ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    Number(body.progress ?? 0),
    body.status ?? 'not_started',
    body.priority ?? 'medium',
    body.results ?? null,
  );

  stmt.insertHistory.run(
    'subtask',
    Number(info.lastInsertRowid),
    `Tạo SubTask: ${body.name.trim()}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const created = stmt.getSubtask.get(Number(info.lastInsertRowid));
  return res.status(201).json({ item: created });
});

/** PATCH /api/subtasks/:id — Update subtask. */
router.patch('/subtasks/:id(\\d+)', (req, res) => {
  const subtask = stmt.getSubtask.get(Number(req.params.id));
  if (!subtask) return res.status(404).json({ error: 'not_found' });
  const parent = stmt.getTierItem.get(subtask.tier_item_id);
  if (!canEditSubtask(req.user, subtask, parent)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body || {};
  db.prepare(`
    UPDATE subtasks SET
      name = ?, description = ?, progress = ?, status = ?, priority = ?,
      results = ?, assignee_user_id = ?
    WHERE id = ?
  `).run(
    body.name ?? subtask.name,
    body.description ?? subtask.description ?? null,
    Number(body.progress ?? subtask.progress),
    body.status ?? subtask.status,
    body.priority ?? subtask.priority,
    body.results ?? subtask.results ?? null,
    body.assignee_user_id !== undefined
      ? (body.assignee_user_id ? Number(body.assignee_user_id) : null)
      : subtask.assignee_user_id,
    subtask.id,
  );

  stmt.insertHistory.run(
    'subtask',
    subtask.id,
    `Cập nhật SubTask: ${subtask.name}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const updated = stmt.getSubtask.get(subtask.id);
  return res.json({ item: updated });
});

/** PATCH /api/subtasks/:id/progress — Quick progress update (slider). */
router.patch('/subtasks/:id(\\d+)/progress', (req, res) => {
  const subtask = stmt.getSubtask.get(Number(req.params.id));
  if (!subtask) return res.status(404).json({ error: 'not_found' });
  const parent = stmt.getTierItem.get(subtask.tier_item_id);
  if (!canEditSubtask(req.user, subtask, parent)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const newProgress = Number(req.body?.progress);
  if (!Number.isFinite(newProgress) || newProgress < 0 || newProgress > 100) {
    return res.status(400).json({ error: 'invalid_progress' });
  }

  stmt.updateSubtaskProgress.run(newProgress, subtask.id);
  stmt.insertHistory.run(
    'subtask',
    subtask.id,
    `Cập nhật nhanh SubTask → ${newProgress}%`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  // Auto-rollup parent nếu là T4 → parent.progress = avg(children progress)
  if (parent?.tier === 4) {
    const children = db.prepare('SELECT progress FROM subtasks WHERE tier_item_id = ?').all(parent.id);
    if (children.length > 0) {
      const avg = Math.round(children.reduce((acc, c) => acc + c.progress, 0) / children.length);
      db.prepare('UPDATE tier_items SET progress = ? WHERE id = ?').run(avg, parent.id);
      // Rollup lên cha của parent
      if (parent.parent_id) {
        const grandparentChildren = db.prepare('SELECT progress FROM tier_items WHERE parent_id = ?').all(parent.parent_id);
        if (grandparentChildren.length > 0) {
          const gpAvg = Math.round(grandparentChildren.reduce((acc, c) => acc + c.progress, 0) / grandparentChildren.length);
          db.prepare('UPDATE tier_items SET progress = ? WHERE id = ?').run(gpAvg, parent.parent_id);
        }
      }
    }
  }

  const updated = stmt.getSubtask.get(subtask.id);
  return res.json({ item: updated });
});

/** DELETE /api/subtasks/:id — Xoá subtask (admin/manager only). */
router.delete('/subtasks/:id(\\d+)', (req, res) => {
  if (req.user.role === 'employee' || req.user.role === 'director') {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin/manager mới được xoá SubTask.' });
  }
  const subtask = stmt.getSubtask.get(Number(req.params.id));
  if (!subtask) return res.status(404).json({ error: 'not_found' });
  tx(() => {
    stmt.insertHistory.run(
      'subtask',
      subtask.id,
      `Xoá SubTask: ${subtask.name}`,
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
    db.exec(`DELETE FROM subtasks WHERE id = ${subtask.id}`);
  });
  return res.status(204).send();
});

/** GET /api/subtasks/:id/logs — List daily logs. */
router.get('/subtasks/:id(\\d+)/logs', (req, res) => {
  const subtask = stmt.getSubtask.get(Number(req.params.id));
  if (!subtask) return res.status(404).json({ error: 'not_found' });
  const items = stmt.listDailyLogsBySub.all(subtask.id);
  return res.json({ items });
});

/** POST /api/subtasks/:id/logs — Thêm daily log. */
router.post('/subtasks/:id(\\d+)/logs', (req, res) => {
  const subtask = stmt.getSubtask.get(Number(req.params.id));
  if (!subtask) return res.status(404).json({ error: 'not_found' });
  const parent = stmt.getTierItem.get(subtask.tier_item_id);
  if (!canAddDailyLog(req.user, subtask, parent)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Chỉ assignee SubTask hoặc manager trong phòng ban mới được ghi nhật ký.',
    });
  }

  const body = req.body || {};
  if (!body.description?.trim()) {
    return res.status(400).json({ error: 'missing_description' });
  }
  const progress = Number(body.progress ?? subtask.progress);

  const info = stmt.insertDailyLog.run(
    subtask.id,
    body.log_date ?? new Date().toISOString().slice(0, 10),
    body.description.trim(),
    body.result ?? null,
    body.obstacle ?? null,
    progress,
    req.user.id,
  );

  // Update SubTask progress = max(current, new) — never decrease
  if (progress > subtask.progress) {
    stmt.updateSubtaskProgress.run(progress, subtask.id);
  }

  stmt.insertHistory.run(
    'subtask',
    subtask.id,
    `Ghi nhật ký thi công (+${progress}%)`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  // Rollup parent
  if (parent?.tier === 4) {
    const children = db.prepare('SELECT progress FROM subtasks WHERE tier_item_id = ?').all(parent.id);
    if (children.length > 0) {
      const avg = Math.round(children.reduce((acc, c) => acc + c.progress, 0) / children.length);
      db.prepare('UPDATE tier_items SET progress = ? WHERE id = ?').run(avg, parent.id);
    }
  }

  const created = db.prepare('SELECT * FROM daily_logs WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ item: created });
});

export default router;