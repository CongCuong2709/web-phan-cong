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
import { authorize, inDepartment } from '../lib/policies.js';

const router = Router();

router.use(requireAuth);

/** GET /api/users — Tất cả user, hoặc filter theo department. */
router.get('/', (req, res) => {
  const { department } = req.query;
  // Dùng centralized policy (xem lib/policies.js).
  const authz = authorize('user:list', req.user, { department });
  if (!authz.ok) return res.status(authz.status).json(authz);
  let users = stmt.listUsers.all();
  if (department) {
    users = users.filter((u) => {
      // stmt.listUsers trả departments = CSV string (GROUP_CONCAT) → split
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
  // Truyền targetDepts để check overlap department.
  const targetDepts = stmt.getUserDepartments.all(u.id).map((d) => d.department_code);
  const authz = authorize('user:read', req.user, { targetDepts });
  if (!authz.ok) return res.status(authz.status).json(authz);
  // Attach departments (array) cho response — đồng nhất với /api/auth/login.
  const { password_hash: _ph, ...safeUser } = u;
  return res.json({ user: { ...safeUser, departments: targetDepts } });
});

export default router;