/**
 * permissions.ts — Single source of truth cho RBAC.
 *
 * Mọi quyết định "user X có được phép làm hành động Y trên entity Z không?"
 * phải đi qua các helper trong file này. Tránh inline check rải rác ở component.
 *
 * Quy tắc nghiệp vụ (đã thống nhất với BGĐ):
 *
 *   admin     : full quyền (đọc + sửa + tạo) trên mọi phòng ban.
 *   director  : chỉ đọc, KHÔNG sửa dữ liệu (executive mode).
 *               Tạo được T1 (Dự án) và T2 (Giai đoạn) — để BGĐ có thể
 *               khởi tạo khung điều hành mới mà không phụ thuộc admin.
 *   manager   : chỉ trong phòng ban mình. Tạo T3 + T4.
 *   employee  : chỉ T4 của chính mình. Chỉ ghi nhật ký SubTask mình được giao.
 *
 * Lưu ý: Khi có backend thật, các helper này vẫn dùng được để ẩn UI;
 * backend phải tự enforce lại ở middleware (frontend không phải boundary).
 */

import type {
  Department,
  SubTask,
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
 * - Admin sentinel (departments.length === 0, không có dept nào) → coi như all-access.
 * - Item không gắn department → ai cũng thấy (legacy/seed data).
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
 * Dùng cho NewItemModal (đã được thực hiện ở A1 fix).
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
 * Quyết định user có sửa được 1 TierItem cụ thể không.
 * Logic khớp với fix A4 (chi tiết guard trong DetailsDrawer trước đó).
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

/** Cũng dùng cho toggle checkbox deliverables — quyền giống canEditTier. */
export const canEditDeliverable = canEditTierItem;

/** Cho phép đổi trạng thái (status dropdown) — same guard as edit. */
export const canChangeStatus = canEditTierItem;

// ---------------------------------------------------------------------------
// SubTask (T4.5) + DailyLog (nhật ký thi công)
// ---------------------------------------------------------------------------

/**
 * Quyền edit SubTask. Manager cần có parent item trong phòng ban mình
 * để xác định department (SubTask không có field department riêng).
 */
export function canEditSubtask(
  user: User | null | undefined,
  subtask: SubTask,
  parentItem?: TierItem
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'director') return false;
  if (user.role === 'manager') {
    if (!parentItem) return false; // thiếu parent thì từ chối an toàn
    return inDepartment(user, parentItem.department);
  }
  return subtask.assigneeUsername === user.username;
}

/**
 * Quyền ghi nhật ký thi công (DailyLog) cho 1 SubTask.
 * Theo nghiệp vụ xây dựng: chỉ assignee được ghi, manager có thể override.
 */
export function canAddDailyLog(
  user: User | null | undefined,
  subtask: SubTask,
  parentItem?: TierItem
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'director') return false;
  if (user.role === 'manager') {
    if (!parentItem) return false;
    return inDepartment(user, parentItem.department);
  }
  return subtask.assigneeUsername === user.username;
}

// ---------------------------------------------------------------------------
// TeamLeadTask (giao việc nhóm) + QuickHelpRequest
// ---------------------------------------------------------------------------

/** Quyền duyệt nghiệm thu 1 task. */
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
// Misc: dùng cho phòng ban resolver khi tạo task cá nhân (sẽ áp dụng ở Sprint 4)
// ---------------------------------------------------------------------------

/**
 * Tìm manager đầu tiên của user (dùng cho C4 fix sắp tới — hiển thị "Trưởng phòng
 * giao" đúng người thay vì chính employee).
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