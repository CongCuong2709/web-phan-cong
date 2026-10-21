/**
 * permissions.ts — Lớp ẩn/hiện UI (frontend view-layer).
 *
 * ⚠️ KHÔNG phải boundary bảo mật. File này chỉ quyết định "nút bấm có hiện ra
 * không" để UX không tệ. Mọi request vẫn phải bị backend từ chối nếu user thiếu
 * quyền. Nguồn chuẩn duy nhất cho luật RBAC là `backend/lib/policies.js`
 * (`authorize(action, user, ctx)`).
 *
 * Vì sao vẫn còn file mirror ở frontend:
 *   Component render đồng bộ, không thể chờ round-trip API trước mỗi lần quyết
 *   định hiển thị. Nhưng để tránh lệch logic, các quy tắc ở đây chỉ mô tả
 *   *hành vi hiện tại* và được ghi chú rõ policy backend tương ứng.
 *   Khi đổi quyền, đổi `backend/lib/policies.js` TRƯỚC, rồi cập nhật ở đây.
 *
 * Quy tắc nghiệp vụ (đã thống nhất với BGĐ — nguồn: policies.js):
 *
 *   admin     : full quyền (đọc + sửa + tạo) trên mọi phòng ban.
 *   director  : chỉ đọc, KHÔNG sửa dữ liệu (executive mode).
 *               Tạo được T1 (Dự án) và T2 (Giai đoạn).
 *   manager   : chỉ trong phòng ban mình. Tạo T3 + T4.
 *   employee  : chỉ T4 của chính mình. Chỉ ghi nhật ký của task mình được giao.
 */

import type {
  Department,
  TeamLeadTask,
  TierItem,
  TierLevel,
  User,
} from '../types';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * Kiểm tra user có "thấy" item thuộc phòng ban `department` không.
 * Mirror: policies.js `inDepartment`.
 * - Item không gắn department → ai cũng thấy (T2/T3 là org-level).
 * - Admin sentinel (departments rỗng) → all-access.
 */
export function inDepartment(user: User, department?: Department | string): boolean {
  if (!department) return true;
  if (!user.departments.length) return true; // admin sentinel
  return user.departments.includes(department as Department);
}

/** Tạo ID an toàn — không bao giờ trùng trong cùng 1 tick (dùng khi cần unique). */
let __idCounter = 0;
export function uid(prefix = 'id'): string {
  __idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${__idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// TierItem (cây 4 tầng)
// ---------------------------------------------------------------------------

/**
 * Tầng user được phép tạo mới trên Gantt.
 * Mirror: policies.js `canCreateTiers` (dùng bởi policy `task:create`).
 */
export function canCreateTiers(role: User['role']): TierLevel[] {
  switch (role) {
    case 'admin':
      return [1, 2, 3, 4];
    case 'director':
      return [1, 2];
    case 'manager':
      return [3, 4];
    case 'employee':
    default:
      return [4];
  }
}

/**
 * Quyết định user có sửa được 1 TierItem cụ thể không (để bật/tắt nút Sửa).
 * Mirror: policies.js `canEditTask` (dùng bởi policy `task:edit`).
 */
export function canEditTierItem(
  user: User | null | undefined,
  item: TierItem | null | undefined
): boolean {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'director') return false; // read-only
  if (user.role === 'manager') {
    return inDepartment(user, item.department);
  }
  // employee: chỉ T4 của chính mình
  return item.tier === 4 && item.ownerUsername === user.username;
}

/** Cho phép đổi trạng thái (status dropdown) — cùng guard với edit. */
export const canChangeStatus = canEditTierItem;

// ---------------------------------------------------------------------------
// DailyLog (nhật ký thi công — gắn trực tiếp vào task)
// ---------------------------------------------------------------------------

/**
 * Quyền hiện nút "Ghi nhật ký".
 * Mirror: policies.js `canAddDailyLog` (dùng bởi policy `daily_log:create`).
 *
 * Theo nghiệp vụ xây dựng:
 *   - admin: luôn được
 *   - director: read-only (không ghi log)
 *   - manager: cùng phòng ban với task
 *   - employee: chỉ owner của task
 */
export function canAddDailyLog(
  user: User | null | undefined,
  task: TierItem
): boolean {
  if (!user || !task) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'director') return false;
  if (user.role === 'manager') {
    return inDepartment(user, task.department);
  }
  // employee: chỉ owner của task
  return task.ownerUsername === user.username;
}

// ---------------------------------------------------------------------------
// TeamLeadTask (giao việc nhóm)
// ---------------------------------------------------------------------------

/**
 * Quyền hiện nút nghiệm thu.
 * Mirror: policies.js policy `task:approve`.
 */
export function canApproveTask(
  user: User | null | undefined,
  task?: TeamLeadTask
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'director') return false; // không có tab giao việc nhóm
  if (user.role === 'manager') {
    if (!task) return true;
    return inDepartment(user, task.department);
  }
  return false;
}

/** Quyền xử lý yêu cầu trợ giúp — alias của canApproveTask (cùng quy tắc). */
export const canResolveHelp = canApproveTask;

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/**
 * Tìm manager đầu tiên của user — dùng để hiển thị "Trưởng phòng giao" đúng người
 * thay vì chính employee.
 *
 * Đây là tra cứu dữ liệu thuần túy (hiển thị tên), KHÔNG phải kiểm tra quyền —
 * không cần mirror sang backend.
 */
export function findManagerOf(
  user: User,
  allUsers: User[]
): User | undefined {
  if (user.role === 'manager' || user.role === 'director') return undefined;
  return allUsers.find(
    (u) =>
      u.role === 'manager' &&
      u.departments.some((d) => user.departments.includes(d))
  );
}