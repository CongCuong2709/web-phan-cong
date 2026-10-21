/**
 * stateMachine.js — Định nghĩa state machine cho status của task.
 *
 * Mục tiêu: thay thế việc gán `status` tự do trong code (Fix C9 — ghi đè status
 * của manager). Mọi mutation lên status phải đi qua `canTransition()`.
 *
 * States:
 *   pending           — khởi tạo, chưa làm gì
 *   doing             — đang thực hiện
 *   pending_approval  — owner tick "xong", chờ manager duyệt
 *   done              — manager đã duyệt (terminal)
 *   blocked           — bị nghẽn, cần trợ giúp
 *
 * Transition rules:
 *   - Done là terminal (không ai được đổi nữa, kể cả admin).
 *   - Blocked chỉ được gỡ bởi manager/admin.
 *   - Pending_approval → doing (manager trả về) hoặc done (manager duyệt).
 *
 * Sử dụng:
 *   if (!canTransition(currentStatus, newStatus, user, task).ok) {
 *     return res.status(403).json({ error: 'invalid_transition', ... });
 *   }
 */

import { inDepartment } from './policies.js';

/** Transition table: from -> [allowed to]. */
const TRANSITIONS = {
  pending: ['doing', 'blocked'],
  doing: ['pending_approval', 'blocked', 'pending'],
  pending_approval: ['done', 'doing'],
  blocked: ['doing', 'pending'],
  done: [], // terminal
};

/**
 * Roles được phép thực hiện transition (mặc định).
 * Transition cụ thể có thể override trong `canTransition` bên dưới.
 */
const TRANSITION_ROLES = {
  // Pending → doing: chính owner hoặc manager/admin trong cùng dept
  // Pending → blocked: chính owner hoặc bất kỳ ai thấy task
  // Doing → pending_approval: chính owner tick
  // Doing → blocked: owner hoặc manager/admin
  // Doing → pending: rollback (manager/admin only)
  // Pending_approval → done: manager/admin only (duyệt)
  // Pending_approval → doing: manager/admin only (từ chối, trả về)
  // Blocked → doing/pending: manager/admin only (gỡ nghẽn)
};

/**
 * Kiểm tra 1 user có được phép thực hiện transition `from` → `to` không.
 *
 * @param {string} from     - status hiện tại
 * @param {string} to       - status mong muốn
 * @param {object} user     - req.user (đã có role, departments, id, username)
 * @param {object} task     - row tasks (đã có owner_user_id, department_code)
 * @returns {{ok: boolean, reason?: string}}
 */
export function canTransition(from, to, user, task) {
  if (!from || !to) return { ok: false, reason: 'missing_status' };
  if (from === to) return { ok: true }; // no-op

  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `Không thể chuyển từ '${from}' sang '${to}'. Allowed: [${allowed.join(', ') || 'none'}]`,
    };
  }

  // Admin: full quyền (trừ khi task đã done).
  if (user.role === 'admin') {
    if (from === 'done') return { ok: false, reason: 'Task đã done, không thể chỉnh sửa.' };
    return { ok: true };
  }

  // Director: read-only, không được mutate.
  if (user.role === 'director') {
    return { ok: false, reason: 'Director không có quyền chỉnh sửa task.' };
  }

  // Employee: chỉ T4 của chính mình.
  if (user.role === 'employee') {
    if (task.tier !== 4) {
      return { ok: false, reason: 'Employee chỉ có thể thao tác trên T4.' };
    }
    if (task.owner_user_id !== user.id) {
      return { ok: false, reason: 'Employee chỉ có thể thao tác trên task của mình.' };
    }
    // Employee được phép: doing→pending_approval (tick xong),
    // pending→doing (bắt đầu), doing/blocked→blocked (xin help), blocked→pending (bỏ help).
    const EMPLOYEE_OK = new Set([
      'pending→doing',
      'doing→pending_approval',
      'doing→blocked',
      'blocked→pending',
    ]);
    const key = `${from}→${to}`;
    if (!EMPLOYEE_OK.has(key)) {
      return { ok: false, reason: `Employee không được chuyển '${key}'.` };
    }
    return { ok: true };
  }

  // Manager: phải cùng department.
  if (user.role === 'manager') {
    if (!inDepartment(user, task.department_code)) {
      return { ok: false, reason: 'Manager phải cùng phòng ban với task.' };
    }
    // Manager full quyền transition (trong phòng ban của mình).
    if (from === 'done') return { ok: false, reason: 'Task đã done.' };
    return { ok: true };
  }

  return { ok: false, reason: 'Role không xác định.' };
}

/** Lấy danh sách transitions hợp lệ (dùng cho UI dropdown). */
export function listValidTransitions(from) {
  return TRANSITIONS[from] || [];
}

/** Lấy full transition table (dùng cho debug/admin). */
export function getTransitionTable() {
  return JSON.parse(JSON.stringify(TRANSITIONS));
}
