/**
 * routes/employeeTasks.js — CRUD cho EmployeeTask (việc cá nhân view).
 *
 * Endpoints:
 *   GET    /api/employee-tasks            — List filtered by role
 *   POST   /api/employee-tasks            — Tạo việc cá nhân (bất kỳ role nào)
 *   GET    /api/employee-tasks/:id        — Chi tiết
 *   PATCH  /api/employee-tasks/:id        — Update (owner only)
 *   POST   /api/employee-tasks/:id/notes  — Thêm note mới
 *   POST   /api/employee-tasks/:id/toggle — Toggle done / doing
 */

import { Router } from 'express';
import { db, stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { inDepartment, uid } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** Filter employee tasks theo role. */
function visibleTasks(user, allTasks) {
  if (user.role === 'admin' || user.role === 'director') return allTasks;
  if (user.role === 'manager') {
    return allTasks.filter((t) => !t.department_code || inDepartment(user, t.department_code));
  }
  return allTasks.filter((t) => t.owner_user_id === user.id);
}

/** GET /api/employee-tasks — List filtered. */
// Fix TD-03: JOIN với users 2 lần (manager + owner) để trả về fullname + avatar.
// Trước đây chỉ SELECT * → frontend transforms.ts:135-139 fill bằng chuỗi rỗng,
// khiến UI "Trưởng phòng giao:" trong ViecCuaToiView luôn trống.
const LIST_SQL = `
  SELECT
    et.*,
    mgr.fullname      AS manager_fullname,
    mgr.username      AS manager_username,
    mgr.avatar_url    AS manager_avatar_url,
    owner.fullname    AS owner_fullname,
    owner.username    AS owner_username
  FROM employee_tasks et
  LEFT JOIN users mgr   ON et.manager_user_id = mgr.id
  LEFT JOIN users owner ON et.owner_user_id   = owner.id
  ORDER BY et.created_at DESC
`;

router.get('/', (req, res) => {
  const all = db.prepare(LIST_SQL).all();
  const tasks = visibleTasks(req.user, all);
  return res.json({ tasks });
});

/** GET /api/employee-tasks/:id — Chi tiết. */
const DETAIL_SQL = `
  SELECT
    et.*,
    mgr.fullname      AS manager_fullname,
    mgr.username      AS manager_username,
    mgr.avatar_url    AS manager_avatar_url,
    owner.fullname    AS owner_fullname,
    owner.username    AS owner_username
  FROM employee_tasks et
  LEFT JOIN users mgr   ON et.manager_user_id = mgr.id
  LEFT JOIN users owner ON et.owner_user_id   = owner.id
  WHERE et.id = ?
`;

router.get('/:id(\\d+)', (req, res) => {
  const task = db.prepare(DETAIL_SQL).get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  const visible = visibleTasks(req.user, [task]);
  if (visible.length === 0) return res.status(403).json({ error: 'forbidden' });
  return res.json({ task });
});

/** POST /api/employee-tasks — Tạo việc cá nhân. */
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.title?.trim()) {
    return res.status(400).json({ error: 'missing_title' });
  }

  const dept = body.department_code ?? req.user.departments?.[0] ?? null;
  const info = stmt.insertEmployeeTask.run(
    body.code || `ET-${uid().slice(-6).toUpperCase()}`,
    body.bundle_name ?? 'Việc cá nhân',
    body.title.trim(),
    body.description ?? '',
    body.current_deliverable ?? 'Đang chuẩn bị',
    body.last_updated ?? 'Vừa tạo',
    body.deadline ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    body.is_today ? 1 : 0,
    body.status ?? 'doing',
    body.manager_user_id ? Number(body.manager_user_id) : null,
    req.user.id,
    dept,
  );

  stmt.insertHistory.run(
    'employee_task',
    Number(info.lastInsertRowid),
    `Tạo việc cá nhân: ${body.title.trim()}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const created = db.prepare('SELECT * FROM employee_tasks WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ task: created });
});

/** PATCH /api/employee-tasks/:id — Update. */
router.patch('/:id(\\d+)', (req, res) => {
  const task = db.prepare('SELECT * FROM employee_tasks WHERE id = ?').get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  // Chỉ owner hoặc admin
  if (task.owner_user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ chủ sở hữu mới sửa được.' });
  }

  const body = req.body || {};
  db.prepare(`
    UPDATE employee_tasks SET
      title = ?, description = ?, current_deliverable = ?, last_updated = ?,
      deadline = ?, is_today = ?, status = ?
    WHERE id = ?
  `).run(
    body.title ?? task.title,
    body.description ?? task.description,
    body.current_deliverable ?? task.current_deliverable,
    body.last_updated ?? task.last_updated,
    body.deadline ?? task.deadline,
    body.is_today !== undefined ? (body.is_today ? 1 : 0) : task.is_today,
    body.status ?? task.status,
    task.id,
  );

  stmt.insertHistory.run(
    'employee_task',
    task.id,
    `Cập nhật việc cá nhân: ${task.title}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const updated = db.prepare('SELECT * FROM employee_tasks WHERE id = ?').get(task.id);
  return res.json({ task: updated });
});

/** POST /api/employee-tasks/:id/toggle — Done ↔ Doing. */
router.post('/:id(\\d+)/toggle', (req, res) => {
  const task = db.prepare('SELECT * FROM employee_tasks WHERE id = ?').get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (task.owner_user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const newStatus = task.status === 'done' ? 'doing' : 'done';
  const newLastUpdated = newStatus === 'done' ? 'Vừa báo xong việc' : 'Đang làm';

  db.prepare(`
    UPDATE employee_tasks SET status = ?, last_updated = ? WHERE id = ?
  `).run(newStatus, newLastUpdated, task.id);

  stmt.insertHistory.run(
    'employee_task',
    task.id,
    newStatus === 'done' ? 'Báo đã hoàn thành' : 'Mở lại task',
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const updated = db.prepare('SELECT * FROM employee_tasks WHERE id = ?').get(task.id);
  return res.json({ task: updated });
});

/** POST /api/employee-tasks/:id/notes — Thêm note mới. */
router.post('/:id(\\d+)/notes', (req, res) => {
  const task = db.prepare('SELECT * FROM employee_tasks WHERE id = ?').get(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (task.owner_user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body || {};
  if (!body.body?.trim()) {
    return res.status(400).json({ error: 'missing_body' });
  }

  const info = db.prepare(`
    INSERT INTO employee_task_notes (employee_task_id, body, author_user_id) VALUES (?, ?, ?)
  `).run(task.id, body.body.trim(), req.user.id);

  // Bump notesCount
  const noteCount = db.prepare('SELECT COUNT(*) AS c FROM employee_task_notes WHERE employee_task_id = ?').get(task.id).c;
  db.prepare('UPDATE employee_tasks SET notesCount = ? WHERE id = ?').run(noteCount, task.id);

  stmt.insertHistory.run(
    'employee_task',
    task.id,
    `Ghi note mới`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const created = db.prepare('SELECT * FROM employee_task_notes WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ note: created });
});

export default router;