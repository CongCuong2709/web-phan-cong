/**
 * routes/users.js — User directory (cho dropdowns + admin quản trị).
 *
 * GET    /api/users         → Tất cả user (admin only)
 *                     GET    /api/users?department=QLDA → user thuộc department (manager+)
 *                     GET    /api/users/:username   → 1 user
 */

import { Router } from 'express';
import { db, stmt } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { inDepartment } from '../utils/permissions.js';

const router = Router();

router.use(requireAuth);

/** GET /api/users — Tất cả user, hoặc filter theo department. */
router.get('/', (req, res) => {
  const { department } = req.query;

  // Admin: thấy tất cả. Manager: chỉ phòng ban mình.
  if (req.user.role === 'employee') {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Employee không có quyền list users.',
    });
  }
  if (department && !inDepartment(req.user, department)) {
    return res.status(403).json({
      error: 'forbidden',
      message: `Bạn không thuộc phòng ban '${department}'.`,
    });
  }
  let users = stmt.listUsers.all();
  if (department) {
    users = users.filter((u) => {
      const depts = (u.departments || '').split(',');
      return depts.includes(department);
    });
  }
  return res.json({ users });
});

/** GET /api/users/:username — 1 user (admin/director/manager trong cùng dept). */
router.get('/:username', (req, res) => {
  const u = stmt.getUserByUsername.get(req.params.username);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (req.user.role !== 'admin' && req.user.role !== 'director') {
    // Manager chỉ xem user cùng phòng
    if (!u.departments?.split(',').some((d) => inDepartment(req.user, d))) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }
  const { password_hash: _ph, ...safeUser } = u;
  return res.json({ user: safeUser });
});

export default router;