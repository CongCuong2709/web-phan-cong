/**
 * routes/helpRequests.js — CRUD cho QuickHelpRequest.
 *
 * Endpoints:
 *   GET    /api/help-requests              — List (own for employee; dept/all cho manager+)
 *   POST   /api/help-requests              — Tạo (bất kỳ authed)
 *   POST   /api/help-requests/:id/resolve  — Manager/admin resolve
 */

import { Router } from 'express';
import { db, stmt } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { inDepartment } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** GET /api/help-requests — List filtered. */
// Fix TD-04: JOIN với users để trả về sender_fullname + sender_username.
// Trước đây chỉ SELECT * → transforms.ts:156 bỏ trống sender field.
const LIST_SQL = `
  SELECT
    hr.*,
    sender.fullname  AS sender_fullname,
    sender.username  AS sender_username,
    sender.avatar_url AS sender_avatar_url
  FROM help_requests hr
  LEFT JOIN users sender ON hr.sender_user_id = sender.id
  ORDER BY hr.created_at DESC
`;

router.get('/', (req, res) => {
  const all = db.prepare(LIST_SQL).all();
  let visible;
  if (req.user.role === 'admin' || req.user.role === 'director') {
    visible = all;
  } else if (req.user.role === 'manager') {
    // Manager chỉ thấy help_requests của user cùng department.
    // Lookup sender_user_id → check user_departments. Đã JOIN users nên dùng trực tiếp
    // sender.username; tuy nhiên dept của sender không có sẵn trong row này,
    // nên giữ logic filter cũ bằng getUserById cho đúng.
    visible = all.filter((r) => {
      const sender = stmt.getUserById.get(r.sender_user_id);
      return sender && sender.departments?.some((d) => inDepartment(req.user, d));
    });
  } else {
    visible = all.filter((r) => r.sender_user_id === req.user.id);
  }
  return res.json({ requests: visible });
});

/** POST /api/help-requests — Tạo. */
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.reason?.trim() || !body.message?.trim()) {
    return res.status(400).json({ error: 'missing_fields', message: 'Thiếu reason hoặc message.' });
  }

  const info = stmt.insertHelpRequest.run(
    req.user.id,
    body.reason.trim(),
    body.message.trim(),
    'pending',
    body.related_team_lead_task_id ? Number(body.related_team_lead_task_id) : null,
  );

  stmt.insertHistory.run(
    'task',
    Number(info.lastInsertRowid),
    `Xin hỗ trợ: ${body.reason.trim()}`,
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const created = db.prepare('SELECT * FROM help_requests WHERE id = ?').get(Number(info.lastInsertRowid));
  return res.status(201).json({ request: created });
});

/** POST /api/help-requests/:id/resolve — Mark resolved. */
router.post('/:id(\\d+)/resolve', (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ admin/manager mới giải quyết help request.' });
  }
  const help = db.prepare('SELECT * FROM help_requests WHERE id = ?').get(Number(req.params.id));
  if (!help) return res.status(404).json({ error: 'not_found' });

  stmt.resolveHelpRequest.run(req.user.id, help.id);
  stmt.insertHistory.run(
    'task',
    help.id,
    'Đã giải quyết yêu cầu hỗ trợ',
    req.user.id,
    req.user.username,
    req.user.fullname,
  );

  const updated = db.prepare('SELECT * FROM help_requests WHERE id = ?').get(help.id);
  return res.json({ request: updated });
});

export default router;