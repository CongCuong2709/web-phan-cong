/**
 * routes/auth.js — Authentication endpoints.
 *
 * POST /api/auth/login    → { token, user }
 * POST /api/auth/logout   → 204 (revoke current session)
 * GET  /api/me            → Current user info (sau khi login)
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, stmt } from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { uid } from '../utils/permissions.js';

const router = Router();

/** POST /api/auth/login — Username + password → JWT. */
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'missing_credentials', message: 'Thiếu username hoặc password.' });
  }
  const user = stmt.getUserByUsername.get(username.trim());
  if (!user) {
    // Trả message generic để tránh user enumeration
    return res.status(401).json({ error: 'invalid_credentials', message: 'Sai tài khoản hoặc mật khẩu.' });
  }
  // bcrypt.compare trả về Promise → await
  bcrypt.compare(password, user.password_hash).then((ok) => {
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Sai tài khoản hoặc mật khẩu.' });
    }
    // Tạo session row + JWT
    const jti = uid('sess');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    stmt.createSession.run(
      jti,
      user.id,
      expiresAt,
      req.ip || null,
      (req.headers['user-agent'] || '').slice(0, 255),
    );
    const token = signToken(user, jti);
    // Strip password_hash before returning
    const { password_hash: _ph, ...safeUser } = user;
    return res.json({ token, user: safeUser });
  }).catch((err) => {
    console.error('[auth/login] bcrypt error:', err);
    return res.status(500).json({ error: 'internal', message: 'Lỗi server.' });
  });
});

/** POST /api/auth/logout — Revoke current session. */
router.post('/logout', requireAuth, (req, res) => {
  stmt.revokeSession.run(req.sessionId);
  return res.status(204).send();
});

/** GET /api/me — Current authenticated user. */
router.get('/me', requireAuth, (req, res) => {
  // req.user đã populate đầy đủ (kèm departments CSV)
  return res.json({ user: req.user });
});

export default router;