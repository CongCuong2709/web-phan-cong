/**
 * policies.js — NGUỒN CHUẨN DUY NHẤT cho authorization của hệ thống.
 *
 * Mọi quyết định "user X có được phép làm hành vi gì trên entity Y không?"
 * phải resolve về module này. Không được viết `if (req.user.role === 'admin')`
 * rải rác trong route handler — gọi `authorize(action, user, ctx)`.
 *
 * Mô hình phụ trách theo tầng:
 *   board (HĐQT)       — xem tất cả, tạo dự án và chọn 1 Điều hành phụ trách.
 *   director (Điều hành)— xem tất cả; trong dự án mình phụ trách: tạo / sửa giai đoạn,
 *                         tạo hạng mục và giao cho 1 Trưởng phòng, nghiệm thu giai đoạn / dự án.
 *   manager (Trưởng phòng) — trong hạng mục mình phụ trách: tạo đầu việc cho chính mình
 *                         hoặc nhân viên cùng phòng, duyệt / trả về / gỡ vướng, nghiệm thu hạng mục.
 *   employee (Nhân viên)— làm đầu việc của mình.
 *   admin              — toàn quyền.
 *
 * Mỗi row do db.js trả về mang sẵn người phụ trách của chuỗi cha:
 *   project_owner_user_id (mọi tầng), bundle_owner_user_id (T4),
 *   department_code (T3, T4) — nên policy không cần truy vấn thêm.
 *
 * Naming convention: `<entity>:<verb>`
 *   - task:create / task:assign / task:reassign / task:edit / task:delete / task:archive
 *     task:close / task:approve / task:attach / task:toggle / task:read
 *   - daily_log:create
 *   - user:list / user:read
 *   - history:read_all
 *   - weekly_report:write / weekly_report:read
 *
 * Return: { ok: true } hoặc { ok: false, status, error, message }
 */

// ============================================================================
// Primitives
// ============================================================================

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} role        - 'admin' | 'board' | 'director' | 'manager' | 'employee'
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

/** Tạo ID unique. Không phải RBAC nhưng nằm cùng nhóm tiện ích backend. */
export function uid(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Điều hành phụ trách dự án chứa `item` (item ở bất kỳ tầng nào). */
export function isProjectLead(user, item) {
  return user.role === 'director' && item.project_owner_user_id === user.id;
}

/** Trưởng phòng phụ trách hạng mục: chính hạng mục (T3) hoặc hạng mục chứa đầu việc (T4). */
export function isBundleLead(user, item) {
  if (user.role !== 'manager') return false;
  if (item.tier === 3) return item.owner_user_id === user.id;
  if (item.tier === 4) return item.bundle_owner_user_id === user.id;
  return false;
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

/** Người xem được toàn bộ cây công việc. */
const SEES_ALL = new Set(['admin', 'board', 'director']);

const POLICIES = {
  // ── Task ────────────────────────────────────────────────────────────
  /**
   * Tạo mục mới. `parent` = row mục cha (đã có `tier`), null với dự án.
   *   T1: HĐQT. T2, T3: Điều hành phụ trách dự án. T4: Trưởng phòng phụ trách hạng mục.
   */
  'task:create': (user, { tier, parent }) => {
    if (!Number.isInteger(tier) || tier < 1 || tier > 4) {
      return deny(400, 'invalid_tier', 'Tier phải là 1, 2, 3 hoặc 4.');
    }
    if (user.role === 'admin') return allow();
    if (tier === 1) {
      return user.role === 'board'
        ? allow()
        : deny(403, 'forbidden', 'Chỉ Hội đồng quản trị mới tạo dự án.');
    }
    if (!parent) return deny(400, 'parent_id_required', 'Cần chọn mục cấp trên.');
    if (tier === 2 || tier === 3) {
      return isProjectLead(user, parent)
        ? allow()
        : deny(403, 'forbidden', 'Chỉ Điều hành phụ trách dự án mới tạo giai đoạn / hạng mục.');
    }
    return isBundleLead(user, parent)
      ? allow()
      : deny(403, 'forbidden', 'Chỉ Trưởng phòng phụ trách hạng mục mới tạo đầu việc.');
  },

  /**
   * Người được chọn làm phụ trách có hợp lệ với tầng đó không.
   *   T1: một Điều hành. T3: một Trưởng phòng thuộc `department`.
   *   T4: chính Trưởng phòng phụ trách hạng mục, hoặc nhân viên thuộc phòng của hạng mục.
   * `assignee` = { id, role, departments }; `bundle` = row hạng mục (chỉ T4).
   */
  'task:assign': (_user, { tier, assignee, department, bundle }) => {
    if (!assignee) return deny(400, 'invalid_owner', 'Không tìm thấy người được giao.');
    if (tier === 1) {
      return assignee.role === 'director'
        ? allow()
        : deny(400, 'invalid_owner', 'Người phụ trách dự án phải là một Điều hành.');
    }
    if (tier === 3) {
      if (assignee.role !== 'manager') {
        return deny(400, 'invalid_owner', 'Người phụ trách hạng mục phải là một Trưởng phòng.');
      }
      return parseDepartments(assignee.departments).includes(department)
        ? allow()
        : deny(400, 'invalid_owner', 'Trưởng phòng được chọn không thuộc phòng của hạng mục.');
    }
    if (tier === 4) {
      if (assignee.id === bundle.owner_user_id) return allow();
      return assignee.role === 'employee' && parseDepartments(assignee.departments).includes(bundle.department_code)
        ? allow()
        : deny(400, 'invalid_owner', 'Chỉ giao được cho chính Trưởng phòng phụ trách hoặc nhân viên cùng phòng.');
    }
    return allow();
  },

  /**
   * Đổi người phụ trách của mục đã có.
   *   T1: HĐQT (Điều hành không tự đổi). T3: Điều hành phụ trách dự án. T4: Trưởng phòng phụ trách hạng mục.
   *   T2 đi theo dự án, không đổi riêng.
   */
  'task:reassign': (user, { task }) => {
    if (task.tier === 2) {
      return deny(400, 'phase_owner_follows_project', 'Giai đoạn do Điều hành phụ trách dự án quản lý.');
    }
    if (user.role === 'admin') return allow();
    if (task.tier === 1 && user.role === 'board') return allow();
    if (task.tier === 3 && isProjectLead(user, task)) return allow();
    if (task.tier === 4 && isBundleLead(user, task)) return allow();
    return deny(403, 'forbidden', 'Không có quyền đổi người phụ trách mục này.');
  },

  /**
   * Sửa thông tin mục.
   *   T1: HĐQT, Điều hành phụ trách. T2, T3: Điều hành phụ trách dự án.
   *   T4: Trưởng phòng phụ trách hạng mục, người làm (ghi chú / vướng mắc).
   */
  'task:edit': (user, { task }) => {
    if (user.role === 'admin') return allow();
    if (task.tier === 1 && user.role === 'board') return allow();
    if (task.tier <= 3 && isProjectLead(user, task)) return allow();
    if (task.tier === 4 && (isBundleLead(user, task) || task.owner_user_id === user.id)) return allow();
    return deny(403, 'forbidden', 'Không có quyền chỉnh sửa mục này.');
  },

  'task:delete': (user) => {
    if (user.role !== 'admin') {
      return deny(403, 'forbidden', 'Chỉ admin mới được xoá task.');
    }
    return allow();
  },

  /** Lưu trữ / khôi phục: dự án (HĐQT, Điều hành phụ trách), giai đoạn (Điều hành phụ trách). */
  'task:archive': (user, { task }) => {
    if (task.tier !== 1 && task.tier !== 2) {
      return deny(400, 'archive_tier', 'Chỉ lưu trữ được dự án hoặc giai đoạn.');
    }
    if (user.role === 'admin' || isProjectLead(user, task)) return allow();
    if (task.tier === 1 && user.role === 'board') return allow();
    return deny(403, 'forbidden', 'Chỉ Điều hành phụ trách (hoặc HĐQT với dự án) mới lưu trữ được.');
  },

  /**
   * Nghiệm thu / đóng mục cha (T1–T3).
   *   T3 hạng mục: Trưởng phòng phụ trách. T2 giai đoạn, T1 dự án: Điều hành phụ trách.
   */
  'task:close': (user, { task }) => {
    if (user.role === 'admin') return allow();
    if (task.tier === 3) {
      return isBundleLead(user, task)
        ? allow()
        : deny(403, 'forbidden', 'Chỉ Trưởng phòng phụ trách hạng mục mới nghiệm thu.');
    }
    return isProjectLead(user, task)
      ? allow()
      : deny(403, 'forbidden', 'Chỉ Điều hành phụ trách dự án mới nghiệm thu giai đoạn / dự án.');
  },

  /** Duyệt / trả về / gỡ vướng đầu việc: Trưởng phòng phụ trách hạng mục. */
  'task:approve': (user, { task }) => {
    if (user.role === 'admin' || isBundleLead(user, task)) return allow();
    return deny(403, 'forbidden', 'Chỉ Trưởng phòng phụ trách hạng mục mới duyệt đầu việc.');
  },

  /**
   * Tệp "khi tạo / giao việc" (không gắn tin trao đổi).
   *   T1–T3: ai sửa được mục đó. T4: người giao, Trưởng phòng phụ trách.
   * Kết quả của người làm gửi qua luồng trao đổi (`task:edit`).
   */
  'task:attach': (user, { task }) => {
    if (task.tier < 4) {
      const r = POLICIES['task:edit'](user, { task });
      return r.ok ? allow() : deny(403, 'forbidden', 'Không có quyền thêm / xoá tệp của mục này.');
    }
    if (task.assigned_by_user_id === user.id) return allow();
    const r = POLICIES['task:approve'](user, { task });
    return r.ok ? allow() : deny(403, 'forbidden', 'Chỉ người giao việc hoặc Trưởng phòng mới thêm / xoá tệp khi giao việc. Tệp kết quả hãy gửi kèm trong mục Trao đổi.');
  },

  'task:toggle': (user, { task }) => {
    if (task.owner_user_id !== user.id && user.role !== 'admin') {
      return deny(403, 'forbidden', 'Chỉ người làm mới đổi trạng thái việc của mình.');
    }
    return allow();
  },

  /**
   * Xem mục.
   *   HĐQT, Điều hành, admin: tất cả.
   *   Trưởng phòng: mọi dự án / giai đoạn / hạng mục; đầu việc trong hạng mục mình, của mình,
   *     hoặc thuộc phòng mình.
   *   Nhân viên: đầu việc của mình; tầng trên là ngữ cảnh chỉ đọc.
   */
  'task:read': (user, { task }) => {
    if (SEES_ALL.has(user.role) || task.tier < 4) return allow();
    if (task.owner_user_id === user.id) return allow();
    if (user.role === 'manager'
      && (isBundleLead(user, task) || parseDepartments(user.departments).includes(task.department_code))) {
      return allow();
    }
    return deny(403, 'forbidden', 'Không có quyền xem đầu việc này.');
  },

  // ── Daily log (gắn trực tiếp vào task) ─────────────────────────────
  'daily_log:create': (user, { task }) => {
    if (user.role === 'admin' || task.owner_user_id === user.id || isBundleLead(user, { ...task, tier: 4 })) {
      return allow();
    }
    return deny(403, 'forbidden', 'Chỉ người làm hoặc Trưởng phòng phụ trách mới ghi nhật ký.');
  },

  // ── User directory ──────────────────────────────────────────────────
  /** Danh bạ để chọn người phụ trách. Trưởng phòng chỉ lọc được phòng mình. */
  'user:list': (user, { department }) => {
    if (user.role === 'employee') {
      return deny(403, 'forbidden', 'Nhân viên không xem danh bạ.');
    }
    if (user.role === 'manager' && department && !inDepartment(user, department)) {
      return deny(403, 'forbidden', `Bạn không thuộc phòng ban '${department}'.`);
    }
    return allow();
  },

  'user:read': (user, { targetDepts }) => {
    if (SEES_ALL.has(user.role)) return allow();
    if (user.role === 'manager') {
      const overlap = (targetDepts || []).some((d) => inDepartment(user, d));
      return overlap ? allow() : deny(403, 'forbidden', 'Trưởng phòng chỉ xem người cùng phòng.');
    }
    return deny(403, 'forbidden', 'Nhân viên không xem người khác.');
  },

  // ── History ─────────────────────────────────────────────────────────
  'history:read_all': (user) => {
    if (!SEES_ALL.has(user.role)) {
      return deny(403, 'forbidden', 'Chỉ HĐQT, Điều hành, admin xem lịch sử toàn hệ thống.');
    }
    return allow();
  },

  // ── Báo cáo tuần (không có bước duyệt) ─────────────────────────────
  /** Nhân viên và Trưởng phòng viết báo cáo tuần; HĐQT, Điều hành không viết. */
  'weekly_report:write': (user) => {
    if (user.role === 'employee' || user.role === 'manager') return allow();
    return deny(403, 'forbidden', 'Chỉ Nhân viên và Trưởng phòng viết báo cáo tuần.');
  },

  /**
   * Xem báo cáo tuần của người khác: HĐQT, Điều hành, admin xem tất cả;
   * Trưởng phòng xem người cùng phòng; ai cũng xem được của chính mình.
   */
  'weekly_report:read': (user, { targetUserId, targetDepts = [] }) => {
    if (SEES_ALL.has(user.role) || user.id === Number(targetUserId)) return allow();
    if (user.role === 'manager' && targetDepts.some((d) => inDepartment(user, d))) return allow();
    return deny(403, 'forbidden', 'Không có quyền xem báo cáo này.');
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
