/**
 * Seed user store — dùng làm fallback offline khi /api/users chưa phản hồi.
 *
 * ⚠️ SECURITY: File này được bundle vào frontend. KHÔNG đặt password thật ở đây.
 * Password field bị bỏ hoàn toàn — auth thật đã xử lý ở backend (bcrypt + JWT).
 * SEED_USERS chỉ dùng để:
 *  1. Initial state cho `directoryUsers` (tránh flash rỗng khi chờ /api/users)
 *  2. Fallback khi app chạy offline
 *  3. findManagerOf() trong handleAddPersonalTask (employee offline)
 */

import { Department, User } from '../types';

interface CreateUserInput {
  username: string;
  fullname: string;
  email?: string;
  role: User['role'];
  departments: Department[];
  avatar?: string;
  initial?: string;
}

let __userSeq = 1;
const createUser = (input: CreateUserInput): User => ({
  id: `u-${String(__userSeq++).padStart(3, '0')}`,
  username: input.username,
  fullname: input.fullname,
  email: input.email,
  role: input.role,
  departments: input.departments,
  password: '', // không lưu plaintext ở frontend
  avatar: input.avatar,
  initial: input.initial ?? input.fullname.charAt(0).toUpperCase(),
});

/**
 * Default avatar seed (no external network required). Deterministic per user.
 */
const initialsAvatar = (initial: string, idx: number): string => {
  const hue = (idx * 47) % 360;
  const bg = `hsl(${hue} 65% 45%)`;
  const fg = '#ffffff';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
      <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${bg}'/><stop offset='100%' stop-color='hsl(${(hue + 40) % 360} 70% 55%)'/>
      </linearGradient></defs>
      <rect width='64' height='64' rx='32' fill='url(#g)'/>
      <text x='50%' y='54%' text-anchor='middle' font-family='Inter,Arial' font-weight='700'
        font-size='28' fill='${fg}'>${initial}</text>
    </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

function buildSeedUsers(): User[] {
  const U: Record<string, User> = {};

  // Admin hệ thống
  U.admin = createUser({
    username: 'admin',
    fullname: 'Quản trị hệ thống',
    email: 'admin@company.com',
    role: 'admin',
    departments: ['ĐH', 'QLDA', 'KTTC', 'TC'],
  });

  // ĐH — Ban Điều hành
  U.khanh = createUser({ username: 'khanh', fullname: 'Khánh — Điều hành', role: 'director', departments: ['ĐH'] });
  U.nam   = createUser({ username: 'nam',   fullname: 'Nam — Điều hành',   role: 'director', departments: ['ĐH'] });

  // QLDA — Trưởng phòng + Nhân viên
  U.hung = createUser({ username: 'hung', fullname: 'Hùng — TP.QLDA', role: 'manager',  departments: ['QLDA'] });
  U.hong = createUser({ username: 'hong', fullname: 'Hồng — NV.QLDA', role: 'employee', departments: ['QLDA'] });

  // KTTC — Trưởng phòng + 4 Nhân viên
  U.cuong  = createUser({ username: 'cuong',  fullname: 'Cường — TP.KTTC',  role: 'manager',  departments: ['KTTC'] });
  U.nguyet = createUser({ username: 'nguyet', fullname: 'Nguyệt — NV.KTTC', role: 'employee', departments: ['KTTC'] });
  U.hang   = createUser({ username: 'hang',   fullname: 'Hằng — NV.KTTC',   role: 'employee', departments: ['KTTC'] });
  U.tu     = createUser({ username: 'tu',     fullname: 'Tú — NV.KTTC',     role: 'employee', departments: ['KTTC'] });
  U.nhi    = createUser({ username: 'nhi',    fullname: 'Nhi — NV.KTTC',    role: 'employee', departments: ['KTTC'] });

  // TC — Trưởng phòng + Nhân viên
  U.thanh = createUser({ username: 'thanh', fullname: 'Thành — TP.TC', role: 'manager',  departments: ['TC'] });
  U.ngoc  = createUser({ username: 'ngoc',  fullname: 'Ngọc — NV.TC',  role: 'employee', departments: ['TC'] });

  // Inject deterministic initials avatars.
  return Object.values(U).map((u, i) => ({
    ...u,
    avatar: u.avatar ?? initialsAvatar(u.initial ?? u.fullname.charAt(0), i),
  }));
}

export const SEED_USERS: User[] = buildSeedUsers();