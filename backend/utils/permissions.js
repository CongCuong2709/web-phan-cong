/**
 * permissions.js — Backend RBAC. Mirror của src/auth/permissions.ts (frontend).
 *
 * ⚠️ QUAN TRỌNG: Frontend checks chỉ để ẩn UI; backend checks mới là
 * boundary thật. Mọi route handler phải gọi các helper dưới đây trước
 * khi mutate dữ liệu.
 */

import { db } from '../db.js';

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} role        - 'admin' | 'director' | 'manager' | 'employee'
 * @property {string} departments - CSV string from user_departments (e.g. "QLDA,KTTC")
 */

/** Parse departments CSV → array. */
function parseDepartments(csv) {
  if (!csv) return [];
  return csv.split(',').filter(Boolean);
}

/** User thuộc department hay không. Admin (không có dept) = all-access. */
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

/** Kiểm tra user có sửa 1 TierItem cụ thể không. */
export function canEditTierItem(user, item) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'director') return false;
  if (user.role === 'manager') return inDepartment(user, item.department_code);
  // employee: only own T4
  return item.tier === 4 && item.owner_username_str === user.username;
}

/** Tương tự edit cho deliverable. */
export const canEditDeliverable = canEditTierItem;

/** Tạo ID unique. Crypto-randomUUID nếu có, fallback timestamp+random. */
export function uid(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Lấy tier item + check quyền edit trong 1 bước. Return null nếu no perm. */
export function loadTierItemIfEditable(user, itemId) {
  const row = db.prepare(`SELECT t.*, u.username AS owner_username_str
    FROM tier_items t LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.id = ?`).get(itemId);
  if (!row) return { error: 'not_found' };
  if (!canEditTierItem(user, row)) return { error: 'forbidden' };
  return { item: row };
}