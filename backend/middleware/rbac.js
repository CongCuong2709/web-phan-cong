/**
 * middleware/rbac.js — Role-based authorization helpers.
 *
 * Luật RBAC nằm ở `lib/policies.js` (nguồn chuẩn duy nhất). File này chỉ bọc
 * thành middleware — không chứa luật riêng.
 *
 * Usage:
 *   router.post('/admin-only', requireRole('admin'), handler)
 *   router.delete('/users/:id', requireRole('admin', 'director'), handler)
 */

import { authorize } from '../lib/policies.js';

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'forbidden',
        message: `Role '${req.user.role}' không có quyền truy cập endpoint này.`,
      });
    }
    next();
  };
}

/** Middleware đặc biệt cho tier create: delegate sang policy `task:create`. */
export function requireTierCreatePermission(req, res, next) {
  const tier = Number(req.body?.tier);
  const authz = authorize('task:create', req.user, {
    tier,
    targetDept: req.body?.department_code ?? null,
  });
  if (!authz.ok) return res.status(authz.status).json(authz);
  next();
}