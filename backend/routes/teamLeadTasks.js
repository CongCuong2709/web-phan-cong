/**
 * routes/teamLeadTasks.js — CRUD cho TeamLeadTask (giao việc nhóm view).
 *
 * Endpoints:
 *   GET    /api/team-tasks                  — List (filtered theo role)
 *   POST   /api/team-tasks                  — Manager tạo task cho employee
 *   GET    /api/team-tasks/:id              — Chi tiết 1 task
 *   PATCH  /api/team-tasks/:id              — Update (assignee or manager)
 *   POST   /api/team-tasks/:id/approve      — Manager nghiệm thu
 *   POST   /api/team-tasks/:id/resolve      — Manager xử lý help request
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canApproveTask, inDepartment, uid } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** Helper: filter team tasks theo role. */
function visibleTasks(user, allTasks) {
  if (user.role === 'admin' || user.role === 'director') return allTasks;
  if (user.role === 'manager') {
    return allTasks.filter((t) => !t.department_code || inDepartment(user, t.department_code));
  }
  // employee: chỉ tasks của mình
  return allTasks.filter((t) => t.owner_user_id === user.id);
}

/** GET /api/team-tasks — List filtered. */
router.get('/', (req, res) => {
  const all = stmt.listTeamLeadTasks.all();
  const tasks = visibleTasks(req.user, all);
  return res.json({ tasks });
});

/** GET /api/team-tasks/:id — Chi tiết. */
router.get('/:id(\\d+)', (req, res) => {
  const task = stmt.getTeamLeadTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  const all = visibleTasks(req.user, [task]);
  if (all.length === 0) return res.status(403).json({ error: 'forbidden' });
  return res.json({ task });
});

/** POST /api/team-tasks — Manager tạo task cho employee. */
router.post('/', (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin/manager mới tạo team task.' });
  }
  const body = req.body || {};
  if (!body.title?.trim() || !body.owner_user_id) {
    return res.status(400).json({ error: 'missing_fields', message: 'Thiếu title hoặc owner_user_id.' });
  }

  // Validate owner exists
  const owner = stmt.getUserById.get(Number(body.owner_user_id));
  if (!owner) return res.status(404).json({ error: 'owner_not_found' });

  // Department guard
  const taskDept = body.department_code ?? owner.departments?.[0] ?? null;
  if (req.user.role === 'manager' && !inDepartment(req.user, taskDept)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const info = stmt.insertTeamLeadTask.run(
    body.code || `TLT-${uid().slice(-6).toUpperCase()}`,
    body.title.trim(),
    body.category ?? '—',
    body.deliverable_type ?? 'text',
    body.deliverable_text ?? null,
    body.file_name ?? null,
    Number(body.owner_user_id),
    taskDept,
    body.submitted_at ?? new Date().toISOString().slice(0, 10),
    body.deadline ?? null,
    body.status ?? 'in_progress',
    body.priority ?? 'Thường',
    body.progress_text ?? null,
    body.help_message_author ?? null,
    body.help_message_body ?? null,
    body.help_message_timeago ?? null,
  );

  stmt.insertHistory.run(
    'team_lead_task',
    Number(info.lastInsertRowid),
    `Tạo team task: ${body.title.trim()}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const created = stmt.getTeamLeadTask.get(Number(info.lastInsertRowid));
  return res.status(201).json({ task: created });
});

/** PATCH /api/team-tasks/:id — Update. */
router.patch('/:id(\\d+)', (req, res) => {
  const task = stmt.getTeamLeadTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  // Owner hoặc manager trong dept
  const isOwner = task.owner_user_id === req.user.id;
  const isMgrInDept = req.user.role === 'manager' && inDepartment(req.user, task.department_code);
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isMgrInDept && !isAdmin) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body || {};
  db.prepare(`
    UPDATE team_lead_tasks SET
      title = ?, deliverable_text = ?, deadline = ?, status = ?,
      priority = ?, progress_text = ?,
      help_message_author = ?, help_message_body = ?, help_message_timeago = ?
    WHERE id = ?
  `).run(
    body.title ?? task.title,
    body.deliverable_text ?? task.deliverable_text,
    body.deadline ?? task.deadline,
    body.status ?? task.status,
    body.priority ?? task.priority,
    body.progress_text ?? task.progress_text,
    body.help_message_author ?? task.help_message_author,
    body.help_message_body ?? task.help_message_body,
    body.help_message_timeago ?? task.help_message_timeago,
    task.id,
  );

  stmt.insertHistory.run(
    'team_lead_task',
    task.id,
    `Cập nhật team task: ${task.title}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const updated = stmt.getTeamLeadTask.get(task.id);
  return res.json({ task: updated });
});

/** POST /api/team-tasks/:id/approve — Manager nghiệm thu. */
router.post('/:id(\\d+)/approve', (req, res) => {
  const task = stmt.getTeamLeadTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (!canApproveTask(req.user, task)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  tx(() => {
    stmt.updateTeamLeadTaskStatus.run('done', task.id);
    stmt.insertHistory.run(
      'team_lead_task',
      task.id,
      'Nghiệm thu & duyệt hoàn thành',
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
  });

  const updated = stmt.getTeamLeadTask.get(task.id);
  return res.json({ task: updated });
});

/** POST /api/team-tasks/:id/resolve — Manager xử lý help request. */
router.post('/:id(\\d+)/resolve', (req, res) => {
  const task = stmt.getTeamLeadTask.get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (!canApproveTask(req.user, task)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  tx(() => {
    stmt.updateTeamLeadTaskStatus.run('in_progress', task.id);
    // Clear help message fields
    db.prepare(`
      UPDATE team_lead_tasks SET
        help_message_author = NULL, help_message_body = NULL, help_message_timeago = NULL
      WHERE id = ?
    `).run(task.id);
    stmt.insertHistory.run(
      'team_lead_task',
      task.id,
      'Xử lý yêu cầu hỗ trợ',
      req.user.id,
      req.user.username,
      req.user.fullname,
    );
  });

  const updated = stmt.getTeamLeadTask.get(task.id);
  return res.json({ task: updated });
});

export default router;