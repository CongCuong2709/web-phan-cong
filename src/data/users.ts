/**
 * Placeholder user — dùng làm initial state để tránh UI flash rỗng trong khoảng
 * "đã load /api/users nhưng response chưa về".
 *
 * Thực tế danh sách user thật được fetch từ backend:
 *   - `/api/users` cho admin / manager (xem routes/users.js).
 *   - `user` payload trong login response cho employee (xem AuthContext.tsx).
 *
 * Không lưu danh sách nhân sự thật trong bundle frontend — tránh leak cấu trúc
 * tổ chức qua source và đảm bảo seed data chỉ tồn tại ở DB (backend/scripts/seed.ts).
 */

import type { User } from '../types';

export const PLACEHOLDER_USERS: User[] = [
  {
    id: 'placeholder',
    username: '',
    fullname: 'Đang tải…',
    role: 'employee',
    departments: [],
  },
];

/**
 * @deprecated Dùng PLACEHOLDER_USERS. Giữ export rỗng để tương thích import cũ.
 */
export const SEED_USERS: User[] = PLACEHOLDER_USERS;