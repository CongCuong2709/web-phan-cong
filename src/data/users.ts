/**
 * Seed user store for the 4-Tier Enterprise MVP.
 *
 * The original `createUser(...)` snippet from the user-facing spec is preserved
 * here as a small builder helper so the on-screen demo data reads naturally.
 *
 * NOTE on passwords: this is a frontend-only MVP. Passwords are kept in plain
 * text so the auth flow has no setup barrier; production must replace this with a
 * backend hash (bcrypt/argon2) and an httpOnly session cookie.
 */

import { Department, User } from '../types';

interface CreateUserInput {
  username: string;
  fullname: string;
  email?: string;
  password: string;
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
  password: input.password,
  avatar: input.avatar,
  initial: input.initial ?? input.fullname.charAt(0).toUpperCase(),
});

/**
 * Default avatar seed (no external network required). Deterministic per user.
 */
const initialsAvatar = (initial: string, idx: number): string => {
  // Indigo → violet gradient paired with the role index to give a stable look.
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

/**
 * The seed roster copied from the user-facing spec.
 * The `U` namespace preserves the original variable names so reviewers can
 * recognise the original block 1:1.
 */
function buildSeedUsers(): User[] {
  const U: Record<string, User> = {};

  // Admin hệ thống
  U.admin = createUser({
    username: 'admin',
    fullname: 'Quản trị hệ thống',
    email: 'admin@company.com',
    password: 'admin123',
    role: 'admin',
    departments: ['ĐH', 'QLDA', 'KTTC', 'TC'],
  });

  // ĐH — Ban Điều hành (= BGĐ, tier 1)
  U.khanh = createUser({
    username: 'khanh',
    fullname: 'Khánh — Điều hành',
    password: '123456',
    role: 'director',
    departments: ['ĐH'],
  });
  U.nam = createUser({
    username: 'nam',
    fullname: 'Nam — Điều hành',
    password: '123456',
    role: 'director',
    departments: ['ĐH'],
  });

  // QLDA — Trưởng phòng + Nhân viên
  U.hung = createUser({
    username: 'hung',
    fullname: 'Hùng — TP.QLDA',
    password: '123456',
    role: 'manager',
    departments: ['QLDA'],
  });
  U.hong = createUser({
    username: 'hong',
    fullname: 'Hồng — NV.QLDA',
    password: '123456',
    role: 'employee',
    departments: ['QLDA'],
  });

  // KTTC — Trưởng phòng + 3 Nhân viên
  U.cuong = createUser({
    username: 'cuong',
    fullname: 'Cường — TP.KTTC',
    password: '123456',
    role: 'manager',
    departments: ['KTTC'],
  });
  U.nguyet = createUser({
    username: 'nguyet',
    fullname: 'Nguyệt — NV.KTTC',
    password: '123456',
    role: 'employee',
    departments: ['KTTC'],
  });
  U.hang = createUser({
    username: 'hang',
    fullname: 'Hằng — NV.KTTC',
    password: '123456',
    role: 'employee',
    departments: ['KTTC'],
  });
  U.tu = createUser({
    username: 'tu',
    fullname: 'Tú — NV.KTTC',
    password: '123456',
    role: 'employee',
    departments: ['KTTC'],
  });
  U.nhi = createUser({
    username: 'nhi',
    fullname: 'Nhi — NV.KTTC',
    password: '123456',
    role: 'employee',
    departments: ['KTTC'],
  });

  // TC — Trưởng phòng + Nhân viên
  U.thanh = createUser({
    username: 'thanh',
    fullname: 'Thành — TP.TC',
    password: '123456',
    role: 'manager',
    departments: ['TC'],
  });
  U.ngoc = createUser({
    username: 'ngoc',
    fullname: 'Ngọc — NV.TC',
    password: '123456',
    role: 'employee',
    departments: ['TC'],
  });

  // Inject deterministic initials avatars.
  return Object.values(U).map((u, i) => ({
    ...u,
    avatar: u.avatar ?? initialsAvatar(u.initial ?? u.fullname.charAt(0), i),
  }));
}

export const SEED_USERS: User[] = buildSeedUsers();