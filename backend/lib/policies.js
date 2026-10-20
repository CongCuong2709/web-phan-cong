/**
 * policies.js — Centralized authorization policies.
 *
 * Mục tiêu: 1 nguồn sự thật cho "ai được phép làm gì".
 * Trước khi có policy module, code dùng `if (req.user.role !== 'admin')` rải rác khắp route handler.
 * Bây giờ: mỗi route gọi `authorize('task:delete', user, { task })`.
 *
 * Action naming convention: `<entity>:<verb>`
 *   - task:create / task:edit / task:delete / task:approve / task:toggle
 *   - daily_log:create / daily_log:list
 *   - user:list / user:read
 *   - history:read_all
 *
 * Escalation dùng `task:edit` để ghi `tasks.blocker_note`.
 *
 * Return: { ok: true } hoặc { ok: false, status, error, message }
 */

import { inDepartment, canEditTask, canCreateTiers, canAddDailyLog } from '../utils/permissions.js';

/** Helper: từ chối với status code. */
function deny(status, error, message) {
  return { ok: false, status, error, message };
}
function allow() {
  return { ok: true };
}

/**
 * Tiers mà role được phép TẠO.
 * (Dùng cho task:create; khác với task:edit vì 1 role có thể edit nhiều
 * tier hơn là tạo — vd director tạo T1/T2 nhưng không edit gì cả.)
 */
function canCreateTier(role, tier) {
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) {
    return deny(400, 'invalid_tier', 'Tier phải là 1, 2, 3 hoặc 4.');
  }
  const allowed = canCreateTiers(role);
  if (!allowed.includes(tier)) {
    return deny(403, 'tier_forbidden',
      `Role '${role}' không được tạo tier ${tier}. Chỉ chấp nhận: ${allowed.join(', ')}.`);
  }
  return allow();
}

/** Cross-department guard: target user có thuộc department của actor không. */
function inSameOrNoDept(actor, targetDept) {
  if (!targetDept) return true; // item không gắn dept → OK
  return inDepartment(actor, targetDept);
}

const POLICIES = {
  // ── Task ────────────────────────────────────────────────────────────
  'task:create': (user, { tier, targetDept }) => {
    const t = canCreateTier(user.role, tier);
    if (!t.ok) return t;
    // Manager không được tạo task cho nhân viên ngoài phòng ban
    if (user.role === 'manager' && !inSameOrNoDept(user, targetDept)) {
      return deny(403, 'cross_dept',
        'Manager không được tạo task cho phòng ban khác.');
    }
    return allow();
  },

  'task:edit': (user, { task }) => {
    if (!canEditTask(user, task)) {
      return deny(403, 'forbidden', 'Không có quyền chỉnh sửa task này.');
    }
    return allow();
  },

  'task:delete': (user) => {
    if (user.role !== 'admin') {
      return deny(403, 'forbidden', 'Chỉ admin mới được xoá task.');
    }
    return allow();
  },

  'task:approve': (user, { task }) => {
    if (!['admin', 'manager'].includes(user.role)) {
      return deny(403, 'forbidden', 'Chỉ admin/manager mới duyệt task.');
    }
    if (user.role === 'manager' && !inDepartment(user, task.department_code)) {
      return deny(403, 'cross_dept_approve', 'Manager phải cùng phòng ban.');
    }
    return allow();
  },

  // 'task:request_help' đã bỏ — escalation dùng 'task:edit' để ghi blocker_note.
  'task:request_help': () => deny(410, 'gone', 'task:request_help đã bị bỏ. Dùng task:edit để ghi tasks.blocker_note.'),

  'task:toggle': (user, { task }) => {
    if (task.owner_user_id !== user.id && user.role !== 'admin') {
      return deny(403, 'forbidden', 'Chỉ owner hoặc admin mới toggle.');
    }
    return allow();
  },

  'task:read': (user, { task }) => {
    // canSee logic: admin/director thấy hết, manager thấy cùng dept, employee thấy T4 own
    if (user.role === 'admin' || user.role === 'director') return allow();
    if (user.role === 'manager') {
      if (task.tier === 1) return allow(); // read-only T1
      return inDepartment(user, task.department_code)
        ? allow()
        : deny(403, 'forbidden', 'Không thuộc phòng ban.');
    }
    // employee
    if (task.tier === 4) {
      return task.owner_username_str === user.username
        ? allow()
        : deny(403, 'forbidden', 'Không phải task của bạn.');
    }
    return allow(); // T1/T2/T3 = read-only context
  },

  // ── Daily log (gắn trực tiếp vào task) ─────────
  'daily_log:create': (user, { task }) => {
    if (!canAddDailyLog(user, task)) {
      return deny(403, 'forbidden',
        'Chỉ owner task hoặc manager trong phòng ban mới ghi nhật ký.');
    }
    return allow();
  },

  // ── User directory ──────────────────────────────────────────────────
  'user:list': (user, { department }) => {
    if (user.role === 'employee') {
      return deny(403, 'forbidden', 'Employee không list users.');
    }
    if (department && !inDepartment(user, department)) {
      return deny(403, 'forbidden', `Bạn không thuộc phòng ban '${department}'.`);
    }
    return allow();
  },

  'user:read': (user, { targetDepts }) => {
    if (user.role === 'admin' || user.role === 'director') return allow();
    if (user.role === 'manager') {
      const overlap = (targetDepts || []).some((d) => inDepartment(user, d));
      return overlap ? allow() : deny(403, 'forbidden', 'Manager phải cùng phòng ban.');
    }
    return deny(403, 'forbidden', 'Employee không xem user khác.');
  },

  // ── History ─────────────────────────────────────────────────────────
  'history:read_all': (user) => {
    if (!['admin', 'director'].includes(user.role)) {
      return deny(403, 'forbidden', 'Chỉ admin/director xem lịch sử toàn hệ thống.');
    }
    return allow();
  },
};

/**
 * Authorize 1 action. Trả về {ok, status, error, message} nếu fail,
 * {ok: true} nếu pass.
 *
 * Usage:
 *   const r = authorize('task:delete', req.user, {});
 *   if (!r.ok) return res.status(r.status).json(r);
 */
export function authorize(action, user, ctx = {}) {
  const policy = POLICIES[action];
  if (!policy) {
    return deny(500, 'unknown_policy', `Action '${action}' chưa có policy.`);
  }
  return policy(user, ctx);
}

export { POLICIES };
