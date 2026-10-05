/**
 * routes/teamMembers.js — Derive team members từ users + tier items.
 *
 * Trước đây: frontend dùng hardcoded CONSTRUCTION_TEAM_MEMBERS từ constructionData.ts
 * → "dữ liệu lạ" không khớp DB.
 *
 * Bây giờ: backend derive từ users (role employee/manager) + tier items (count tasks)
 * → luôn khớp với DB.
 */

import { Router } from 'express';
import { db, stmt } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { inDepartment } from '../utils/permissions.js';

const router = Router();
router.use(requireAuth);

/** GET /api/team-members — List derived members cho current user. */
router.get('/', (req, res) => {
  // Lấy tất cả users (active) — manager/employee mới có trong team view
  const allUsers = db.prepare(`
    SELECT u.id, u.username, u.fullname, u.role, u.initial,
      (SELECT GROUP_CONCAT(department_code, ',') FROM user_departments WHERE user_id = u.id) AS departments
    FROM users u WHERE u.is_active = 1
  `).all();

  // Lấy tất cả T4 items (assignable to employees) + count theo owner
  const allT4 = db.prepare(`
    SELECT id, owner_user_id, department_code, status, progress, code, title
    FROM tier_items WHERE tier = 4
  `).all();

  const members = [];

  for (const u of allUsers) {
    // Admin/Director: bỏ qua — không phải task input
    if (u.role === 'admin' || u.role === 'director') continue;

    // Manager: liệt kê cả manager + employee trong cùng dept
    if (req.user.role === 'manager' && !inDepartment(req.user, u.departments)) continue;
    if (req.user.role === 'employee') continue; // employee chỉ xem chính mình ở view khác

    const userItems = allT4.filter((t) => t.owner_user_id === u.id);
    const active = userItems.filter((t) => t.progress !== 100).length;
    const needHelp = userItems.some((t) =>
      t.status === 'Điểm nghẽn' || t.status === 'Đang nghẽn'
    );

    members.push({
      id: `mem-${u.id}`,
      username: u.username,
      name: u.fullname,
      role: u.role === 'manager' ? `TP.${(u.departments || '').split(',')[0]}` : `NV.${(u.departments || '').split(',')[0]}`,
      avatar: '', // sẽ được fill qua doFetch trong frontend
      activeTasks: active,
      totalTasks: userItems.length,
      onTimeRate: userItems.length > 0 && active === 0
        ? '100% đúng hạn'
        : `${active}/${userItems.length} đang chạy`,
      statusText: active > 0 ? `${active} việc đang làm` : 'Hoàn tất gói việc',
      statusType: active > 2 ? 'warning' : active > 0 ? 'good' : 'idle',
      workloadPercent: Math.min(100, active * 25),
      needHelp,
      department: (u.departments || '').split(',')[0] || undefined,
    });
  }

  return res.json({ members });
});

export default router;