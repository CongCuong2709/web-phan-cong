/**
 * stateMachine.js — Định nghĩa state machine cho status của task.
 *
 * Mục tiêu: thay thế việc gán `status` tự do trong code (Fix C9 — ghi đè status
 * của Trưởng phòng). Mọi mutation lên status phải đi qua `canTransition()`.
 *
 * States:
 *   pending           — khởi tạo, chưa làm gì
 *   doing             — đang thực hiện
 *   pending_approval  — owner tick "xong", chờ Trưởng phòng duyệt
 *   done              — Trưởng phòng đã duyệt (terminal)
 *   blocked           — bị nghẽn, cần trợ giúp
 *
 * Transition rules:
 *   - Done là terminal (không ai được đổi nữa, kể cả admin).
 *   - Blocked chỉ được gỡ bởi Trưởng phòng phụ trách / admin.
 *   - Pending_approval → doing (Trưởng phòng trả về) hoặc done (Trưởng phòng duyệt).
 *
 * Sử dụng:
 *   if (!canTransition(currentStatus, newStatus, user, task).ok) {
 *     return res.status(403).json({ error: 'invalid_transition', ... });
 *   }
 */

import { isBundleLead, isProjectLead } from './policies.js';

/** Transition table: from -> [allowed to]. */
const TRANSITIONS = {
  pending: ['doing', 'blocked'],
  doing: ['pending_approval', 'blocked', 'pending'],
  pending_approval: ['done', 'doing'],
  blocked: ['doing', 'pending'],
  done: [], // terminal
};

/**
 * Kiểm tra 1 user có được phép thực hiện transition `from` → `to` không.
 *
 * @param {string} from     - status hiện tại
 * @param {string} to       - status mong muốn
 * @param {object} user     - req.user (đã có role, departments, id, username)
 * @param {object} task     - row có tier, owner_user_id, project_owner_user_id, bundle_owner_user_id
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

  if (from === 'done') return { ok: false, reason: 'Mục đã đóng, không thể đổi trạng thái.' };

  // Admin, Điều hành phụ trách dự án (T1–T3), Trưởng phòng phụ trách hạng mục (T3, T4):
  // đổi tự do theo bảng transition. Đóng T1–T3 (done) vẫn đi qua Nghiệm thu.
  if (user.role === 'admin') return { ok: true };
  if (task.tier < 4 && isProjectLead(user, task)) return { ok: true };
  if (isBundleLead(user, task)) return { ok: true };

  // Người làm đầu việc (nhân viên, hoặc Trưởng phòng làm việc không thuộc hạng mục mình).
  if (task.tier === 4 && task.owner_user_id === user.id) {
    // Được phép: pending→doing (bắt đầu), doing→pending_approval (báo xong),
    // doing→blocked (xin hỗ trợ), blocked→pending (bỏ yêu cầu hỗ trợ).
    const OWNER_OK = new Set([
      'pending→doing',
      'doing→pending_approval',
      'doing→blocked',
      'blocked→pending',
    ]);
    const key = `${from}→${to}`;
    if (!OWNER_OK.has(key)) {
      return { ok: false, reason: `Người làm không được chuyển '${key}'.` };
    }
    return { ok: true };
  }

  return { ok: false, reason: 'Không có quyền đổi trạng thái mục này.' };
}

/** Lấy danh sách transitions hợp lệ (dùng cho UI dropdown). */
export function listValidTransitions(from) {
  return TRANSITIONS[from] || [];
}

/** Lấy full transition table (dùng cho debug/admin). */
export function getTransitionTable() {
  return JSON.parse(JSON.stringify(TRANSITIONS));
}
