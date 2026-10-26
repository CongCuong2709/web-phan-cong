/**
 * routes/teamMembers.js — Derive team members từ users + tier items.
 *
 * Trước đây frontend hardcode CONSTRUCTION_TEAM_MEMBERS trong source — giờ lấy từ DB.
 * → "dữ liệu lạ" không khớp DB.
 *
 * Bây giờ: backend derive từ users (role employee/manager) + tier items (count tasks)
 * → luôn khớp với DB.
 */

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { inDepartment } from '../lib/policies.js';
import { today } from '../lib/dates.js';

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

  // Lấy tất cả T4 tasks (assignable to employees) + count theo owner
  // Status là enum `blocked`/`doing`/...; tier 4 có bundle_id optional.
  const allT4 = db.prepare(`
    SELECT id, owner_user_id, department_code, status, progress, end_date
    FROM tasks
  `).all();
  const todayStr = today();

  const members = [];

  for (const u of allUsers) {
    // Admin/Director: bỏ qua — không phải task input
    if (u.role === 'admin' || u.role === 'director') continue;

    // Manager: liệt kê cả manager + employee trong cùng dept
    if (req.user.role === 'manager' && !inDepartment(req.user, u.departments)) continue;
    if (req.user.role === 'employee') continue; // employee chỉ xem chính mình ở view khác

    const userItems = allT4.filter((t) => t.owner_user_id === u.id);
    // "Đang mở" = chưa báo xong (không tính chờ duyệt / đã xong).
    const open = userItems.filter((t) => t.status !== 'done' && t.status !== 'pending_approval');
    const overdue = open.filter((t) => t.end_date && t.end_date < todayStr).length;
    const blocked = userItems.filter((t) => t.status === 'blocked').length;

    // Chỉ trả số liệu; câu chữ hiển thị do frontend dựng từ các con số này.
    members.push({
      id: `mem-${u.id}`,
      username: u.username,
      name: u.fullname,
      role: u.role === 'manager' ? `TP.${(u.departments || '').split(',')[0]}` : `NV.${(u.departments || '').split(',')[0]}`,
      avatar: '',
      activeTasks: open.length,
      overdueTasks: overdue,
      blockedTasks: blocked,
      totalTasks: userItems.length,
      needHelp: blocked > 0,
      department: (u.departments || '').split(',')[0] || undefined,
    });
  }

  return res.json({ members });
});

export default router;