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
 *   định hiển thị. Các quy tắc ở đây chỉ mô tả *hành vi hiện tại* và ghi rõ
 *   policy backend tương ứng. Khi đổi quyền, đổi `backend/lib/policies.js` TRƯỚC.
 *
 * Mô hình phụ trách theo tầng (nguồn: policies.js):
 *
 *   board (HĐQT)       : xem tất cả, tạo dự án và chọn 1 Điều hành phụ trách.
 *   director (Điều hành): xem tất cả; trong dự án mình phụ trách — tạo / sửa giai đoạn,
 *                         tạo hạng mục giao Trưởng phòng của phòng, nghiệm thu giai đoạn / dự án.
 *   employee (Nhân viên): làm đầu việc của mình; viết báo cáo tuần.
 *   admin              : toàn quyền.
 *
 * Trưởng phòng (`user.headOf`) là chức vụ, kiêm được ở mọi cấp bậc: trong hạng mục mình
 * phụ trách — tạo đầu việc cho mình hoặc nhân viên cùng phòng, duyệt, nghiệm thu hạng mục.
 */

import type {
  ActiveAppTab,
  Department,
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
 * - Item không gắn department → ai cũng thấy.
 * - Admin sentinel (departments rỗng) → all-access.
 */
export function inDepartment(user: User, department?: Department | string): boolean {
  if (!department) return true;
  if (!user.departments.length) return true; // admin sentinel
  return user.departments.includes(department as Department);
}

/** Điều hành phụ trách dự án chứa `item`. Mirror: policies.js `isProjectLead`. */
export function isProjectLead(user: User, item: Pick<TierItem, 'projectOwnerUserId'>): boolean {
  return user.role === 'director' && item.projectOwnerUserId === user.id;
}

/** User là Trưởng phòng của ít nhất một phòng. Mirror: policies.js `isHead`. */
export function isHead(user: User | null | undefined): boolean {
  return !!user && user.headOf.length > 0;
}

/** Trưởng phòng cấp nhân viên: chỉ xem phạm vi phòng mình (HĐQT / Điều hành kiêm nhiệm xem toàn công ty). */
export function isDeptScoped(user: User | null | undefined): boolean {
  return user?.role === 'employee' && isHead(user);
}

/** Người phụ trách hạng mục (T3) hoặc hạng mục chứa đầu việc (T4). Mirror: `isBundleLead`. */
export function isBundleLead(user: User, item: Pick<TierItem, 'tier' | 'ownerUserId' | 'bundleOwnerUserId'>): boolean {
  if (item.tier === 3) return item.ownerUserId === user.id;
  if (item.tier === 4) return item.bundleOwnerUserId === user.id;
  return false;
}

// ---------------------------------------------------------------------------
// TierItem (cây 4 tầng)
// ---------------------------------------------------------------------------

/** Tầng user có thể tạo (khi đã chọn đúng mục cha mình phụ trách). Trưởng phòng thêm tầng 4. */
export function creatableTiers(user: User): TierLevel[] {
  const head: TierLevel[] = isHead(user) ? [4] : [];
  switch (user.role) {
    case 'admin': return [1, 2, 3, 4];
    case 'board': return [1];
    case 'director': return [2, 3, ...head];
    default: return head;
  }
}

/**
 * Được tạo mục con tầng `tier` dưới `parent` không (null với dự án).
 * Mirror: policies.js `task:create`.
 */
export function canCreateUnder(user: User, tier: TierLevel, parent: TierItem | null): boolean {
  if (parent?.archived) return false;
  if (user.role === 'admin') return tier === 1 || !!parent;
  if (tier === 1) return user.role === 'board';
  if (!parent) return false;
  if (tier === 2 || tier === 3) return isProjectLead(user, parent);
  return isBundleLead(user, parent);
}

/**
 * Sửa thông tin mục. Mirror: policies.js `task:edit`.
 * T1: HĐQT, Điều hành phụ trách. T2, T3: Điều hành phụ trách. T4: Trưởng phòng phụ trách, người làm.
 */
export function canEditTierItem(
  user: User | null | undefined,
  item: TierItem | null | undefined
): boolean {
  if (!user || !item) return false;
  if (item.archived) return false; // nhánh lưu trữ là chỉ đọc (server trả 409)
  if (user.role === 'admin') return true;
  if (item.tier === 1 && user.role === 'board') return true;
  if (item.tier <= 3) return isProjectLead(user, item);
  return isBundleLead(user, item) || item.ownerUserId === user.id;
}

/**
 * Đổi người phụ trách. Mirror: policies.js `task:reassign`.
 * T1: HĐQT. T3: Điều hành phụ trách dự án. T4: Trưởng phòng phụ trách hạng mục. T2 đi theo dự án.
 */
export function canReassignTierItem(user: User | null | undefined, item: TierItem | null | undefined): boolean {
  if (!user || !item || item.archived || item.tier === 2) return false;
  if (user.role === 'admin') return true;
  if (item.tier === 1) return user.role === 'board';
  if (item.tier === 3) return isProjectLead(user, item);
  return isBundleLead(user, item);
}

/**
 * Lưu trữ / khôi phục dự án (T1), giai đoạn (T2).
 * Mirror: policies.js `task:archive` (Điều hành phụ trách; HĐQT với dự án).
 */
export function canArchiveTierItem(
  user: User | null | undefined,
  item: TierItem | null | undefined
): boolean {
  if (!user || !item || (item.tier !== 1 && item.tier !== 2)) return false;
  if (user.role === 'admin' || isProjectLead(user, item)) return true;
  return item.tier === 1 && user.role === 'board';
}

/**
 * Thêm / xoá tệp "khi tạo / giao việc". Mirror: policies.js `task:attach`.
 * T1–T3: ai sửa được mục đó. T4: người giao, Trưởng phòng phụ trách.
 * Kết quả của người làm gửi qua Trao đổi.
 */
export function canAttachToTask(
  user: User | null | undefined,
  item: TierItem | null | undefined
): boolean {
  if (!user || !item || item.archived) return false;
  if (item.tier < 4) return canEditTierItem(user, item);
  if (user.role === 'admin') return true;
  if (item.assignedByUserId && item.assignedByUserId === user.id) return true;
  return isBundleLead(user, item);
}

/**
 * Nghiệm thu / đóng mục cha. Mirror: policies.js `task:close`.
 * T3: Trưởng phòng phụ trách hạng mục. T2, T1: Điều hành phụ trách dự án.
 */
export function canAcceptTierItem(
  user: User | null | undefined,
  item: TierItem | null | undefined,
): boolean {
  if (!user || !item || item.tier === 4) return false;
  if (user.role === 'admin') return true;
  if (item.tier === 3) return isBundleLead(user, item);
  return isProjectLead(user, item);
}

// ---------------------------------------------------------------------------
// DailyLog (nhật ký công việc — gắn trực tiếp vào task)
// ---------------------------------------------------------------------------

/**
 * Quyền hiện nút "Ghi nhật ký". Mirror: policies.js `daily_log:create`
 * (admin, người làm, Trưởng phòng phụ trách hạng mục).
 */
export function canAddDailyLog(
  user: User | null | undefined,
  task: TierItem
): boolean {
  if (!user || !task) return false;
  if (user.role === 'admin') return true;
  return task.ownerUserId === user.id || isBundleLead(user, task);
}

// ---------------------------------------------------------------------------
// Đầu việc (giao việc nhóm, việc của tôi)
// ---------------------------------------------------------------------------

/**
 * Duyệt / trả về / gỡ vướng đầu việc. Mirror: policies.js `task:approve`
 * (Trưởng phòng phụ trách hạng mục chứa việc, admin).
 */
export function canApproveTask(
  user: User | null | undefined,
  task: { bundleOwnerUserId?: string }
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!task.bundleOwnerUserId && task.bundleOwnerUserId === user.id;
}

/** Quyền xử lý yêu cầu trợ giúp — alias của canApproveTask (cùng quy tắc). */
export const canResolveHelp = canApproveTask;

// ---------------------------------------------------------------------------
// Báo cáo tuần + trang
// ---------------------------------------------------------------------------

/** Nhân viên (kể cả Trưởng phòng cấp nhân viên) viết báo cáo tuần. Mirror: policies.js `weekly_report:write`. */
export function writesWeeklyReport(user: User | null | undefined): boolean {
  return user?.role === 'employee';
}

/** Các trang chính mỗi vai trò được xem — App dùng để chặn URL không hợp lệ, Header để hiện tab. */
export function visibleTabsFor(user: User | null): ActiveAppTab[] {
  if (!user) return [];
  // Trưởng phòng (mọi cấp bậc): giao việc trong hạng mục mình + việc tự nhận.
  if (user.role === 'admin' || isHead(user)) {
    return ['cay-gantt-4-tang', 'giao-viec-nhom', 'viec-cua-toi', 'bao-cao'];
  }
  switch (user.role) {
    case 'board':
    case 'director':
      // HĐQT, Điều hành: cây công việc toàn hệ thống + báo cáo. Không làm đầu việc.
      return ['cay-gantt-4-tang', 'bao-cao'];
    case 'employee':
    default:
      // Nhân viên xem cây dạng ngữ cảnh chỉ đọc (chuỗi cha của việc mình) + báo cáo tuần của mình.
      return ['viec-cua-toi', 'cay-gantt-4-tang', 'bao-cao'];
  }
}
