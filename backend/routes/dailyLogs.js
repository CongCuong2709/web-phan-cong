/**
 * routes/dailyLogs.js — DailyLog CRUD (nhật ký công việc).
 *
 * daily_log FK trực tiếp vào tasks (không qua subtask).
 * Mount tại /api/daily-logs (bulk) và /api/tasks/:taskId/logs (per-task).
 *
 * UPSERT dùng INSERT ... ON CONFLICT(task_id, log_date) DO UPDATE — atomic,
 * không race condition khi 2 request đồng thời cho cùng (task_id, log_date).
 *
 * Endpoints:
 *   GET    /api/tasks/:taskId/logs                — List logs của 1 task
 *   POST   /api/tasks/:taskId/logs                — UPSERT daily log (1 task/ngày)
 *   DELETE /api/daily-logs/:id                    — Xoá log (manager+)
 *   GET    /api/daily-logs                        — List tất cả (bulk)
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../lib/policies.js';
import { today } from '../lib/dates.js';
import { recomputeRollup } from '../lib/rollup.js';

const router = Router();
router.use(requireAuth);

/** GET /api/tasks/:taskId/logs — List logs của 1 task. */
router.get('/tasks/:taskId/logs', (req, res) => {
  const taskId = Number(req.params.taskId);
  const task = stmt.getTask.get(taskId);
  if (!task) return res.status(404).json({ error: 'not_found' });
  // canSee reuse qua task policy (admin/director thấy hết, manager cùng dept, employee chỉ own)
  const authz = authorize('task:read', req.user, { task: { ...task, tier: 4 } });
  if (!authz.ok) return res.status(authz.status).json(authz);
  const items = stmt.listDailyLogsByTask.all(taskId);
  return res.json({ items });
});

/** POST /api/tasks/:taskId/logs — UPSERT daily log.
 *  INSERT ... ON CONFLICT(task_id, log_date) DO UPDATE — atomic.
 *
 *  Nếu log mới có progress khác task.progress → update tasks.progress trong
 *  cùng transaction (đảm bảo consistency với audit_log).
 */
router.post('/tasks/:taskId/logs', (req, res) => {
  const taskId = Number(req.params.taskId);
  const task = stmt.getTask.get(taskId);
  if (!task) return res.status(404).json({ error: 'not_found' });
  const authz = authorize('daily_log:create', req.user, { task });
  if (!authz.ok) return res.status(authz.status).json(authz);

  const body = req.body || {};
  if (!body.description?.trim()) {
    return res.status(400).json({ error: 'missing_description' });
  }
  const progress = Number(body.progress ?? task.progress ?? 0);
  const logDate = body.log_date ?? today();
  const description = body.description.trim();
  const result = body.result ?? '';
  const obstacle = body.obstacle ?? '';

  // Validate log_date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
    return res.status(400).json({ error: 'invalid_log_date', message: 'log_date phải có format YYYY-MM-DD.' });
  }

  let savedId = 0;
  let action = 'create';
  let previousProgress = task.progress;
  tx(() => {
    // Check existence TRƯỚC để phân biệt create vs update cho response.
    // Lưu ý: chỉ để set "action" field — actual UPSERT vẫn dùng ON CONFLICT
    // nên atomic. Hai request đồng thời có thể cùng thấy "create" trong action
    // nhưng DB chỉ có 1 row (UNIQUE constraint + ON CONFLICT).
    const existing = db.prepare(
      'SELECT id FROM daily_logs WHERE task_id = ? AND log_date = ?'
    ).get(taskId, logDate);

    // ON CONFLICT (task_id, log_date) — atomic UPSERT, không race.
    stmt.upsertDailyLog.run(
      taskId, logDate, description, result, obstacle, progress, req.user.id,
    );

    // Lấy id của row (dù mới insert hay update).
    const final = db.prepare(
      'SELECT id FROM daily_logs WHERE task_id = ? AND log_date = ?'
    ).get(taskId, logDate);
    savedId = final?.id ?? 0;
    action = existing ? 'update' : 'create';

    // Audit
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action,
        new_values, actor_user_id, actor_username, actor_ip, actor_user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'daily_log',
      savedId,
      action,
      JSON.stringify({ task_id: taskId, log_date: logDate, description, progress }),
      req.user.id,
      req.user.username,
      req.ip || null,
      (req.headers['user-agent'] || '').slice(0, 255),
    );

    // Đồng bộ progress: nếu log mới có progress khác task.progress → update tasks.progress.
    if (progress !== previousProgress) {
      stmt.updateTask.run(
        task.title, task.description, task.owner_user_id, task.assigned_by_user_id,
        task.department_code, task.start_date, task.end_date,
        progress, task.status, task.priority,
        task.is_today ?? 0, task.is_today_date ?? null, task.collapsed,
        task.blocker_note || '',
        taskId,
      );
      recomputeRollup(taskId);
    }
  });

  const created = db.prepare('SELECT * FROM daily_logs WHERE id = ?').get(savedId);
  return res.status(action === 'create' ? 201 : 200).json({ item: created, action });
});

/** GET /api/daily-logs — List tất cả (cho Báo cáo tổng quan). */
router.get('/daily-logs', (_req, res) => {
  const items = stmt.listAllDailyLogs.all();
  return res.json({ items });
});

/** DELETE /api/daily-logs/:id — Xoá log (manager+). */
router.delete('/daily-logs/:id(\\d+)', (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin/manager mới xoá daily_log.' });
  }
  const id = Number(req.params.id);
  const log = db.prepare('SELECT * FROM daily_logs WHERE id = ?').get(id);
  if (!log) return res.status(404).json({ error: 'not_found' });
  tx(() => {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action,
        old_values, actor_user_id, actor_username, actor_ip, actor_user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'daily_log',
      id,
      'delete',
      JSON.stringify(log),
      req.user.id,
      req.user.username,
      req.ip || null,
      (req.headers['user-agent'] || '').slice(0, 255),
    );
    db.prepare('DELETE FROM daily_logs WHERE id = ?').run(id);
  });
  return res.status(204).send();
});

export default router;
