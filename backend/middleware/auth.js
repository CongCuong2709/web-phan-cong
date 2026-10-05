/**
 * middleware/auth.js — JWT verification + populate req.user.
 *
 * Yêu cầu Authorization: Bearer <token>.
 * Token được sign bằng JWT_SECRET (env), expires 7d (MVP).
 */

import jwt from 'jsonwebtoken';
import { db, stmt } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-CHANGE-ME';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (JWT_SECRET === 'dev-only-secret-CHANGE-ME' && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET phải được set trong production!');
}

/** Sign JWT cho user. */
export function signToken(user, jti) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      jti,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/** Verify JWT + check session chưa bị revoke. */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Express middleware. */
export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Thiếu Authorization header.' });
  }
  const token = auth.slice(7);
  try {
    const payload = verifyToken(token);
    // Check session còn active không (revoke check)
    const session = stmt.getSession.get(payload.jti);
    if (!session) {
      return res.status(401).json({ error: 'session_revoked', message: 'Session đã bị đăng xuất.' });
    }
    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'session_expired', message: 'Token đã hết hạn.' });
    }
    // Load user
    const user = stmt.getUserById.get(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'user_inactive', message: 'Tài khoản đã bị vô hiệu hoá.' });
    }
    // Attach departments CSV for RBAC checks
    const deptRows = stmt.getUserDepartments.all(user.id);
    user.departments = deptRows.map((d) => d.department_code).join(',');
    req.user = user;
    req.sessionId = payload.jti;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'token_expired', message: 'Token hết hạn.' });
    }
    return res.status(401).json({ error: 'invalid_token', message: 'Token không hợp lệ.' });
  }
}