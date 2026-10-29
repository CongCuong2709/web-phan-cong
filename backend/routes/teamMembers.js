/**
 * routes/teamMembers.js — Derive team members từ users + tier items.
 *
 * Trước đây frontend hardcode CONSTRUCTION_TEAM_MEMBERS trong source — giờ lấy từ DB.
 * → "dữ liệu lạ" không khớp DB.
 *
 * Bây giờ: backend derive từ users (Nhân viên + Trưởng phòng) + tier items (count tasks)
 * → luôn khớp với DB.
 */

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { headOf, isHead, parseDepartments } from '../lib/policies.js';
import { today } from '../lib/dates.js';

const router = Router();
router.use(requireAuth);

/** GET /api/team-members — List derived members cho current user. */
router.get('/', (req, res) => {
  const allUsers = db.prepare(`
    SELECT u.id, u.username, u.fullname, u.role, u.initial,
      (SELECT GROUP_CONCAT(department_code, ',') FROM user_departments WHERE user_id = u.id) AS departments,
      (SELECT GROUP_CONCAT(department_code, ',') FROM user_departments WHERE user_id = u.id AND is_head = 1) AS head_of
    FROM users u WHERE u.is_active = 1
  `).all();
  // Nhân viên thường không xem danh sách; Trưởng phòng (không thuộc HĐQT/Điều hành) chỉ xem phòng mình làm trưởng.
  if (req.user.role === 'employee' && !isHead(req.user)) return res.json({ members: [] });
  const scope = req.user.role === 'employee' ? headOf(req.user) : null;

  // Lấy tất cả T4 tasks (assignable to employees) + count theo owner
  // Status là enum `blocked`/`doing`/...; tier 4 có bundle_id optional.
  // Bỏ việc thuộc dự án / giai đoạn đã lưu trữ.
  const allT4 = db.prepare(`
    SELECT t.id, t.owner_user_id, t.department_code, t.status, t.progress, t.end_date, t.blocker_note
    FROM tasks t
      JOIN bundles b ON b.id = t.bundle_id
      JOIN phases ph ON ph.id = b.phase_id
      JOIN projects p ON p.id = ph.project_id
    WHERE ph.archived_at IS NULL AND p.archived_at IS NULL
  `).all();
  const todayStr = today();

  const members = [];

  for (const u of allUsers) {
    // Chỉ người làm đầu việc (Nhân viên, Trưởng phòng ở mọi cấp bậc) có trong danh sách.
    const heads = parseDepartments(u.head_of);
    if (u.role !== 'employee' && heads.length === 0) continue;
    // Điều hành kiêm Trưởng phòng chỉ tính ở phòng mình làm trưởng.
    const depts = u.role === 'employee' ? parseDepartments(u.departments) : heads;
    const shared = scope ? depts.filter((d) => scope.includes(d)) : depts;
    if (scope && shared.length === 0) continue;
    // Phòng hiển thị: ưu tiên phòng chung với người xem.
    const dept = shared[0] ?? depts[0];

    const userItems = allT4.filter((t) => t.owner_user_id === u.id);
    // "Đang mở" = chưa báo xong (không tính chờ duyệt / đã xong).
    const open = userItems.filter((t) => t.status !== 'done' && t.status !== 'pending_approval');
    const overdue = open.filter((t) => t.end_date && t.end_date < todayStr).length;
    // Cần hỗ trợ = đang nghẽn HOẶC đã báo vướng mắc (blocker_note), chưa xong.
    const blocked = userItems.filter(
      (t) => t.status !== 'done' && (t.status === 'blocked' || (t.blocker_note ?? '').trim() !== ''),
    ).length;

    // Chỉ trả số liệu; câu chữ hiển thị do frontend dựng từ các con số này.
    members.push({
      id: `mem-${u.id}`,
      username: u.username,
      name: u.fullname,
      role: `${heads.includes(dept) ? 'TP' : 'NV'}.${dept ?? ''}`,
      avatar: '',
      activeTasks: open.length,
      overdueTasks: overdue,
      blockedTasks: blocked,
      totalTasks: userItems.length,
      needHelp: blocked > 0,
      department: dept,
    });
  }

  return res.json({ members });
});

export default router;