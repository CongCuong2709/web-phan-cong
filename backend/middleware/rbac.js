/**
 * middleware/rbac.js — Role-based authorization helpers.
 *
 * Chặn thô theo role ở tầng route. Luật chi tiết (theo người phụ trách) nằm ở
 * `lib/policies.js` — nguồn chuẩn duy nhất.
 *
 * Usage:
 *   router.post('/admin-only', requireRole('admin'), handler)
 *   router.delete('/users/:id', requireRole('admin', 'director'), handler)
 */

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
