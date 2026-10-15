/**
 * routes/dailyLogs.js — DailyLog CRUD (nhật ký thi công).
 *
 * Phase E refactor: bỏ SubTask tier; daily_log giờ FK trực tiếp vào tasks.
 * Mount tại /api/daily-logs (bulk) và /api/tasks/:taskId/logs (per-task).
 *
 * Endpoints:
 *   GET    /api/tasks/:taskId/logs                — List logs của 1 task
 *   POST   /api/tasks/:taskId/logs                — Thêm log
 *   DELETE /api/daily-logs/:id                    — Xoá log (manager+)
 *   GET    /api/daily-logs                        — List tất cả (bulk)
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../lib/policies.js';

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
 *  Phase F: 1 task có nhiều ngày, 1 ngày chỉ 1 log.
 *  Pattern: nếu đã có row cho (task_id, log_date) → UPDATE; nếu chưa → INSERT.
 *  Không dùng UNIQUE constraint ở schema (cho phép nhiều row cùng ngày nếu cần audit lịch sử
 *  sau này), nên thực hiện UPSERT trong transaction ở đây.
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
  const logDate = body.log_date ?? new Date().toISOString().slice(0, 10);
  const description = body.description.trim();
  const result = body.result ?? '';
  const obstacle = body.obstacle ?? '';

  let savedId = 0;
  let action = 'create';
  tx(() => {
    // Tìm row cùng (task_id, log_date) — nếu có → UPDATE; nếu không → INSERT
    const existing = db.prepare(
      'SELECT id FROM daily_logs WHERE task_id = ? AND log_date = ?'
    ).get(taskId, logDate);

    if (existing) {
      stmt.upsertDailyLogForToday.run(description, result, obstacle, progress, req.user.id, taskId, logDate);
      savedId = existing.id;
      action = 'update';
    } else {
      const info = stmt.insertDailyLog.run(
        taskId, logDate, description, result, obstacle, progress, req.user.id,
      );
      savedId = Number(info.lastInsertRowid);
    }

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

    // Phase F: nếu log mới có progress khác task.progress → update tasks.progress
    if (progress !== task.progress) {
      stmt.updateTask.run(
        task.title, task.description, task.owner_user_id, task.assigned_by_user_id,
        task.department_code, task.start_date, task.end_date,
        progress, task.status, task.priority, task.is_today, task.collapsed,
        task.blocker_note || '',
        taskId,
      );
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