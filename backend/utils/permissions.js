/**
 * permissions.js — DEPRECATED SHIM. Dùng `lib/policies.js` thay thế.
 *
 * Toàn bộ luật RBAC đã được hợp nhất vào `lib/policies.js` (nguồn chuẩn duy
 * nhất). File này chỉ còn lại để các import cũ không vỡ ngay lập tức.
 *
 * ⚠️ Không thêm logic mới vào đây. Mọi import mới phải trỏ thẳng về
 * `lib/policies.js`. Xem CHANGELOG.md mục "Hợp nhất RBAC".
 */

import { authorize } from '../lib/policies.js';

export {
  inDepartment,
  canCreateTiers,
  canEditTask,
  canAddDailyLog,
  loadTaskIfEditable,
  uid,
  authorize,
} from '../lib/policies.js';

// Backward-compat aliases (từng là 3 nơi chứa luật riêng, nay trỏ về 1 nguồn).
export { canEditTask as canEditTierItem } from '../lib/policies.js';
export { canEditTask as canEditDeliverable } from '../lib/policies.js';
export { loadTaskIfEditable as loadTierItemIfEditable } from '../lib/policies.js';

/**
 * @deprecated Dùng `authorize('task:approve', user, { task })`.
 * Giữ lại vì chưa có call site nào chuyển sang policy layer.
 *
 * Ở đây KHÔNG viết lại luật — chỉ gọi policy chuẩn để không tạo thêm 1 nơi
 * chứa quy tắc. `task` có thể undefined (guard trước đó cho manager pass).
 */
export function canApproveTask(user, task) {
  if (!user) return false;
  return authorize('task:approve', user, {
    task: task ?? { department_code: null },
  }).ok;
}