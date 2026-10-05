/**
 * middleware/rbac.js — Role-based authorization helpers.
 *
 * Usage:
 *   router.post('/admin-only', requireRole('admin'), handler)
 *   router.delete('/users/:id', requireRole('admin', 'director'), handler)
 */

import { canCreateTiers } from '../utils/permissions.js';

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

/** Middleware đặc biệt cho tier create: check role có quyền tạo tier X không. */
export function requireTierCreatePermission(req, res, next) {
  const tier = Number(req.body?.tier);
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) {
    return res.status(400).json({ error: 'invalid_tier', message: 'Tier phải là 1, 2, 3 hoặc 4.' });
  }
  const allowed = canCreateTiers(req.user.role);
  if (!allowed.includes(tier)) {
    return res.status(403).json({
      error: 'tier_forbidden',
      message: `Role '${req.user.role}' không được tạo tier ${tier}. Chỉ chấp nhận: ${allowed.join(', ')}.`,
    });
  }
  next();
}