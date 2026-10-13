/**
 * routes/auth.js — Authentication endpoints.
 *
 * POST /api/auth/login            → { token, user }
 * POST /api/auth/logout           → 204 (revoke current session)
 * POST /api/auth/change-password  → 204 (đổi mật khẩu, public — dùng từ trang login)
 * GET  /api/me                    → Current user info (sau khi login)
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
    // Strip password_hash trước khi trả về.
    // BUG FIX: Fetch departments từ user_departments để AuthContext có field departments đầy đủ.
    // getUserByUsername chỉ SELECT từ bảng users (không JOIN user_departments) → thiếu departments
    // → AuthContext fallback về [] → mọi task bị filter out với manager/employee.
    const deptRows = stmt.getUserDepartments.all(user.id);
    const departments = deptRows.map((d) => d.department_code);
    const { password_hash: _ph, ...safeUser } = user;
    return res.json({ token, user: { ...safeUser, departments } });
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

/**
 * POST /api/auth/change-password — Public endpoint (không cần auth).
 * Đổi mật khẩu từ trang login: user nhập username + mật khẩu cũ + mật khẩu mới.
 * Verify mật khẩu cũ qua bcrypt.compare; nếu OK, hash mật khẩu mới và UPDATE DB.
 *
 * Lưu ý bảo mật:
 *  - Trả message generic khi username không tồn tại hoặc sai mật khẩu
 *    (tránh user enumeration).
 *  - KHÔNG revoke các session đang hoạt động — user có thể đang dùng ở thiết bị
 *    khác; việc logout-all-sessions không nằm trong scope của MVP.
 *  - Mật khẩu mới không giới hạn độ phức tạp theo yêu cầu nghiệp vụ (sẽ cập nhật
 *    nếu sau này cần enforce rule).
 *
 * Request:  { username, currentPassword, newPassword }
 * Response: 204 No Content
 * Errors:
 *   400 missing_fields           — thiếu field
 *   400 same_password            — mật khẩu mới trùng mật khẩu cũ
 *   401 invalid_credentials      — username không tồn tại HOẶC sai mật khẩu cũ
 *   500 internal                — lỗi server
 */
router.post('/change-password', (req, res) => {
  const { username, currentPassword, newPassword } = req.body || {};

  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({
      error: 'missing_fields',
      message: 'Vui lòng nhập tên đăng nhập, mật khẩu hiện tại và mật khẩu mới.',
    });
  }

  const trimmedUsername = String(username).trim();
  const user = stmt.getUserByUsername.get(trimmedUsername);
  // Generic message: tránh user enumeration (không phân biệt "user không tồn tại" vs "sai pass").
  const invalidCreds = () =>
    res.status(401).json({
      error: 'invalid_credentials',
      message: 'Sai tài khoản hoặc mật khẩu hiện tại.',
    });

  if (!user) {
    // Mirror pattern /login: user không tồn tại → trả generic 401 luôn
    // (timing attack là mối quan tâm thứ yếu với hệ thống nội bộ; mirror code hiện tại).
    return invalidCreds();
  }

  bcrypt.compare(currentPassword, user.password_hash).then((ok) => {
    if (!ok) {
      return invalidCreds();
    }
    if (String(currentPassword) === String(newPassword)) {
      return res.status(400).json({
        error: 'same_password',
        message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
      });
    }
    // Hash mật khẩu mới với cost=10 (mirror seed).
    return bcrypt.hash(String(newPassword), 10).then((newHash) => {
      const result = stmt.updateUserPasswordHash.run(newHash, user.id);
      if (result.changes !== 1) {
        console.error('[auth/change-password] update ảnh hưởng 0 rows cho user id', user.id);
        return res.status(500).json({ error: 'internal', message: 'Lỗi server.' });
      }
      return res.status(204).send();
    });
  }).catch((err) => {
    console.error('[auth/change-password] bcrypt error:', err);
    return res.status(500).json({ error: 'internal', message: 'Lỗi server.' });
  });
});

/** GET /api/me — Current authenticated user. */
router.get('/me', requireAuth, (req, res) => {
  // req.user đã populate đầy đủ (kèm departments CSV)
  return res.json({ user: req.user });
});

export default router;