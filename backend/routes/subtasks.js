/**
 * routes/subtasks.js — SubTask + DailyLog CRUD (ISS-007: ref FK sang tasks).
 *
 * Endpoints:
 *   GET    /api/tasks/:taskId/subtasks                — List subtasks
 *   POST   /api/tasks/:taskId/subtasks                — Tạo subtask
 *   PATCH  /api/subtasks/:id                          — Update subtask
 *   DELETE /api/subtasks/:id                          — Xoá subtask (manager+)
 *   PATCH  /api/subtasks/:id/progress                 — Quick progress slider
 *   GET    /api/subtasks/:id/logs                     — List daily logs
 *   POST   /api/subtasks/:id/logs                     — Thêm daily log (RBAC check)
 *
 * Backward-compat: giữ cả /api/tier-items/:tierId/subtasks alias cho frontend
 * cũ. Sau khi frontend update xong, có thể xoá alias.
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../lib/policies.js';
import { canAddDailyLog, inDepartment } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** Backward-compat helper: GET /api/tier-items/:id/subtasks alias. */
function getTaskOr404(id) {
  return stmt.getTask.get(Number(id));
}

/** GET /api/tasks/:taskId/subtasks — List subtasks. */
router.get('/tasks/:taskId/subtasks', (req, res) => {
  const task = getTaskOr404(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'not_found' });
  const items = stmt.getSubtasksByTask.all(task.id);
  return res.json({ items });
});

/** Backward-compat alias. */
router.get('/tier-items/:tierId/subtasks', (req, res) => {
  const task = getTaskOr404(req.params.tierId);
  if (!task) return res.status(404).json({ error: 'not_found' });
  const items = stmt.getSubtasksByTask.all(task.id);
  return res.json({ items });
});

/** GET /api/subtasks — List tất cả subtasks (bulk fetch). */
router.get('/subtasks', (_req, res) => {
  const items = stmt.listAllSubtasks.all();
  return res.json({ items });
});

/** GET /api/subtasks/:id/logs — List daily logs. */
router.get('/subtasks/:id(\\d+)/logs', (req, res) => {
  const subtask = stmt.getSubtask.get(Number(req.params.id));
  if (!subtask) return res.status(404).json({ error: 'not_found' });
  const items = stmt.listDailyLogsBySub.all(subtask.id);
  return res.json({ items });
});

/** GET /api/daily-logs — List tất cả daily logs (bulk fetch). */
router.get('/daily-logs', (_req, res) => {
  const items = stmt.listAllDailyLogs.all();
  return res.json({ items });
});

/** POST /api/tasks/:taskId/subtasks — Tạo subtask. */
router.post('/tasks/:taskId/subtasks', (req, res) => {
  const task = getTaskOr404(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'not_found' });
  // B3: dùng centralized policy.
  const authz = authorize('subtask:create', req.user, { parent: task });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const body = req.body || {};
  if (!body.name?.trim()) {
    return res.status(400).json({ error: 'missing_name' });
  }

  const info = db.prepare(`
    INSERT INTO subtasks (task_id, name, assignee_user_id, progress, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    task.id,
    body.name.trim(),
    body.assignee_user_id ? Number(body.assignee_user_id) : null,
    Number(body.progress ?? 0),
    body.status ?? 'doing',
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
  const parent = stmt.getTask.get(subtask.task_id);
  // B3: dùng centralized policy.
  const authz = authorize('subtask:edit', req.user, { subtask, parent });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const body = req.body || {};
  db.prepare(`
    UPDATE subtasks SET
      name = ?, progress = ?, status = ?, assignee_user_id = ?
    WHERE id = ?
  `).run(
    body.name ?? subtask.name,
    Number(body.progress ?? subtask.progress),
    body.status ?? subtask.status,
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

/** PATCH /api/subtasks/:id/progress — Quick progress slider. */
router.patch('/subtasks/:id(\\d+)/progress', (req, res) => {
  const subtask = stmt.getSubtask.get(Number(req.params.id));
  if (!subtask) return res.status(404).json({ error: 'not_found' });
  const parent = stmt.getTask.get(subtask.task_id);
  // B3: dùng centralized policy.
  const authz = authorize('subtask:edit', req.user, { subtask, parent });
  if (!authz.ok) return res.status(authz.status).json(authz);

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

  // Auto-rollup parent (T4 → parent T3, recursive)
  if (parent?.tier === 4) {
    const children = db.prepare('SELECT progress FROM subtasks WHERE task_id = ?').all(parent.id);
    if (children.length > 0) {
      const avg = Math.round(children.reduce((acc, c) => acc + c.progress, 0) / children.length);
      db.prepare('UPDATE tasks SET progress = ? WHERE id = ?').run(avg, parent.id);
      if (parent.parent_id) {
        const gc = db.prepare('SELECT progress FROM tasks WHERE parent_id = ?').all(parent.parent_id);
        if (gc.length > 0) {
          const gpAvg = Math.round(gc.reduce((acc, c) => acc + c.progress, 0) / gc.length);
          db.prepare('UPDATE tasks SET progress = ? WHERE id = ?').run(gpAvg, parent.parent_id);
        }
      }
    }
  }

  const updated = stmt.getSubtask.get(subtask.id);
  return res.json({ item: updated });
});

/** DELETE /api/subtasks/:id — Xoá subtask (admin/manager only). */
router.delete('/subtasks/:id(\\d+)', (req, res) => {
  // B3: dùng centralized policy.
  const authz = authorize('subtask:delete', req.user, {});
  if (!authz.ok) return res.status(authz.status).json(authz);
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

/** POST /api/subtasks/:id/logs — Thêm daily log. */
router.post('/subtasks/:id(\\d+)/logs', (req, res) => {
  const subtask = stmt.getSubtask.get(Number(req.params.id));
  if (!subtask) return res.status(404).json({ error: 'not_found' });
  const parent = stmt.getTask.get(subtask.task_id);
  // B3: dùng centralized policy.
  const authz = authorize('daily_log:create', req.user, { subtask, parent });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const body = req.body || {};
  if (!body.description?.trim()) {
    return res.status(400).json({ error: 'missing_description' });
  }
  const progress = Number(body.progress ?? subtask.progress);

  const info = stmt.insertDailyLog.run(
    subtask.id,
    body.log_date ?? new Date().toISOString().slice(0, 10),
    body.description.trim(),
    body.result ?? '',
    body.obstacle ?? '',
    progress,
    req.user.id,
  );

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
    const children = db.prepare('SELECT progress FROM subtasks WHERE task_id = ?').all(parent.id);
    if (children.length > 0) {
      const avg = Math.round(children.reduce((acc, c) => acc + c.progress, 0) / children.length);
      db.prepare('UPDATE tasks SET progress = ? WHERE id = ?').run(avg, parent.id);
    }
  }

  const created = db.prepare('SELECT * FROM daily_logs WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ item: created });
});

export default router;