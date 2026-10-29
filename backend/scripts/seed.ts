/**
 * seed.ts — Dữ liệu seed: Dự án "Hồ sơ hoàn công dự án 68"
 *
 * Chạy:
 *   npm run seed            → tài khoản + dữ liệu mẫu (2 dự án, nhật ký, báo cáo tuần)
 *   npm run seed:accounts   → CHỈ phòng ban + tài khoản (không dự án, không dữ liệu nghiệp vụ)
 *
 * Cấu trúc:
 *   - 6 phòng: HDQT, DH (Điều hành), QLDA, KTTM (Kế toán - Thu mua), NS (Nhân sự), BCT (Ban công trường)
 *   - 17 tài khoản theo danh sách nhân sự thật + admin
 *   - "Trưởng phòng" là chức vụ trong phòng (user_departments.is_head), không phải cấp bậc:
 *       QLDA → Điều hành Nguyễn Huy Khánh kiêm trưởng ban
 *       KTTM → Nguyễn Cao Cường, NS → Nguyễn Hoài Nam, BCT → Nguyễn Xuân Thành
 *   - Dữ liệu mẫu: "DA-68" do HĐQT Dũng tạo, Điều hành Khánh phụ trách:
 *       7 giai đoạn (Khánh tạo) → hạng mục theo phòng (Khánh tạo, giao Trưởng phòng của phòng)
 *       → 50 đầu việc (Trưởng phòng tạo, cho chính mình hoặc nhân viên cùng phòng);
 *     "DA-69" (Khánh phụ trách): 1 giai đoạn, 1 hạng mục QLDA.
 *   - Trạng thái / tiến độ tầng cha được tính từ đầu việc (như lib/rollup.js), không gán tay.
 */

import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');

// ============================================================================
// DB open
// ============================================================================

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ DB not found at ${DB_PATH}.`);
  console.error('   Chạy "npm run dev" 1 lần trước để bootstrap database + áp dụng schema.');
  process.exit(1);
}

const ACCOUNTS_ONLY = process.argv.includes('--accounts');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

// ============================================================================
// 0. Căn mốc thời gian — dự án "vừa mới bắt đầu 2 ngày"
// ============================================================================
//
// Toàn bộ ngày trong phần dữ liệu bên dưới được viết theo 1 mốc gốc
// (BASE_START) rồi dịch theo 1 hằng số → seed chạy bất cứ ngày nào cũng cho
// ra dự án "vừa bắt đầu".
//
//   PROJECT_STARTED_DAYS_AGO = 2  →  start_date của GĐ1 = hôm nay - 2 ngày.
const BASE_START = '2026-10-10';          // mốc gốc của dữ liệu bên dưới
const PROJECT_STARTED_DAYS_AGO = 2;        // dự án bắt đầu cách hôm nay 2 ngày

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const DESIRED_START = new Date(TODAY);
DESIRED_START.setDate(DESIRED_START.getDate() - PROJECT_STARTED_DAYS_AGO);
const DAY_SHIFT = Math.round(
  (DESIRED_START.getTime() - new Date(`${BASE_START}T00:00:00`).getTime()) / 86_400_000,
);

/** YYYY-MM-DD từ Date (giờ địa phương). */
function toISO(dt: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** Dịch 1 ngày YYYY-MM-DD theo DAY_SHIFT (giữ nguyên khoảng cách giữa các mốc). */
function d(isoStr: string): string {
  const dt = new Date(`${isoStr}T00:00:00`);
  dt.setDate(dt.getDate() + DAY_SHIFT);
  return toISO(dt);
}

/** Dịch ngày rồi kẹp ≤ hôm nay — log ở tương lai là dữ liệu sai. */
function dPast(isoStr: string): string {
  const shifted = d(isoStr);
  const today = toISO(TODAY);
  return shifted > today ? today : shifted;
}

/** Thứ 2 của tuần chứa dt — khoá báo cáo tuần cho demo. */
function weekStartOf(dt: Date): string {
  const x = new Date(dt);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return toISO(x);
}

console.log(`📅 Timeline: dịch ${DAY_SHIFT >= 0 ? '+' : ''}${DAY_SHIFT} ngày → dự án bắt đầu ${toISO(DESIRED_START)} (${PROJECT_STARTED_DAYS_AGO} ngày trước hôm nay)`);

console.log('🗑️  Clearing existing data…');
db.exec(`
  DELETE FROM audit_log;
  DELETE FROM task_attachments;
  DELETE FROM daily_logs;
  DELETE FROM task_help_messages;
  DELETE FROM weekly_reports;
  DELETE FROM tasks;
  DELETE FROM bundles;
  DELETE FROM phases;
  DELETE FROM projects;
  DELETE FROM sessions;
  DELETE FROM user_departments;
  DELETE FROM users;
  DELETE FROM departments;
  DELETE FROM sqlite_sequence;
`);

// ============================================================================
// 1. Departments
// ============================================================================

type Dept = 'HDQT' | 'DH' | 'QLDA' | 'KTTM' | 'NS' | 'BCT';

console.log('📁 Inserting departments…');
const departments: { code: Dept; name: string; sort_order: number }[] = [
  { code: 'HDQT', name: 'Hội đồng quản trị', sort_order: 10 },
  { code: 'DH',   name: 'Ban Điều hành',     sort_order: 20 },
  { code: 'QLDA', name: 'Ban Quản lý dự án', sort_order: 30 },
  { code: 'KTTM', name: 'Kế toán - Thu mua', sort_order: 40 },
  { code: 'NS',   name: 'Nhân sự',           sort_order: 50 },
  { code: 'BCT',  name: 'Ban công trường',   sort_order: 60 },
];
const insertDept = db.prepare(
  'INSERT INTO departments (code, name, sort_order) VALUES (?, ?, ?)'
);
for (const dep of departments) insertDept.run(dep.code, dep.name, dep.sort_order);

// ============================================================================
// 2. Users — `head` = các phòng người đó làm Trưởng phòng
// ============================================================================

console.log('👥 Inserting users…');
const passwordHash = bcrypt.hashSync('123456', 10);
const passwordAdmin = bcrypt.hashSync('admin123', 10);

type SeedUser = {
  username: string;
  fullname: string;
  role: 'admin' | 'board' | 'director' | 'employee';
  title?: string;
  depts: Dept[];
  head?: Dept[];
  /** Mặc định 123456 (admin: admin123). */
  password?: string;
};

const users: SeedUser[] = [
  { username: 'admin',     fullname: 'Quản trị hệ thống', role: 'admin',    depts: ['HDQT', 'DH', 'QLDA', 'KTTM', 'NS', 'BCT'] },
  { username: 'DungDN',    fullname: 'Đoàn Ngọc Dũng',    role: 'board',    title: 'Thành viên', depts: ['HDQT'] },
  { username: 'DungDA',    fullname: 'Đỗ Anh Dũng',       role: 'board',    title: 'Thành viên', depts: ['HDQT'], password: '123457' },
  { username: 'KhanhNH',   fullname: 'Nguyễn Huy Khánh',  role: 'director', depts: ['DH', 'QLDA'], head: ['QLDA'] },
  { username: 'HaLT',      fullname: 'Luyện Thanh Hà',    role: 'employee', depts: ['QLDA'] },
  { username: 'HongNN',    fullname: 'Nguyễn Ngọc Hồng',  role: 'employee', depts: ['QLDA'] },
  { username: 'HungNV',    fullname: 'Nguyễn Văn Hùng',   role: 'employee', depts: ['QLDA'] },
  { username: 'HangNT',    fullname: 'Nguyễn Thị Hằng',   role: 'employee', title: 'Kế toán', depts: ['KTTM'] },
  { username: 'CuongNC',   fullname: 'Nguyễn Cao Cường',  role: 'employee', title: 'Thu mua', depts: ['KTTM'], head: ['KTTM'] },
  { username: 'TuBQ',      fullname: 'Bùi Quang Tú',      role: 'employee', title: 'Thu mua', depts: ['KTTM'] },
  { username: 'NamNH',     fullname: 'Nguyễn Hoài Nam',   role: 'employee', title: 'Nhân sự', depts: ['NS'], head: ['NS'] },
  { username: 'NguyetDTA', fullname: 'Đỗ Thị Ánh Nguyệt', role: 'employee', title: 'HCNS', depts: ['NS'] },
  { username: 'NhiNT',     fullname: 'Nguyễn Thảo Nhi',   role: 'employee', title: 'HCNS', depts: ['NS'] },
  { username: 'ThanhNX',   fullname: 'Nguyễn Xuân Thành', role: 'employee', title: 'Ban chỉ huy', depts: ['BCT'], head: ['BCT'] },
  { username: 'HaiNS',     fullname: 'Nguyễn Sơn Hải',    role: 'employee', title: 'Thủ kho', depts: ['BCT'] },
  { username: 'LongDN',    fullname: 'Đỗ Ngọc Long',      role: 'employee', title: 'Ban chỉ huy công trường', depts: ['BCT'] },
  { username: 'ThaoNV',    fullname: 'Nguyễn Văn Thảo',   role: 'employee', title: 'Ban chỉ huy công trường', depts: ['BCT'] },
  { username: 'NgocVT',    fullname: 'Vũ Thị Ngọc',       role: 'employee', title: 'Kế toán', depts: ['BCT'] },
];

const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, fullname, role, job_title, initial)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertUserDept = db.prepare(`
  INSERT INTO user_departments (user_id, department_code, is_head) VALUES (?, ?, ?)
`);

const userIds: Record<string, number> = {};
for (const u of users) {
  const hash = u.password ? bcrypt.hashSync(u.password, 10)
    : u.username === 'admin' ? passwordAdmin : passwordHash;
  // Chữ cái đầu của tên (từ cuối) — "Nguyễn Huy Khánh" → "K".
  const initial = u.fullname.split(' ').at(-1)!.charAt(0).toUpperCase();
  const info = insertUser.run(u.username, hash, u.fullname, u.role, u.title ?? null, initial);
  const id = Number(info.lastInsertRowid);
  userIds[u.username] = id;
  for (const dep of u.depts) insertUserDept.run(id, dep, u.head?.includes(dep) ? 1 : 0);
}
console.log(`   ✓ ${users.length} users`);

if (ACCOUNTS_ONLY) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();
  console.log('\n✅ Seed tài khoản xong (không tạo dự án).');
  console.log(`   - ${departments.length} phòng, ${users.length} users`);
  console.log('   Mật khẩu: admin / admin123; DungDA / 123457; mọi tài khoản khác / 123456');
  process.exit(0);
}

/** Trưởng phòng của mỗi phòng có hạng mục. */
const deptHead: Partial<Record<Dept, string>> = {};
for (const u of users) for (const h of u.head ?? []) deptHead[h] = u.username;

// ============================================================================
// 3. 7 giai đoạn + 50 đầu việc của DA-68
// ============================================================================
// Mỗi đầu việc gom vào hạng mục (giai đoạn, phòng). owner = Trưởng phòng của phòng
// hoặc nhân viên cùng phòng (kiểm tra ở bước insert).

type WorkItem = {
  code: string;
  title: string;
  dept: 'QLDA' | 'KTTM' | 'NS' | 'BCT';
  owner: string;      // username
  start: string;
  end: string;
  deliverable: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  progress?: number;
  status?: 'pending' | 'doing' | 'done';
};

type Phase = {
  code: string;
  title: string;
  description: string;
  start: string;
  end: string;
  management_notes?: string;
  tasks: WorkItem[];
};

const phases: Phase[] = [
  // ============== GIAI ĐOẠN 1 ==============
  {
    code: 'GD-01',
    title: 'Giai đoạn 1: Thiết kế và hoàn thiện pháp lý xây dựng',
    description: 'Khảo sát, lập nhiệm vụ thiết kế, thiết kế kỹ thuật, thẩm tra và phê duyệt dự toán.',
    start: '2026-10-10', end: '2026-10-13',
    management_notes: 'Phối hợp chặt với đơn vị tư vấn thiết kế; cần Điều hành phê duyệt dự toán trước khi chốt GĐ1.',
    tasks: [
      { code: 'T1-01', title: 'Khảo sát địa chất, địa hình bổ sung (nếu cần)', dept: 'QLDA', owner: 'HaLT',
        start: '2026-10-10', end: '2026-10-11', deliverable: 'Báo cáo khảo sát đã nghiệm thu', priority: 'high' },
      { code: 'T1-02', title: 'Lập nhiệm vụ thiết kế, yêu cầu kỹ thuật, tiêu chuẩn vật liệu và hoàn thiện theo định vị sản phẩm', dept: 'QLDA', owner: 'HongNN',
        start: '2026-10-10', end: '2026-10-11', deliverable: 'Nhiệm vụ thiết kế được duyệt', priority: 'high' },
      { code: 'T1-03', title: 'Thiết kế kỹ thuật / bản vẽ thi công (kiến trúc, kết cấu, MEP, PCCC, hạ tầng)', dept: 'QLDA', owner: 'HungNV',
        start: '2026-10-11', end: '2026-10-12', deliverable: 'Bộ hồ sơ thiết kế', priority: 'critical' },
      { code: 'T1-04', title: 'Thẩm tra thiết kế, dự toán', dept: 'QLDA', owner: 'HaLT',
        start: '2026-10-12', end: '2026-10-13', deliverable: 'Báo cáo thẩm tra', priority: 'high' },
      { code: 'T1-05', title: 'Lập và phê duyệt dự toán, tổng mức đầu tư điều chỉnh (nếu có)', dept: 'QLDA', owner: 'KhanhNH',
        start: '2026-10-12', end: '2026-10-13', deliverable: 'Dự toán được duyệt, làm giá gói thầu', priority: 'critical' },
    ],
  },
  // ============== GIAI ĐOẠN 2 ==============
  {
    code: 'GD-02',
    title: 'Giai đoạn 2: Lựa chọn nhà thầu và ký hợp đồng',
    description: 'Phân chia gói thầu, lập HSMT, tổ chức đấu thầu, nhận bảo lãnh và ký hợp đồng.',
    start: '2026-10-12', end: '2026-10-15',
    management_notes: 'HSMT phải đồng bộ với dự toán đã duyệt ở GĐ1.',
    tasks: [
      { code: 'T2-01', title: 'Lập kế hoạch phân chia gói thầu: phần ngầm, phần thân, hoàn thiện, MEP, thang máy, hạ tầng, cảnh quan, vật tư CĐT cấp', dept: 'QLDA', owner: 'KhanhNH',
        start: '2026-10-12', end: '2026-10-13', deliverable: 'Kế hoạch lựa chọn nhà thầu', priority: 'high' },
      { code: 'T2-02', title: 'Lập hồ sơ mời thầu / yêu cầu báo giá', dept: 'QLDA', owner: 'HongNN',
        start: '2026-10-13', end: '2026-10-14', deliverable: 'HSMT được duyệt', priority: 'high' },
      { code: 'T2-03', title: 'Tổ chức mời thầu, đánh giá hồ sơ dự thầu (kỹ thuật và tài chính)', dept: 'QLDA', owner: 'HungNV',
        start: '2026-10-13', end: '2026-10-14', deliverable: 'Báo cáo đánh giá', priority: 'high' },
      { code: 'T2-04', title: 'Nhận bảo lãnh thực hiện hợp đồng, bảo lãnh tạm ứng', dept: 'KTTM', owner: 'HangNT',
        start: '2026-10-14', end: '2026-10-15', deliverable: 'Bảo lãnh hợp lệ', priority: 'normal' },
      { code: 'T2-05', title: 'Lập kế hoạch mua sắm vật tư, thiết bị do chủ đầu tư cấp', dept: 'KTTM', owner: 'CuongNC',
        start: '2026-10-14', end: '2026-10-15', deliverable: 'Kế hoạch mua sắm và dòng tiền', priority: 'normal' },
    ],
  },
  // ============== GIAI ĐOẠN 3 ==============
  {
    code: 'GD-03',
    title: 'Giai đoạn 3: Chuẩn bị khởi công',
    description: 'Bàn giao mặt bằng, lập ban chỉ huy, phê duyệt biện pháp thi công, an toàn – PCCC, tạm ứng hợp đồng.',
    start: '2026-10-14', end: '2026-10-17',
    management_notes: 'Công trường phải đủ điều kiện khởi công trước khi vào thi công; chú ý bảo hiểm & tạm ứng.',
    tasks: [
      { code: 'T3-01', title: 'Bàn giao mặt bằng, mốc định vị, cao độ cho nhà thầu', dept: 'BCT', owner: 'ThanhNX',
        start: '2026-10-14', end: '2026-10-15', deliverable: 'Biên bản bàn giao mặt bằng', priority: 'critical' },
      { code: 'T3-02', title: 'Thành lập Ban Chỉ huy công trường, quy chế phối hợp CĐT – TVGS – nhà thầu', dept: 'BCT', owner: 'LongDN',
        start: '2026-10-14', end: '2026-10-15', deliverable: 'Sơ đồ tổ chức công trường, quy chế', priority: 'high' },
      { code: 'T3-03', title: 'Phê duyệt biện pháp thi công, tiến độ tổng thể và chi tiết', dept: 'BCT', owner: 'ThanhNX',
        start: '2026-10-15', end: '2026-10-16', deliverable: 'Biện pháp và tiến độ được duyệt', priority: 'critical' },
      { code: 'T3-04', title: 'Kế hoạch an toàn lao động, vệ sinh môi trường, PCCC công trường', dept: 'BCT', owner: 'ThaoNV',
        start: '2026-10-15', end: '2026-10-16', deliverable: 'Kế hoạch ATLĐ – VSMT', priority: 'high' },
      { code: 'T3-05', title: 'Mua bảo hiểm công trình, bảo hiểm con người', dept: 'NS', owner: 'NguyetDTA',
        start: '2026-10-15', end: '2026-10-16', deliverable: 'Hợp đồng bảo hiểm', priority: 'normal' },
      { code: 'T3-06', title: 'Chuẩn bị lán trại, điện nước thi công, hàng rào, biển báo', dept: 'BCT', owner: 'HaiNS',
        start: '2026-10-15', end: '2026-10-16', deliverable: 'Công trường đủ điều kiện', priority: 'normal' },
      { code: 'T3-07', title: 'Lập quy trình quản lý hồ sơ chất lượng, biểu mẫu nghiệm thu', dept: 'QLDA', owner: 'HaLT',
        start: '2026-10-16', end: '2026-10-17', deliverable: 'Bộ biểu mẫu thống nhất', priority: 'normal' },
      { code: 'T3-08', title: 'Tạm ứng hợp đồng', dept: 'KTTM', owner: 'HangNT',
        start: '2026-10-16', end: '2026-10-17', deliverable: 'Chứng từ tạm ứng', priority: 'normal' },
    ],
  },
  // ============== GIAI ĐOẠN 4 ==============
  {
    code: 'GD-04',
    title: 'Giai đoạn 4: Thi công xây dựng',
    description: 'Kiểm soát vật liệu, nghiệm thu, quản lý tiến độ – an toàn – chất lượng – tài chính trong suốt quá trình thi công.',
    start: '2026-10-16', end: '2026-10-21',
    management_notes: 'Giai đoạn dài nhất, nhiều đầu việc song song — cần giao ban công trường hằng ngày.',
    tasks: [
      { code: 'T4-01', title: 'Kiểm soát vật liệu đầu vào: phê duyệt mẫu, chứng chỉ, thí nghiệm', dept: 'BCT', owner: 'HaiNS',
        start: '2026-10-16', end: '2026-10-17', deliverable: 'Biên bản duyệt mẫu, kết quả thí nghiệm', priority: 'high' },
      { code: 'T4-02', title: 'Nghiệm thu công việc, bộ phận, giai đoạn (cốt thép, cốp pha, bê tông, xây tô...)', dept: 'BCT', owner: 'ThanhNX',
        start: '2026-10-17', end: '2026-10-19', deliverable: 'Biên bản nghiệm thu', priority: 'critical' },
      { code: 'T4-03', title: 'Quản lý tiến độ: báo cáo ngày, tuần, tháng; cảnh báo chậm trễ', dept: 'BCT', owner: 'LongDN',
        start: '2026-10-17', end: '2026-10-21', deliverable: 'Báo cáo tiến độ', priority: 'high' },
      { code: 'T4-04', title: 'Giao ban công trường định kỳ', dept: 'BCT', owner: 'ThanhNX',
        start: '2026-10-17', end: '2026-10-21', deliverable: 'Biên bản giao ban', priority: 'normal' },
      { code: 'T4-05', title: 'Quản lý thay đổi thiết kế, phát sinh khối lượng', dept: 'QLDA', owner: 'HungNV',
        start: '2026-10-18', end: '2026-10-19', deliverable: 'Phụ lục hợp đồng, phê duyệt phát sinh', priority: 'high' },
      { code: 'T4-06', title: 'Giám sát an toàn lao động, môi trường, PCCC', dept: 'BCT', owner: 'ThaoNV',
        start: '2026-10-17', end: '2026-10-21', deliverable: 'Nhật ký an toàn, biên bản xử lý vi phạm', priority: 'high' },
      { code: 'T4-07', title: 'Quản lý giao nhận vật tư CĐT cấp, đối chiếu tồn kho', dept: 'BCT', owner: 'HaiNS',
        start: '2026-10-18', end: '2026-10-19', deliverable: 'Phiếu nhập xuất, biên bản đối chiếu', priority: 'normal' },
      { code: 'T4-08', title: 'Quản lý nhân công khoán (nếu có): chấm công, xác nhận khối lượng', dept: 'BCT', owner: 'NgocVT',
        start: '2026-10-18', end: '2026-10-19', deliverable: 'Bảng khối lượng, chấm công', priority: 'normal' },
      { code: 'T4-09', title: 'Cập nhật nhật ký thi công, bản vẽ hoàn công từng phần', dept: 'BCT', owner: 'LongDN',
        start: '2026-10-18', end: '2026-10-20', deliverable: 'Nhật ký, bản vẽ hoàn công từng phần', priority: 'high' },
      { code: 'T4-10', title: 'Nghiệm thu khối lượng hoàn thành theo đợt', dept: 'BCT', owner: 'ThaoNV',
        start: '2026-10-19', end: '2026-10-20', deliverable: 'Bảng xác nhận khối lượng', priority: 'high' },
      { code: 'T4-11', title: 'Thanh toán theo đợt, thu hồi tạm ứng, giữ lại tiền bảo hành', dept: 'KTTM', owner: 'HangNT',
        start: '2026-10-20', end: '2026-10-21', deliverable: 'Hồ sơ thanh toán đợt', priority: 'high' },
      { code: 'T4-12', title: 'Báo cáo tài chính dự án: kế hoạch và thực tế dòng tiền', dept: 'KTTM', owner: 'CuongNC',
        start: '2026-10-20', end: '2026-10-21', deliverable: 'Báo cáo dòng tiền', priority: 'normal' },
    ],
  },
  // ============== GIAI ĐOẠN 5 ==============
  {
    code: 'GD-05',
    title: 'Giai đoạn 5: Nghiệm thu hoàn thành và hoàn công',
    description: 'Chạy thử hệ thống, kiểm định thiết bị, lập bản vẽ hoàn công, đấu nối hạ tầng, nghiệm thu đưa vào sử dụng.',
    start: '2026-10-21', end: '2026-10-24',
    management_notes: 'Đảm bảo bộ hồ sơ hoàn công đầy đủ trước khi đưa công trình vào sử dụng.',
    tasks: [
      { code: 'T5-01', title: 'Chạy thử đơn động, liên động hệ thống MEP, thang máy, PCCC', dept: 'BCT', owner: 'ThanhNX',
        start: '2026-10-21', end: '2026-10-22', deliverable: 'Biên bản chạy thử', priority: 'critical' },
      { code: 'T5-02', title: 'Kiểm định thiết bị có yêu cầu nghiêm ngặt về an toàn (thang máy, bình áp lực...)', dept: 'BCT', owner: 'ThaoNV',
        start: '2026-10-21', end: '2026-10-22', deliverable: 'Giấy chứng nhận kiểm định', priority: 'critical' },
      { code: 'T5-03', title: 'Lập bản vẽ hoàn công tổng thể', dept: 'BCT', owner: 'LongDN',
        start: '2026-10-22', end: '2026-10-23', deliverable: 'Bộ bản vẽ hoàn công', priority: 'high' },
      { code: 'T5-04', title: 'Tập hợp hồ sơ chất lượng công trình', dept: 'QLDA', owner: 'HongNN',
        start: '2026-10-22', end: '2026-10-23', deliverable: 'Hồ sơ hoàn thành công trình', priority: 'high' },
      { code: 'T5-05', title: 'Đấu nối hạ tầng: điện, nước, thoát nước, viễn thông', dept: 'BCT', owner: 'HaiNS',
        start: '2026-10-23', end: '2026-10-24', deliverable: 'Hợp đồng và biên bản đấu nối', priority: 'high' },
      { code: 'T5-06', title: 'Nghiệm thu hoàn thành hạng mục hoặc công trình đưa vào sử dụng', dept: 'QLDA', owner: 'KhanhNH',
        start: '2026-10-23', end: '2026-10-24', deliverable: 'Biên bản nghiệm thu hoàn thành', priority: 'critical' },
    ],
  },
  // ============== GIAI ĐOẠN 6 ==============
  {
    code: 'GD-06',
    title: 'Giai đoạn 6: Bàn giao',
    description: 'Kiểm tra hoàn thiện từng sản phẩm, lập quy trình bảo trì, bàn giao hồ sơ và công trình cho đơn vị vận hành.',
    start: '2026-10-24', end: '2026-10-27',
    management_notes: 'Phối hợp chặt với đơn vị quản lý vận hành để đào tạo và bàn giao đúng hạn.',
    tasks: [
      { code: 'T6-01', title: 'Kiểm tra hoàn thiện từng căn/sản phẩm, lập danh sách lỗi và khắc phục', dept: 'BCT', owner: 'ThaoNV',
        start: '2026-10-24', end: '2026-10-25', deliverable: 'Checklist bàn giao từng căn', priority: 'high' },
      { code: 'T6-02', title: 'Lập quy trình bảo trì công trình', dept: 'QLDA', owner: 'HungNV',
        start: '2026-10-24', end: '2026-10-25', deliverable: 'Quy trình bảo trì được duyệt', priority: 'normal' },
      { code: 'T6-03', title: 'Bàn giao hồ sơ, tài liệu kỹ thuật cho đơn vị quản lý vận hành', dept: 'QLDA', owner: 'HongNN',
        start: '2026-10-25', end: '2026-10-26', deliverable: 'Biên bản bàn giao hồ sơ', priority: 'high' },
      { code: 'T6-04', title: 'Bàn giao công trình, thiết bị cho đơn vị quản lý vận hành, đào tạo vận hành', dept: 'BCT', owner: 'ThanhNX',
        start: '2026-10-25', end: '2026-10-26', deliverable: 'Biên bản bàn giao', priority: 'critical' },
      { code: 'T6-05', title: 'Thu tiền đợt cuối, kinh phí bảo trì (nếu có) theo hợp đồng mua bán', dept: 'KTTM', owner: 'HangNT',
        start: '2026-10-26', end: '2026-10-27', deliverable: 'Chứng từ thu', priority: 'normal' },
      { code: 'T6-06', title: 'Theo dõi, xử lý bảo hành trong thời gian bảo hành', dept: 'BCT', owner: 'LongDN',
        start: '2026-10-26', end: '2026-10-27', deliverable: 'Sổ theo dõi bảo hành', priority: 'normal' },
    ],
  },
  // ============== GIAI ĐOẠN 7 ==============
  {
    code: 'GD-07',
    title: 'Giai đoạn 7: Thanh quyết toán',
    description: 'Tổng hợp khối lượng, đối chiếu phát sinh, thẩm tra quyết toán, thanh toán phần còn lại, hoàn trả bảo hành, quyết toán thuế và lưu trữ hồ sơ.',
    start: '2026-10-26', end: '2026-10-29',
    management_notes: 'Đóng dự án đúng hạn; đối chiếu chặt với kế toán để tránh sai sót thuế.',
    tasks: [
      { code: 'T7-01', title: 'Tổng hợp khối lượng hoàn thành theo hoàn công từng gói thầu', dept: 'QLDA', owner: 'HaLT',
        start: '2026-10-26', end: '2026-10-27', deliverable: 'Bảng khối lượng quyết toán', priority: 'high' },
      { code: 'T7-02', title: 'Đối chiếu phát sinh, phụ lục, khấu trừ (vật tư CĐT cấp, điện nước, phạt vi phạm)', dept: 'KTTM', owner: 'CuongNC',
        start: '2026-10-27', end: '2026-10-28', deliverable: 'Biên bản đối chiếu', priority: 'high' },
      { code: 'T7-03', title: 'Thẩm tra quyết toán hợp đồng (nội bộ hoặc thuê kiểm toán)', dept: 'KTTM', owner: 'HangNT',
        start: '2026-10-27', end: '2026-10-28', deliverable: 'Báo cáo thẩm tra', priority: 'high' },
      { code: 'T7-04', title: 'Thanh toán phần còn lại cho nhà cung cấp, giữ bảo hành hoặc nhận bảo lãnh bảo hành', dept: 'KTTM', owner: 'TuBQ',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Chứng từ thanh toán', priority: 'normal' },
      { code: 'T7-05', title: 'Hoàn trả tiền bảo hành, giải tỏa bảo lãnh khi hết hạn', dept: 'KTTM', owner: 'HangNT',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Chứng từ hoàn trả', priority: 'normal' },
      { code: 'T7-06', title: 'Quyết toán tổng chi phí đầu tư dự án', dept: 'KTTM', owner: 'CuongNC',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Báo cáo quyết toán dự án', priority: 'critical' },
      { code: 'T7-07', title: 'Lưu trữ hồ sơ nhân sự, hợp đồng lao động liên quan dự án', dept: 'NS', owner: 'NhiNT',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Hồ sơ nhân sự dự án', priority: 'normal' },
      { code: 'T7-08', title: 'Lưu trữ hồ sơ dự án', dept: 'QLDA', owner: 'HongNN',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Kho hồ sơ số hóa', priority: 'normal' },
    ],
  },
];

// ============================================================================
// 4. Insert project + phases + bundles + tasks
// ============================================================================

console.log('📊 Inserting project hierarchy…');

const insertProject = db.prepare(`
  INSERT INTO projects (code, title, description, owner_user_id, created_by_user_id,
    start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertPhase = db.prepare(`
  INSERT INTO phases (project_id, code, title, description, owner_user_id, created_by_user_id,
    start_date, end_date, status, management_notes, blocker_alert)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertBundle = db.prepare(`
  INSERT INTO bundles (phase_id, code, title, description, owner_user_id, created_by_user_id,
    department_code, start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertTask = db.prepare(`
  INSERT INTO tasks (bundle_id, code, title, description,
    owner_user_id, created_by_user_id, assigned_by_user_id, department_code,
    start_date, end_date, progress, status, priority, is_today, is_today_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
`);

const insertedTasks: { id: number; code: string; title: string }[] = [];

/** Đầu việc phải giao cho Trưởng phòng phụ trách hạng mục hoặc nhân viên cùng phòng. */
function checkOwner(code: string, owner: string, bundleOwner: string, dept: Dept) {
  const u = users.find((x) => x.username === owner);
  if (!u) throw new Error(`${code}: không có user ${owner}.`);
  if (owner !== bundleOwner && !(u.role === 'employee' && u.depts.includes(dept))) {
    throw new Error(`${code}: ${owner} không làm được đầu việc của hạng mục phòng ${dept}.`);
  }
}

const projectId = Number(insertProject.run(
  'DA-68',
  'Hồ sơ hoàn công dự án 68',
  'Dự án trọng điểm khối 68: từ thiết kế & pháp lý → lựa chọn nhà thầu → chuẩn bị khởi công → thi công → nghiệm thu hoàn công → bàn giao → thanh quyết toán.',
  userIds['KhanhNH'],  // Điều hành phụ trách
  userIds['DungDN'],   // HĐQT tạo
  d('2026-10-10'),
  d('2026-10-29'),
  'pending',
).lastInsertRowid);

// Tên hạng mục theo (giai đoạn, phòng).
const bundleNames: Record<string, { title: string; description: string }> = {
  'GD-01|QLDA': {
    title: 'Hồ sơ thiết kế & dự toán',
    description: 'Khảo sát địa chất/địa hình, lập nhiệm vụ thiết kế, bản vẽ thi công (kiến trúc, kết cấu, MEP, PCCC, hạ tầng), thẩm tra và phê duyệt dự toán/tổng mức đầu tư.',
  },
  'GD-02|QLDA': {
    title: 'Hồ sơ mời thầu & lựa chọn nhà thầu',
    description: 'Phân chia gói thầu, lập HSMT/yêu cầu báo giá, đánh giá HSDT (kỹ thuật + tài chính).',
  },
  'GD-02|KTTM': {
    title: 'Bảo lãnh & kế hoạch mua sắm',
    description: 'Tiếp nhận bảo lãnh thực hiện hợp đồng, bảo lãnh tạm ứng; lập kế hoạch mua sắm vật tư, thiết bị CĐT cấp.',
  },
  'GD-03|BCT': {
    title: 'Mặt bằng & tổ chức công trường',
    description: 'Bàn giao mặt bằng/mốc định vị, lập Ban Chỉ huy công trường, phê duyệt biện pháp thi công, kế hoạch ATLĐ–VSMT–PCCC và chuẩn bị lán trại/hàng rào/biển báo.',
  },
  'GD-03|KTTM': {
    title: 'Tạm ứng hợp đồng',
    description: 'Thực hiện tạm ứng hợp đồng cho nhà thầu theo bảo lãnh đã nhận.',
  },
  'GD-03|NS': {
    title: 'Bảo hiểm công trình & con người',
    description: 'Mua bảo hiểm công trình và bảo hiểm cho người lao động trên công trường.',
  },
  'GD-03|QLDA': {
    title: 'Quy trình quản lý chất lượng',
    description: 'Lập quy trình quản lý hồ sơ chất lượng và bộ biểu mẫu nghiệm thu thống nhất toàn dự án.',
  },
  'GD-04|BCT': {
    title: 'Giám sát thi công tại công trường',
    description: 'Kiểm soát vật liệu đầu vào, nghiệm thu công việc/bộ phận/giai đoạn, quản lý tiến độ, an toàn PCCC, giao ban, nhật ký thi công và quản lý nhân công khoán.',
  },
  'GD-04|QLDA': {
    title: 'Quản lý thay đổi thiết kế',
    description: 'Xử lý thay đổi thiết kế, phát sinh khối lượng và phê duyệt phụ lục hợp đồng trong quá trình thi công.',
  },
  'GD-04|KTTM': {
    title: 'Thanh toán & báo cáo tài chính',
    description: 'Thanh toán theo đợt, thu hồi tạm ứng, giữ lại tiền bảo hành và báo cáo dòng tiền dự án (kế hoạch vs thực tế).',
  },
  'GD-05|BCT': {
    title: 'Chạy thử, hoàn công & đấu nối hạ tầng',
    description: 'Chạy thử đơn động/liên động MEP–thang máy–PCCC, kiểm định thiết bị an toàn, lập bản vẽ hoàn công tổng thể và đấu nối hạ tầng điện–nước–thoát nước–viễn thông.',
  },
  'GD-05|QLDA': {
    title: 'Hồ sơ chất lượng & nghiệm thu',
    description: 'Tập hợp hồ sơ chất lượng và biên bản nghiệm thu hoàn thành đưa vào sử dụng.',
  },
  'GD-06|BCT': {
    title: 'Bàn giao & bảo hành công trình',
    description: 'Kiểm tra hoàn thiện từng căn/sản phẩm, bàn giao công trình + thiết bị cho đơn vị vận hành, đào tạo vận hành và theo dõi bảo hành.',
  },
  'GD-06|QLDA': {
    title: 'Hồ sơ kỹ thuật & quy trình bảo trì',
    description: 'Bàn giao hồ sơ/tài liệu kỹ thuật cho đơn vị quản lý vận hành và lập quy trình bảo trì công trình.',
  },
  'GD-06|KTTM': {
    title: 'Thu tiền & kinh phí bảo trì',
    description: 'Thu tiền đợt cuối và kinh phí bảo trì (nếu có) theo hợp đồng mua bán.',
  },
  'GD-07|QLDA': {
    title: 'Tổng hợp khối lượng & lưu trữ hồ sơ',
    description: 'Tổng hợp khối lượng hoàn thành theo hoàn công từng gói thầu và số hóa/lưu trữ toàn bộ hồ sơ dự án.',
  },
  'GD-07|KTTM': {
    title: 'Quyết toán & thanh toán còn lại',
    description: 'Đối chiếu phát sinh/phụ lục/khấu trừ, thẩm tra quyết toán, thanh toán phần còn lại, hoàn trả bảo hành và quyết toán tổng chi phí đầu tư.',
  },
  'GD-07|NS': {
    title: 'Hồ sơ nhân sự dự án',
    description: 'Lưu trữ hồ sơ nhân sự, hợp đồng lao động liên quan dự án.',
  },
};

for (const p of phases) {
  const phaseId = Number(insertPhase.run(
    projectId,
    p.code,
    p.title,
    p.description,
    userIds['KhanhNH'],  // giai đoạn luôn do Điều hành phụ trách dự án quản lý
    userIds['KhanhNH'],
    d(p.start),
    d(p.end),
    'pending',
    p.management_notes ?? '',
    null,
  ).lastInsertRowid);

  // Mỗi phòng 1 hạng mục trong giai đoạn.
  const tasksByDept = new Map<WorkItem['dept'], WorkItem[]>();
  for (const t of p.tasks) {
    if (!tasksByDept.has(t.dept)) tasksByDept.set(t.dept, []);
    tasksByDept.get(t.dept)!.push(t);
  }

  for (const [dept, deptTaskList] of tasksByDept) {
    const bundleOwner = deptHead[dept]!;
    const nameInfo = bundleNames[`${p.code}|${dept}`];
    if (!nameInfo) throw new Error(`Thiếu tên hạng mục ${p.code}|${dept}.`);

    const bundleId = Number(insertBundle.run(
      phaseId,
      `${p.code}-${dept}`,
      nameInfo.title,
      nameInfo.description,
      userIds[bundleOwner],        // Trưởng phòng của phòng
      userIds['KhanhNH'],          // Điều hành phụ trách dự án tạo hạng mục
      dept,
      d(deptTaskList.map((t) => t.start).sort()[0]),
      d(deptTaskList.map((t) => t.end).sort().at(-1)!),
      'pending',
    ).lastInsertRowid);

    for (const t of deptTaskList) {
      checkOwner(t.code, t.owner, bundleOwner, dept);
      const info = insertTask.run(
        bundleId,
        t.code,
        t.title,
        `Kết quả đầu ra: ${t.deliverable}`,
        userIds[t.owner],
        userIds[bundleOwner],      // Trưởng phòng tạo
        userIds[bundleOwner],      // và giao
        dept,
        d(t.start),
        d(t.end),
        t.progress ?? 0,
        t.status ?? 'pending',
        t.priority ?? 'normal',
      );
      insertedTasks.push({ id: Number(info.lastInsertRowid), code: t.code, title: t.title });
    }
  }
}

// Dự án thứ 2: HĐQT Đỗ Anh Dũng tạo, Điều hành Khánh phụ trách — mới lập 1 giai đoạn, 1 hạng mục QLDA.
const project2Id = Number(insertProject.run(
  'DA-69',
  'Cải tạo văn phòng trụ sở',
  'Cải tạo tầng 3–5 trụ sở chính: thiết kế lại mặt bằng làm việc, hệ thống điện nhẹ và PCCC.',
  userIds['KhanhNH'],
  userIds['DungDA'],
  d('2026-10-20'),
  d('2026-12-31'),
  'pending',
).lastInsertRowid);
const phase2Id = Number(insertPhase.run(
  project2Id, 'GD-01', 'Giai đoạn 1: Khảo sát và thiết kế',
  'Khảo sát hiện trạng, lập phương án mặt bằng và dự toán sơ bộ.',
  userIds['KhanhNH'], userIds['KhanhNH'],
  d('2026-10-20'), d('2026-11-15'), 'pending', '', null,
).lastInsertRowid);
const bundle2Id = Number(insertBundle.run(
  phase2Id, 'GD-01-QLDA', 'Khảo sát hiện trạng & phương án mặt bằng',
  'Đo vẽ hiện trạng tầng 3–5, đề xuất phương án bố trí mặt bằng làm việc.',
  userIds[deptHead.QLDA!], userIds['KhanhNH'], 'QLDA',
  d('2026-10-20'), d('2026-11-05'), 'pending',
).lastInsertRowid);
const da69Tasks: WorkItem[] = [
  { code: 'K1-01', title: 'Đo vẽ hiện trạng tầng 3–5', dept: 'QLDA', owner: 'HaLT',
    start: '2026-10-20', end: '2026-10-27', deliverable: 'Bản vẽ hiện trạng', priority: 'normal' },
  { code: 'K1-02', title: 'Đề xuất 2 phương án mặt bằng làm việc', dept: 'QLDA', owner: 'HungNV',
    start: '2026-10-27', end: '2026-11-05', deliverable: 'Hồ sơ phương án', priority: 'normal' },
];
for (const t of da69Tasks) {
  checkOwner(t.code, t.owner, deptHead.QLDA!, 'QLDA');
  const info = insertTask.run(
    bundle2Id, t.code, t.title, `Kết quả đầu ra: ${t.deliverable}`,
    userIds[t.owner], userIds[deptHead.QLDA!], userIds[deptHead.QLDA!], 'QLDA',
    d(t.start), d(t.end), 0, 'pending', t.priority ?? 'normal',
  );
  insertedTasks.push({ id: Number(info.lastInsertRowid), code: t.code, title: t.title });
}

// Ngày của mục con phải nằm trong mục cha (cùng luật với routes/tasks.js).
const outOfRange = db.prepare(`
  SELECT 'giai đoạn ' || ph.code AS what FROM phases ph JOIN projects p ON p.id = ph.project_id
   WHERE ph.start_date < p.start_date OR ph.end_date > p.end_date
  UNION ALL
  SELECT 'hạng mục ' || b.code FROM bundles b JOIN phases ph ON ph.id = b.phase_id
   WHERE b.start_date < ph.start_date OR b.end_date > ph.end_date
  UNION ALL
  SELECT 'đầu việc ' || t.code FROM tasks t JOIN bundles b ON b.id = t.bundle_id
   WHERE t.start_date < b.start_date OR t.end_date > b.end_date
`).all() as { what: string }[];
if (outOfRange.length) {
  throw new Error(`Ngày nằm ngoài mục cha: ${outOfRange.map((r) => r.what).join(', ')}`);
}

const taskCount = insertedTasks.length;
const totalBundles = (db.prepare('SELECT COUNT(*) AS c FROM bundles').get() as { c: number }).c;
console.log(`   ✓ 2 projects → ${phases.length + 1} phases → ${totalBundles} bundles → ${taskCount} tasks`);

// ============================================================================
// 5. Nhật ký, vướng mắc, lịch sử demo
// ============================================================================

function findTaskByCode(code: string): number {
  const id = insertedTasks.find((t) => t.code === code)?.id;
  if (!id) throw new Error(`Không thấy đầu việc ${code}.`);
  return id;
}

console.log('📝 Inserting daily logs (demo)…');
const insertLog = db.prepare(`
  INSERT INTO daily_logs (task_id, log_date, description, result, obstacle, progress, author_user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
insertLog.run(
  findTaskByCode('T1-03'), dPast('2026-10-11'),
  'Triển khai bản vẽ kiến trúc tầng 1-3, phối hợp MEP',
  'Hoàn tất 60% bản vẽ kiến trúc, MEP còn chờ phản hồi tư vấn PCCC',
  'Đơn vị tư vấn PCCC phản hồi chậm 1 ngày',
  60, userIds['HungNV'],
);
insertLog.run(
  findTaskByCode('T1-05'), dPast('2026-10-12'),
  'Tổng hợp dự toán các gói thầu',
  'Đã tổng hợp 7 gói thầu, đang rà soát đơn giá',
  '',
  40, userIds['KhanhNH'],
);
insertLog.run(
  findTaskByCode('T4-02'), dPast('2026-10-17'),
  'Nghiệm thu cốt thép móng đơn, cốp pha cột tầng 1',
  'Đạt yêu cầu, đã lập biên bản',
  '',
  30, userIds['ThanhNX'],
);

// Đầu việc đã có nhật ký → Đang làm, tiến độ = nhật ký mới nhất (như POST /api/daily-logs).
db.exec(`
  UPDATE tasks SET status = 'doing',
    progress = (SELECT l.progress FROM daily_logs l WHERE l.task_id = tasks.id ORDER BY l.log_date DESC LIMIT 1)
  WHERE id IN (SELECT task_id FROM daily_logs);
`);

// Tầng cha: tiến độ = trung bình con trực tiếp; 'pending' → 'doing' khi có con đã bắt đầu
// (cùng luật với lib/rollup.js).
db.exec(`
  UPDATE bundles SET
    progress_rollup = COALESCE((SELECT ROUND(AVG(progress)) FROM tasks WHERE bundle_id = bundles.id), 0),
    status = CASE WHEN EXISTS (SELECT 1 FROM tasks WHERE bundle_id = bundles.id AND status <> 'pending')
                  THEN 'doing' ELSE 'pending' END;
  UPDATE phases SET
    progress_rollup = COALESCE((SELECT ROUND(AVG(progress_rollup)) FROM bundles WHERE phase_id = phases.id), 0),
    status = CASE WHEN EXISTS (SELECT 1 FROM bundles WHERE phase_id = phases.id AND status <> 'pending')
                  THEN 'doing' ELSE 'pending' END;
  UPDATE projects SET
    progress_rollup = COALESCE((SELECT ROUND(AVG(progress_rollup)) FROM phases WHERE project_id = projects.id), 0),
    status = CASE WHEN EXISTS (SELECT 1 FROM phases WHERE project_id = projects.id AND status <> 'pending')
                  THEN 'doing' ELSE 'pending' END;
`);

// Vướng mắc trên T2-04 (bảo lãnh): Hằng báo, trưởng phòng Cường trao đổi lại.
console.log('💬 Inserting demo blocker on T2-04…');
const t2_04 = findTaskByCode('T2-04');
const blocker = 'Cần Điều hành xác nhận ngân hàng bảo lãnh trước khi phát hành thư bảo lãnh.';
db.prepare('UPDATE tasks SET blocker_note = ? WHERE id = ?').run(blocker, t2_04);
const insertMessage = db.prepare(`
  INSERT INTO task_help_messages (task_id, body, author_user_id, kind) VALUES (?, ?, ?, ?)
`);
insertMessage.run(t2_04, blocker, userIds['HangNT'], 'blocker');
insertMessage.run(t2_04, 'Đã gửi anh Khánh, chờ xác nhận trong hôm nay.', userIds['CuongNC'], 'note');

console.log('📜 Inserting audit log demo…');
const insertAudit = db.prepare(`
  INSERT INTO audit_log (entity_type, entity_id, action, new_values, actor_user_id, actor_username, actor_ip)
  VALUES (?, ?, 'create', ?, ?, ?, '127.0.0.1')
`);
insertAudit.run('project', projectId, JSON.stringify({ code: 'DA-68', title: 'Hồ sơ hoàn công dự án 68' }), userIds['DungDN'], 'DungDN');
const firstPhase = db.prepare('SELECT id FROM phases WHERE project_id = ? AND code = ?').get(projectId, 'GD-01') as { id: number };
insertAudit.run('phase', firstPhase.id, JSON.stringify({ code: 'GD-01', title: phases[0].title }), userIds['KhanhNH'], 'KhanhNH');
insertAudit.run('task', findTaskByCode('T1-03'), JSON.stringify({ code: 'T1-03', title: 'Thiết kế kỹ thuật / bản vẽ thi công' }), userIds['KhanhNH'], 'KhanhNH');

// ============================================================================
// 6. Báo cáo tuần demo (tuần hiện tại)
// ============================================================================
// Nhân viên và Trưởng phòng cấp nhân viên viết; Điều hành (kể cả Khánh kiêm
// trưởng Ban QLDA) không viết. Không có bước duyệt.

console.log('📋 Inserting weekly report demo…');
const thisWeek = weekStartOf(TODAY);
const thisWeekEnd = (() => {
  const x = new Date(`${thisWeek}T00:00:00`);
  x.setDate(x.getDate() + 6);
  return toISO(x);
})();

const insertWeeklyReport = db.prepare(`
  INSERT INTO weekly_reports (user_id, week_start, week_end, rows_json, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
`);

const weeklyDemo: Array<{ who: string; rows: unknown[] }> = [
  {
    who: 'HongNN',
    rows: [
      { id: 'w1', name: 'Lập nhiệm vụ thiết kế', result: 'Dự thảo nhiệm vụ thiết kế đã xong 80%, chờ rà soát nội bộ.', status: 'Đang làm', blocker: '' },
      { id: 'w2', name: 'Lập hồ sơ mời thầu', result: 'Chưa bắt đầu — chờ dự toán được duyệt.', status: 'Chưa bắt đầu', blocker: 'Cần dự toán được duyệt trước khi lập HSMT.' },
    ],
  },
  {
    who: 'HungNV',
    rows: [
      { id: 'w1', name: 'Thiết kế kỹ thuật / bản vẽ thi công', result: 'Kiến trúc xong 60%, MEP chờ tư vấn PCCC.', status: 'Đang làm', blocker: '' },
    ],
  },
  {
    who: 'CuongNC',
    rows: [
      { id: 'w1', name: 'Kế hoạch mua sắm vật tư CĐT cấp', result: 'Đã lấy báo giá 3 nhà cung cấp thép, xi măng.', status: 'Đang làm', blocker: '' },
      { id: 'w2', name: 'Theo dõi bảo lãnh nhà thầu', result: 'Chờ Điều hành xác nhận ngân hàng bảo lãnh.', status: 'Vướng mắc', blocker: 'Cần xác nhận ngân hàng bảo lãnh.' },
    ],
  },
  {
    who: 'LongDN',
    rows: [
      { id: 'w1', name: 'Thành lập Ban Chỉ huy công trường', result: 'Đã dự thảo sơ đồ tổ chức, chờ anh Thành duyệt.', status: 'Đang làm', blocker: '' },
    ],
  },
];

for (const w of weeklyDemo) {
  insertWeeklyReport.run(userIds[w.who], thisWeek, thisWeekEnd, JSON.stringify(w.rows));
}

// ============================================================================
// Summary
// ============================================================================

db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();

console.log('\n✅ Seed complete!');
console.log(`   - Timeline: ${toISO(DESIRED_START)} → ${d('2026-10-29')} (dự án mới bắt đầu ${PROJECT_STARTED_DAYS_AGO} ngày)`);
console.log(`   - ${departments.length} phòng, ${users.length} users`);
console.log(`   - "DA-68" (Điều hành KhanhNH) → 7 giai đoạn → hạng mục theo phòng (QLDA/KTTM/NS/BCT)`);
console.log('   - "DA-69" (Điều hành KhanhNH) → 1 giai đoạn → 1 hạng mục QLDA');
console.log(`   - ${weeklyDemo.length} báo cáo tuần (tuần ${thisWeek})`);
console.log('\n   Mật khẩu: admin / admin123; DungDA / 123457; mọi tài khoản khác / 123456');
