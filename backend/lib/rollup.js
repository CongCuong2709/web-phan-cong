/**
 * lib/rollup.js — Cộng dồn tiến độ T4 → T3 → T2 → T1.
 *
 * Tiến độ tầng cha = trung bình cộng tiến độ các con trực tiếp (làm tròn).
 * Trạng thái tầng cha chỉ tự chuyển 'pending' → 'doing' khi đã có con bắt đầu.
 * KHÔNG bao giờ tự sang 'pending_approval' / 'done': đóng hạng mục / giai đoạn /
 * dự án là thao tác nghiệm thu của người có quyền (POST /api/tasks/:tier/:id/approve).
 *
 * Gọi bên trong tx() của caller để cả chuỗi cập nhật là atomic.
 */

import { db } from '../db.js';

const LEVELS = [
  { table: 'bundles', childTable: 'tasks', childFk: 'bundle_id', childProgress: 'progress', parentFk: 'phase_id' },
  { table: 'phases', childTable: 'bundles', childFk: 'phase_id', childProgress: 'progress_rollup', parentFk: 'project_id' },
  { table: 'projects', childTable: 'phases', childFk: 'project_id', childProgress: 'progress_rollup', parentFk: null },
];

/** Tầng bắt đầu cộng dồn theo tier của mục CHA: 3 → bundles, 2 → phases, 1 → projects. */
const LEVEL_OF_TIER = { 3: 0, 2: 1, 1: 2 };

/**
 * Tính lại từ mục cha `parentId` (tier `parentTier`) lên tới dự án.
 * Dùng khi thêm / xoá / đổi tiến độ con của mục đó.
 */
export function rollupFrom(parentTier, parentId) {
  let id = parentId;
  for (let i = LEVEL_OF_TIER[parentTier]; i !== undefined && i < LEVELS.length && id; i++) {
    const L = LEVELS[i];
    db.prepare(`
      UPDATE ${L.table}
      SET progress_rollup = COALESCE(
        (SELECT ROUND(AVG(${L.childProgress})) FROM ${L.childTable} WHERE ${L.childFk} = ?), 0)
      WHERE id = ?
    `).run(id, id);
    db.prepare(`
      UPDATE ${L.table} SET status = 'doing'
      WHERE id = ? AND status = 'pending'
        AND (progress_rollup > 0
             OR EXISTS (SELECT 1 FROM ${L.childTable} WHERE ${L.childFk} = ? AND status <> 'pending'))
    `).run(id, id);
    id = L.parentFk ? db.prepare(`SELECT ${L.parentFk} AS p FROM ${L.table} WHERE id = ?`).get(id)?.p : null;
  }
}

/** Tính lại toàn bộ chuỗi cha của 1 đầu việc T4 (no-op nếu việc không thuộc hạng mục nào). */
export function recomputeRollup(taskId) {
  const row = db.prepare('SELECT bundle_id FROM tasks WHERE id = ?').get(taskId);
  if (row?.bundle_id) rollupFrom(3, row.bundle_id);
}
