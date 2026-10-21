/**
 * policies.js — NGUỒN CHUẨN DUY NHẤT cho authorization của hệ thống.
 *
 * Mọi quyết định "user X có được phép làm hành vi gì trên entity Y không?"
 * phải resolve về module này. Không được viết `if (req.user.role === 'admin')`
 * rải rác trong route handler — gọi `authorize(action, user, ctx)`.
 *
 * Hợp nhất (2026-10): gộp helper từ `utils/permissions.js` vào đây để có
 * đúng MỘT nơi chứa luật RBAC. `utils/permissions.js` giữ lại như
 * re-export shim để các import cũ không vỡ.
 *
 * Naming convention: `<entity>:<verb>`
 *   - task:create / task:edit / task:delete / task:approve / task:toggle / task:read
 *   - daily_log:create / daily_log:list
 *   - user:list / user:read
 *   - history:read_all
 *
 * Escalation dùng `task:edit` để ghi `tasks.blocker_note`.
 *
 * Return: { ok: true } hoặc { ok: false, status, error, message }
 */

import { db } from '../db.js';

// ============================================================================
// Primitives
// ============================================================================

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} role        - 'admin' | 'director' | 'manager' | 'employee'
 * @property {string|string[]} departments - CSV string hoặc array
 */

/**
 * Normalize departments → array. Accept cả 2 format:
 *   - Array: ['QLDA', 'KTTC']
 *   - CSV string: "QLDA,KTTC" (SQL GROUP_CONCAT)
 *   - null/undefined → []
 */
export function parseDepartments(depts) {
  if (!depts) return [];
  if (Array.isArray(depts)) return depts.filter(Boolean);
  return String(depts).split(',').filter(Boolean);
}

/**
 * User thuộc department hay không.
 * - Item không gắn department → ai cũng thấy.
 * - Admin sentinel (departments rỗng) → all-access.
 */
export function inDepartment(user, department) {
  if (!department) return true;
  const depts = parseDepartments(user.departments);
  if (depts.length === 0) return true; // admin sentinel
  return depts.includes(department);
}

/** Tầng user được phép tạo. */
export function canCreateTiers(role) {
  switch (role) {
    case 'admin': return [1, 2, 3, 4];
    case 'director': return [1, 2];
    case 'manager': return [3, 4];
    case 'employee':
    default: return [4];
  }
}

/** User có sửa được item này không. `item` phải có `tier` + `department_code`. */
export function canEditTask(user, item) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'director') return false;
  if (user.role === 'manager') return inDepartment(user, item.department_code);
  // employee: only own T4
  return item.tier === 4 && item.owner_username_str === user.username;
}

/** User có ghi được daily log cho task này không. */
export function canAddDailyLog(user, task) {
  if (!user || !task) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'director') return false;
  if (user.role === 'manager') {
    return inDepartment(user, task.department_code);
  }
  // employee: chỉ owner
  return task.owner_user_id === user.id;
}

/** Load task + check quyền edit trong 1 bước. */
export function loadTaskIfEditable(user, taskId) {
  const row = db.prepare(`SELECT t.*, u.username AS owner_username_str
    FROM tasks t LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.id = ?`).get(taskId);
  if (!row) return { error: 'not_found' };
  if (!canEditTask(user, row)) return { error: 'forbidden' };
  return { item: row };
}

/** Tạo ID unique. Không phải RBAC nhưng nằm cùng nhóm tiện ích backend. */
export function uid(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Policy layer
// ============================================================================

/** Helper: từ chối với status code. */
function deny(status, error, message) {
  return { ok: false, status, error, message };
}
function allow() {
  return { ok: true };
}

/**
 * Tiers mà role được phép TẠO.
 * (Khác với task:edit vì 1 role có thể edit nhiều tier hơn là tạo —
 * vd director tạo T1/T2 nhưng không edit gì cả.)
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

  'task:toggle': (user, { task }) => {
    if (task.owner_user_id !== user.id && user.role !== 'admin') {
      return deny(403, 'forbidden', 'Chỉ owner hoặc admin mới toggle.');
    }
    return allow();
  },

  'task:read': (user, { task }) => {
    // canSee logic: admin/director thấy hết, manager thấy cùng dept,
    // employee thấy T4 own.
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

  // ── Daily log (gắn trực tiếp vào task) ─────────────────────────────
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