/**
 * seed.ts — Dữ liệu seed: Dự án "Hồ sơ hoàn công dự án 68"
 *
 * Cấu trúc:
 *   - 4 departments (ĐH, QLDA, KTTC, TC) — giữ nguyên dàn nhân sự cũ
 *   - 11 users (admin + 2 directors + 4 managers + 6 employees)
 *   - 1 project "Hồ sơ hoàn công dự án 68"
 *   - 7 phases (mỗi giai đoạn ứng với 1 phase, owner là trưởng phòng phụ trách)
 *   - 1 bundle / phase → Tổng cộng 7 bundles
 *   - 50 tasks (mỗi "Công việc" trong bảng là 1 task trong bundle của giai đoạn tương ứng)
 *
 * Phân công "Chủ trì" theo từng task:
 *   - QLDA → manager Hung (TP.QLDA) là owner; NV. Hong tham gia hỗ trợ khi phase QLDA-driven
 *   - KTTC → manager Cuong (TP.KTTC); NV. Nguyệt / Hằng / Tú thực thi
 *   - TC   → manager Thành (TP.TC); NV. Ngọc thực thi
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

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

console.log('🗑️  Clearing existing data…');
db.exec(`
  DELETE FROM audit_log;
  DELETE FROM daily_logs;
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
// 1. Departments (giữ nguyên)
// ============================================================================

console.log('📁 Inserting departments…');
const departments = [
  { code: 'ĐH',   name: 'Ban Điều hành',             sort_order: 10 },
  { code: 'QLDA', name: 'Phòng Quản lý Dự án',       sort_order: 20 },
  { code: 'KTTC', name: 'Phòng Kế toán – Tài chính', sort_order: 30 },
  { code: 'TC',   name: 'Phòng Tổ chức – Hành chính', sort_order: 40 },
];
const insertDept = db.prepare(
  'INSERT INTO departments (code, name, sort_order) VALUES (?, ?, ?)'
);
for (const d of departments) insertDept.run(d.code, d.name, d.sort_order);

// ============================================================================
// 2. Users (giữ nguyên dàn nhân sự cũ)
// ============================================================================

console.log('👥 Inserting users…');
const passwordHash = bcrypt.hashSync('123456', 10);
const passwordAdmin = bcrypt.hashSync('admin123', 10);

const users = [
  { username: 'admin',  fullname: 'Quản trị hệ thống', role: 'admin',    depts: ['ĐH','QLDA','KTTC','TC'] },
  { username: 'khanh',  fullname: 'Khánh — BGĐ',        role: 'director', depts: ['ĐH'] },
  { username: 'nam',    fullname: 'Nam — BGĐ',          role: 'director', depts: ['ĐH'] },
  { username: 'hung',   fullname: 'Hùng — TP.QLDA',     role: 'manager',  depts: ['QLDA'] },
  { username: 'cuong',  fullname: 'Cường — TP.KTTC',    role: 'manager',  depts: ['KTTC'] },
  { username: 'thanh',  fullname: 'Thành — TP.TC',      role: 'manager',  depts: ['TC'] },
  { username: 'hong',   fullname: 'Hồng — NV.QLDA',     role: 'employee', depts: ['QLDA'] },
  { username: 'nguyet', fullname: 'Nguyệt — NV.KTTC',   role: 'employee', depts: ['KTTC'] },
  { username: 'hang',   fullname: 'Hằng — NV.KTTC',     role: 'employee', depts: ['KTTC'] },
  { username: 'tu',     fullname: 'Tú — NV.KTTC',       role: 'employee', depts: ['KTTC'] },
  { username: 'ngoc',   fullname: 'Ngọc — NV.TC',       role: 'employee', depts: ['TC'] },
];

const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, fullname, role, initial)
  VALUES (?, ?, ?, ?, ?)
`);
const insertUserDept = db.prepare(`
  INSERT INTO user_departments (user_id, department_code) VALUES (?, ?)
`);

const userIds: Record<string, number> = {};
for (const u of users) {
  const hash = u.username === 'admin' ? passwordAdmin : passwordHash;
  const info = insertUser.run(u.username, hash, u.fullname, u.role, u.fullname.charAt(0).toUpperCase());
  const id = Number(info.lastInsertRowid);
  userIds[u.username] = id;
  for (const d of u.depts) insertUserDept.run(id, d);
}
console.log(`   ✓ ${users.length} users`);

// ============================================================================
// 3. Helper: định nghĩa 7 giai đoạn + 50 công việc
// ============================================================================
// Mỗi entry công việc gồm: { code, title, dept, owner, start, end, deliverable, priority }
// dept ∈ {'QLDA','KTTC','TC'} — chuyển từ cột "Chủ trì"
// owner: username của user phụ trách (là manager phòng đó, hoặc NV khi có thể phân bổ đều)
// start/end: YYYY-MM-DD
// ============================================================================

type WorkItem = {
  code: string;
  title: string;
  dept: 'QLDA' | 'KTTC' | 'TC';
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
  owner: string;        // username của chủ trì giai đoạn
  dept: string;         // dept chính của phase
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
    owner: 'hung',  dept: 'QLDA',
    start: '2026-10-10', end: '2026-10-13',
    management_notes: 'Phối hợp chặt với đơn vị tư vấn thiết kế; cần BGĐ phê duyệt dự toán trước 14/10.',
    tasks: [
      { code: 'T1-01', title: 'Khảo sát địa chất, địa hình bổ sung (nếu cần)', dept: 'QLDA', owner: 'hung',
        start: '2026-10-10', end: '2026-10-11', deliverable: 'Báo cáo khảo sát đã nghiệm thu', priority: 'high' },
      { code: 'T1-02', title: 'Lập nhiệm vụ thiết kế, yêu cầu kỹ thuật, tiêu chuẩn vật liệu và hoàn thiện theo định vị sản phẩm', dept: 'QLDA', owner: 'hong',
        start: '2026-10-10', end: '2026-10-11', deliverable: 'Nhiệm vụ thiết kế được duyệt', priority: 'high' },
      { code: 'T1-03', title: 'Thiết kế kỹ thuật / bản vẽ thi công (kiến trúc, kết cấu, MEP, PCCC, hạ tầng)', dept: 'QLDA', owner: 'hung',
        start: '2026-10-11', end: '2026-10-12', deliverable: 'Bộ hồ sơ thiết kế', priority: 'critical' },
      { code: 'T1-04', title: 'Thẩm tra thiết kế, dự toán', dept: 'QLDA', owner: 'hong',
        start: '2026-10-12', end: '2026-10-13', deliverable: 'Báo cáo thẩm tra', priority: 'high' },
      { code: 'T1-05', title: 'Lập và phê duyệt dự toán, tổng mức đầu tư điều chỉnh (nếu có)', dept: 'QLDA', owner: 'hung',
        start: '2026-10-12', end: '2026-10-13', deliverable: 'Dự toán được duyệt, làm giá gói thầu', priority: 'critical' },
    ],
  },
  // ============== GIAI ĐOẠN 2 ==============
  {
    code: 'GD-02',
    title: 'Giai đoạn 2: Lựa chọn nhà thầu và ký hợp đồng',
    description: 'Phân chia gói thầu, lập HSMT, tổ chức đấu thầu, nhận bảo lãnh và ký hợp đồng.',
    owner: 'hung',  dept: 'QLDA',
    start: '2026-10-12', end: '2026-10-15',
    management_notes: 'HSMT phải đồng bộ với dự toán đã duyệt ở GĐ1.',
    tasks: [
      { code: 'T2-01', title: 'Lập kế hoạch phân chia gói thầu: phần ngầm, phần thân, hoàn thiện, MEP, thang máy, hạ tầng, cảnh quan, vật tư CĐT cấp', dept: 'QLDA', owner: 'hung',
        start: '2026-10-12', end: '2026-10-13', deliverable: 'Kế hoạch lựa chọn nhà thầu', priority: 'high' },
      { code: 'T2-02', title: 'Lập hồ sơ mời thầu / yêu cầu báo giá', dept: 'QLDA', owner: 'hong',
        start: '2026-10-13', end: '2026-10-14', deliverable: 'HSMT được duyệt', priority: 'high' },
      { code: 'T2-03', title: 'Tổ chức mời thầu, đánh giá hồ sơ dự thầu (kỹ thuật và tài chính)', dept: 'QLDA', owner: 'hung',
        start: '2026-10-13', end: '2026-10-14', deliverable: 'Báo cáo đánh giá', priority: 'high' },
      { code: 'T2-04', title: 'Nhận bảo lãnh thực hiện hợp đồng, bảo lãnh tạm ứng', dept: 'KTTC', owner: 'cuong',
        start: '2026-10-14', end: '2026-10-15', deliverable: 'Bảo lãnh hợp lệ', priority: 'normal' },
      { code: 'T2-05', title: 'Lập kế hoạch mua sắm vật tư, thiết bị do chủ đầu tư cấp', dept: 'QLDA', owner: 'hong',
        start: '2026-10-14', end: '2026-10-15', deliverable: 'Kế hoạch mua sắm và dòng tiền', priority: 'normal' },
    ],
  },
  // ============== GIAI ĐOẠN 3 ==============
  {
    code: 'GD-03',
    title: 'Giai đoạn 3: Chuẩn bị khởi công',
    description: 'Bàn giao mặt bằng, lập ban chỉ huy, phê duyệt biện pháp thi công, an toàn – PCCC, tạm ứng hợp đồng.',
    owner: 'thanh', dept: 'TC',
    start: '2026-10-14', end: '2026-10-17',
    management_notes: 'Công trường phải đủ điều kiện khởi công trước 17/10; chú ý bảo hiểm & tạm ứng.',
    tasks: [
      { code: 'T3-01', title: 'Bàn giao mặt bằng, mốc định vị, cao độ cho nhà thầu', dept: 'TC', owner: 'thanh',
        start: '2026-10-14', end: '2026-10-15', deliverable: 'Biên bản bàn giao mặt bằng', priority: 'critical' },
      { code: 'T3-02', title: 'Thành lập Ban Chỉ huy công trường, quy chế phối hợp CĐT – TVGS – nhà thầu', dept: 'TC', owner: 'ngoc',
        start: '2026-10-14', end: '2026-10-15', deliverable: 'Sơ đồ tổ chức công trường, quy chế', priority: 'high' },
      { code: 'T3-03', title: 'Phê duyệt biện pháp thi công, tiến độ tổng thể và chi tiết', dept: 'TC', owner: 'thanh',
        start: '2026-10-15', end: '2026-10-16', deliverable: 'Biện pháp và tiến độ được duyệt', priority: 'critical' },
      { code: 'T3-04', title: 'Kế hoạch an toàn lao động, vệ sinh môi trường, PCCC công trường', dept: 'TC', owner: 'ngoc',
        start: '2026-10-15', end: '2026-10-16', deliverable: 'Kế hoạch ATLĐ – VSMT', priority: 'high' },
      { code: 'T3-05', title: 'Mua bảo hiểm công trình, bảo hiểm con người', dept: 'KTTC', owner: 'cuong',
        start: '2026-10-15', end: '2026-10-16', deliverable: 'Hợp đồng bảo hiểm', priority: 'normal' },
      { code: 'T3-06', title: 'Chuẩn bị lán trại, điện nước thi công, hàng rào, biển báo', dept: 'TC', owner: 'thanh',
        start: '2026-10-15', end: '2026-10-16', deliverable: 'Công trường đủ điều kiện', priority: 'normal' },
      { code: 'T3-07', title: 'Lập quy trình quản lý hồ sơ chất lượng, biểu mẫu nghiệm thu', dept: 'QLDA', owner: 'hong',
        start: '2026-10-16', end: '2026-10-17', deliverable: 'Bộ biểu mẫu thống nhất', priority: 'normal' },
      { code: 'T3-08', title: 'Tạm ứng hợp đồng', dept: 'KTTC', owner: 'nguyet',
        start: '2026-10-16', end: '2026-10-17', deliverable: 'Chứng từ tạm ứng', priority: 'normal' },
    ],
  },
  // ============== GIAI ĐOẠN 4 ==============
  {
    code: 'GD-04',
    title: 'Giai đoạn 4: Thi công xây dựng',
    description: 'Kiểm soát vật liệu, nghiệm thu, quản lý tiến độ – an toàn – chất lượng – tài chính trong suốt quá trình thi công.',
    owner: 'thanh', dept: 'TC',
    start: '2026-10-16', end: '2026-10-21',
    management_notes: 'Giai đoạn dài nhất, nhiều đầu việc song song — cần giao ban công trường hằng ngày.',
    tasks: [
      { code: 'T4-01', title: 'Kiểm soát vật liệu đầu vào: phê duyệt mẫu, chứng chỉ, thí nghiệm', dept: 'TC', owner: 'ngoc',
        start: '2026-10-16', end: '2026-10-17', deliverable: 'Biên bản duyệt mẫu, kết quả thí nghiệm', priority: 'high' },
      { code: 'T4-02', title: 'Nghiệm thu công việc, bộ phận, giai đoạn (cốt thép, cốp pha, bê tông, xây tô...)', dept: 'TC', owner: 'thanh',
        start: '2026-10-17', end: '2026-10-19', deliverable: 'Biên bản nghiệm thu', priority: 'critical' },
      { code: 'T4-03', title: 'Quản lý tiến độ: báo cáo ngày, tuần, tháng; cảnh báo chậm trễ', dept: 'TC', owner: 'thanh',
        start: '2026-10-17', end: '2026-10-21', deliverable: 'Báo cáo tiến độ', priority: 'high' },
      { code: 'T4-04', title: 'Giao ban công trường định kỳ', dept: 'TC', owner: 'thanh',
        start: '2026-10-17', end: '2026-10-21', deliverable: 'Biên bản giao ban', priority: 'normal' },
      { code: 'T4-05', title: 'Quản lý thay đổi thiết kế, phát sinh khối lượng', dept: 'QLDA', owner: 'hung',
        start: '2026-10-18', end: '2026-10-19', deliverable: 'Phụ lục hợp đồng, phê duyệt phát sinh', priority: 'high' },
      { code: 'T4-06', title: 'Giám sát an toàn lao động, môi trường, PCCC', dept: 'TC', owner: 'ngoc',
        start: '2026-10-17', end: '2026-10-21', deliverable: 'Nhật ký an toàn, biên bản xử lý vi phạm', priority: 'high' },
      { code: 'T4-07', title: 'Quản lý giao nhận vật tư CĐT cấp, đối chiếu tồn kho', dept: 'TC', owner: 'ngoc',
        start: '2026-10-18', end: '2026-10-19', deliverable: 'Phiếu nhập xuất, biên bản đối chiếu', priority: 'normal' },
      { code: 'T4-08', title: 'Quản lý nhân công khoán (nếu có): chấm công, xác nhận khối lượng', dept: 'TC', owner: 'ngoc',
        start: '2026-10-18', end: '2026-10-19', deliverable: 'Bảng khối lượng, chấm công', priority: 'normal' },
      { code: 'T4-09', title: 'Cập nhật nhật ký thi công, bản vẽ hoàn công từng phần', dept: 'TC', owner: 'thanh',
        start: '2026-10-18', end: '2026-10-20', deliverable: 'Nhật ký, bản vẽ hoàn công từng phần', priority: 'high' },
      { code: 'T4-10', title: 'Nghiệm thu khối lượng hoàn thành theo đợt', dept: 'TC', owner: 'thanh',
        start: '2026-10-19', end: '2026-10-20', deliverable: 'Bảng xác nhận khối lượng', priority: 'high' },
      { code: 'T4-11', title: 'Thanh toán theo đợt, thu hồi tạm ứng, giữ lại tiền bảo hành', dept: 'KTTC', owner: 'cuong',
        start: '2026-10-20', end: '2026-10-21', deliverable: 'Hồ sơ thanh toán đợt', priority: 'high' },
      { code: 'T4-12', title: 'Báo cáo tài chính dự án: kế hoạch và thực tế dòng tiền', dept: 'KTTC', owner: 'nguyet',
        start: '2026-10-20', end: '2026-10-21', deliverable: 'Báo cáo dòng tiền', priority: 'normal' },
    ],
  },
  // ============== GIAI ĐOẠN 5 ==============
  {
    code: 'GD-05',
    title: 'Giai đoạn 5: Nghiệm thu hoàn thành và hoàn công',
    description: 'Chạy thử hệ thống, kiểm định thiết bị, lập bản vẽ hoàn công, đấu nối hạ tầng, nghiệm thu đưa vào sử dụng.',
    owner: 'thanh', dept: 'TC',
    start: '2026-10-21', end: '2026-10-24',
    management_notes: 'Đảm bảo bộ hồ sơ hoàn công đầy đủ trước khi đưa công trình vào sử dụng.',
    tasks: [
      { code: 'T5-01', title: 'Chạy thử đơn động, liên động hệ thống MEP, thang máy, PCCC', dept: 'TC', owner: 'thanh',
        start: '2026-10-21', end: '2026-10-22', deliverable: 'Biên bản chạy thử', priority: 'critical' },
      { code: 'T5-02', title: 'Kiểm định thiết bị có yêu cầu nghiêm ngặt về an toàn (thang máy, bình áp lực...)', dept: 'TC', owner: 'ngoc',
        start: '2026-10-21', end: '2026-10-22', deliverable: 'Giấy chứng nhận kiểm định', priority: 'critical' },
      { code: 'T5-03', title: 'Lập bản vẽ hoàn công tổng thể', dept: 'TC', owner: 'thanh',
        start: '2026-10-22', end: '2026-10-23', deliverable: 'Bộ bản vẽ hoàn công', priority: 'high' },
      { code: 'T5-04', title: 'Tập hợp hồ sơ chất lượng công trình', dept: 'QLDA', owner: 'hong',
        start: '2026-10-22', end: '2026-10-23', deliverable: 'Hồ sơ hoàn thành công trình', priority: 'high' },
      { code: 'T5-05', title: 'Đấu nối hạ tầng: điện, nước, thoát nước, viễn thông', dept: 'TC', owner: 'ngoc',
        start: '2026-10-23', end: '2026-10-24', deliverable: 'Hợp đồng và biên bản đấu nối', priority: 'high' },
      { code: 'T5-06', title: 'Nghiệm thu hoàn thành hạng mục hoặc công trình đưa vào sử dụng', dept: 'QLDA', owner: 'hung',
        start: '2026-10-23', end: '2026-10-24', deliverable: 'Biên bản nghiệm thu hoàn thành', priority: 'critical' },
    ],
  },
  // ============== GIAI ĐOẠN 6 ==============
  {
    code: 'GD-06',
    title: 'Giai đoạn 6: Bàn giao',
    description: 'Kiểm tra hoàn thiện từng sản phẩm, lập quy trình bảo trì, bàn giao hồ sơ và công trình cho đơn vị vận hành.',
    owner: 'thanh', dept: 'TC',
    start: '2026-10-24', end: '2026-10-27',
    management_notes: 'Phối hợp chặt với đơn vị quản lý vận hành để đào tạo và bàn giao đúng hạn.',
    tasks: [
      { code: 'T6-01', title: 'Kiểm tra hoàn thiện từng căn/sản phẩm, lập danh sách lỗi và khắc phục', dept: 'TC', owner: 'thanh',
        start: '2026-10-24', end: '2026-10-25', deliverable: 'Checklist bàn giao từng căn', priority: 'high' },
      { code: 'T6-02', title: 'Lập quy trình bảo trì công trình', dept: 'QLDA', owner: 'hung',
        start: '2026-10-24', end: '2026-10-25', deliverable: 'Quy trình bảo trì được duyệt', priority: 'normal' },
      { code: 'T6-03', title: 'Bàn giao hồ sơ, tài liệu kỹ thuật cho đơn vị quản lý vận hành', dept: 'QLDA', owner: 'hong',
        start: '2026-10-25', end: '2026-10-26', deliverable: 'Biên bản bàn giao hồ sơ', priority: 'high' },
      { code: 'T6-04', title: 'Bàn giao công trình, thiết bị cho đơn vị quản lý vận hành, đào tạo vận hành', dept: 'TC', owner: 'thanh',
        start: '2026-10-25', end: '2026-10-26', deliverable: 'Biên bản bàn giao', priority: 'critical' },
      { code: 'T6-05', title: 'Thu tiền đợt cuối, kinh phí bảo trì (nếu có) theo hợp đồng mua bán', dept: 'KTTC', owner: 'hang',
        start: '2026-10-26', end: '2026-10-27', deliverable: 'Chứng từ thu', priority: 'normal' },
      { code: 'T6-06', title: 'Theo dõi, xử lý bảo hành trong thời gian bảo hành', dept: 'TC', owner: 'ngoc',
        start: '2026-10-26', end: '2026-10-27', deliverable: 'Sổ theo dõi bảo hành', priority: 'normal' },
    ],
  },
  // ============== GIAI ĐOẠN 7 ==============
  {
    code: 'GD-07',
    title: 'Giai đoạn 7: Thanh quyết toán',
    description: 'Tổng hợp khối lượng, đối chiếu phát sinh, thẩm tra quyết toán, thanh toán phần còn lại, hoàn trả bảo hành, quyết toán thuế và lưu trữ hồ sơ.',
    owner: 'cuong', dept: 'KTTC',
    start: '2026-10-26', end: '2026-10-29',
    management_notes: 'Đóng dự án đúng hạn 29/10; đối chiếu chặt với bộ phận KTTC để tránh sai sót thuế.',
    tasks: [
      { code: 'T7-01', title: 'Tổng hợp khối lượng hoàn thành theo hoàn công từng gói thầu', dept: 'QLDA', owner: 'hung',
        start: '2026-10-26', end: '2026-10-27', deliverable: 'Bảng khối lượng quyết toán', priority: 'high' },
      { code: 'T7-02', title: 'Đối chiếu phát sinh, phụ lục, khấu trừ (vật tư CĐT cấp, điện nước, phạt vi phạm)', dept: 'KTTC', owner: 'cuong',
        start: '2026-10-27', end: '2026-10-28', deliverable: 'Biên bản đối chiếu', priority: 'high' },
      { code: 'T7-03', title: 'Thẩm tra quyết toán hợp đồng (nội bộ hoặc thuê kiểm toán)', dept: 'KTTC', owner: 'nguyet',
        start: '2026-10-27', end: '2026-10-28', deliverable: 'Báo cáo thẩm tra', priority: 'high' },
      { code: 'T7-04', title: 'Thanh toán phần còn lại, giữ bảo hành hoặc nhận bảo lãnh bảo hành', dept: 'KTTC', owner: 'hang',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Chứng từ thanh toán', priority: 'normal' },
      { code: 'T7-05', title: 'Hoàn trả tiền bảo hành, giải tỏa bảo lãnh khi hết hạn', dept: 'KTTC', owner: 'tu',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Chứng từ hoàn trả', priority: 'normal' },
      { code: 'T7-06', title: 'Quyết toán tổng chi phí đầu tư dự án', dept: 'KTTC', owner: 'cuong',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Báo cáo quyết toán dự án', priority: 'critical' },
      { code: 'T7-07', title: 'Quyết toán thuế, nghĩa vụ tài chính với Nhà nước liên quan dự án', dept: 'KTTC', owner: 'tu',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Hồ sơ thuế', priority: 'normal' },
      { code: 'T7-08', title: 'Lưu trữ hồ sơ dự án', dept: 'QLDA', owner: 'hong',
        start: '2026-10-28', end: '2026-10-29', deliverable: 'Kho hồ sơ số hóa', priority: 'normal' },
    ],
  },
];

// ============================================================================
// 4. Insert project + phases + bundles + tasks
// ============================================================================

console.log('📊 Inserting project hierarchy…');

// --- Tier 1: Project ---
const projectInfo = db.prepare(`
  INSERT INTO projects (code, title, description, owner_user_id, created_by_user_id,
    start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'DA-68',
  'Hồ sơ hoàn công dự án 68',
  'Dự án trọng điểm khối 68: từ thiết kế & pháp lý → lựa chọn nhà thầu → chuẩn bị khởi công → thi công → nghiệm thu hoàn công → bàn giao → thanh quyết toán.',
  userIds['hung'],
  userIds['admin'],  // Phase G3: created_by
  '2026-10-10',
  '2026-10-29',
  'doing',
);
const projectId = Number(projectInfo.lastInsertRowid);

// --- Tier 2: Phases ---
const insertPhase = db.prepare(`
  INSERT INTO phases (project_id, code, title, description, owner_user_id, created_by_user_id,
    start_date, end_date, status, management_notes, blocker_alert)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// --- Tier 3: Bundles ---
const insertBundle = db.prepare(`
  INSERT INTO bundles (phase_id, code, title, description, owner_user_id, created_by_user_id,
    start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// --- Tier 4: Tasks ---
// Phase G3: created_by_user_id, assigned_by_user_id. Phase G2: is_today_date.
const insertTask = db.prepare(`
  INSERT INTO tasks (bundle_id, code, title, description,
    owner_user_id, created_by_user_id, assigned_by_user_id, department_code,
    start_date, end_date, progress, status, priority, is_today, is_today_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertedTasks: { id: number; code: string; title: string }[] = [];

// ============================================================================
// Bảng tên hạng mục (bundle) theo (phase, dept) — đặt tên theo bản chất CV
// ============================================================================

const bundleNames: Record<string, { title: string; description: string }> = {
  // ===== GĐ1: Thiết kế & hoàn thiện pháp lý xây dựng =====
  'GD-01|QLDA': {
    title: 'Hồ sơ thiết kế & dự toán',
    description: 'Khảo sát địa chất/địa hình, lập nhiệm vụ thiết kế, bản vẽ thi công (kiến trúc, kết cấu, MEP, PCCC, hạ tầng), thẩm tra và phê duyệt dự toán/tổng mức đầu tư.',
  },

  // ===== GĐ2: Lựa chọn nhà thầu & ký hợp đồng =====
  'GD-02|QLDA': {
    title: 'Hồ sơ mời thầu & lựa chọn nhà thầu',
    description: 'Phân chia gói thầu, lập HSMT/yêu cầu báo giá, đánh giá HSDT (kỹ thuật + tài chính) và kế hoạch mua sắm vật tư CĐT cấp.',
  },
  'GD-02|KTTC': {
    title: 'Bảo lãnh thực hiện hợp đồng',
    description: 'Tiếp nhận bảo lãnh thực hiện hợp đồng và bảo lãnh tạm ứng từ nhà thầu trúng thầu.',
  },

  // ===== GĐ3: Chuẩn bị khởi công =====
  'GD-03|TC': {
    title: 'Mặt bằng & tổ chức công trường',
    description: 'Bàn giao mặt bằng/mốc định vị, lập Ban Chỉ huy công trường, phê duyệt biện pháp thi công, kế hoạch ATLĐ–VSMT–PCCC và chuẩn bị lán trại/hàng rào/biển báo.',
  },
  'GD-03|KTTC': {
    title: 'Bảo hiểm & tạm ứng hợp đồng',
    description: 'Mua bảo hiểm công trình + bảo hiểm con người và thực hiện tạm ứng hợp đồng cho nhà thầu.',
  },
  'GD-03|QLDA': {
    title: 'Quy trình quản lý chất lượng',
    description: 'Lập quy trình quản lý hồ sơ chất lượng và bộ biểu mẫu nghiệm thu thống nhất toàn dự án.',
  },

  // ===== GĐ4: Thi công xây dựng =====
  'GD-04|TC': {
    title: 'Giám sát thi công tại công trường',
    description: 'Kiểm soát vật liệu đầu vào, nghiệm thu công việc/bộ phận/giai đoạn, quản lý tiến độ, an toàn PCCC, giao ban, nhật ký thi công và quản lý nhân công khoán.',
  },
  'GD-04|QLDA': {
    title: 'Quản lý thay đổi thiết kế',
    description: 'Xử lý thay đổi thiết kế, phát sinh khối lượng và phê duyệt phụ lục hợp đồng trong quá trình thi công.',
  },
  'GD-04|KTTC': {
    title: 'Thanh toán & báo cáo tài chính',
    description: 'Thanh toán theo đợt, thu hồi tạm ứng, giữ lại tiền bảo hành và báo cáo dòng tiền dự án (kế hoạch vs thực tế).',
  },

  // ===== GĐ5: Nghiệm thu hoàn thành & hoàn công =====
  'GD-05|TC': {
    title: 'Chạy thử & đấu nối hạ tầng',
    description: 'Chạy thử đơn động/liên động MEP–thang máy–PCCC, kiểm định thiết bị an toàn (thang máy, bình áp lực) và đấu nối hạ tầng điện–nước–thoát nước–viễn thông.',
  },
  'GD-05|QLDA': {
    title: 'Hồ sơ hoàn công & nghiệm thu',
    description: 'Tập hợp hồ sơ chất lượng, lập bản vẽ hoàn công tổng thể và biên bản nghiệm thu hoàn thành đưa vào sử dụng.',
  },

  // ===== GĐ6: Bàn giao =====
  'GD-06|TC': {
    title: 'Bàn giao & bảo hành công trình',
    description: 'Kiểm tra hoàn thiện từng căn/sản phẩm, bàn giao công trình + thiết bị cho đơn vị vận hành, đào tạo vận hành và theo dõi bảo hành.',
  },
  'GD-06|QLDA': {
    title: 'Hồ sơ kỹ thuật & quy trình bảo trì',
    description: 'Bàn giao hồ sơ/tài liệu kỹ thuật cho đơn vị quản lý vận hành và lập quy trình bảo trì công trình.',
  },
  'GD-06|KTTC': {
    title: 'Thu tiền & kinh phí bảo trì',
    description: 'Thu tiền đợt cuối và kinh phí bảo trì (nếu có) theo hợp đồng mua bán.',
  },

  // ===== GĐ7: Thanh quyết toán =====
  'GD-07|QLDA': {
    title: 'Tổng hợp khối lượng & lưu trữ hồ sơ',
    description: 'Tổng hợp khối lượng hoàn thành theo hoàn công từng gói thầu và số hóa/lưu trữ toàn bộ hồ sơ dự án.',
  },
  'GD-07|KTTC': {
    title: 'Quyết toán & nghĩa vụ thuế',
    description: 'Đối chiếu phát sinh/phụ lục/khấu trừ, thẩm tra quyết toán, thanh toán phần còn lại, hoàn trả bảo hành/giải tỏa bảo lãnh, quyết toán tổng chi phí đầu tư và nghĩa vụ thuế với Nhà nước.',
  },
};

for (const p of phases) {
  const phaseInfo = insertPhase.run(
    projectId,
    p.code,
    p.title,
    p.description,
    userIds[p.owner],
    userIds[p.owner],  // Phase G3: created_by = owner (manager tự tạo phase của mình)
    p.start,
    p.end,
    'doing',
    p.management_notes ?? '',
    null,
  );
  const phaseId = Number(phaseInfo.lastInsertRowid);

  // Gom task theo phòng ban → mỗi phòng ban 1 bundle (hạng mục) trong giai đoạn
  const tasksByDept = new Map<string, typeof p.tasks>();
  for (const t of p.tasks) {
    if (!tasksByDept.has(t.dept)) tasksByDept.set(t.dept, []);
    tasksByDept.get(t.dept)!.push(t);
  }

  // Bundle owner: manager của phòng ban đó (nếu có), fallback về owner của phase
  const deptManager: Record<string, string> = {
    QLDA: 'hung',
    KTTC: 'cuong',
    TC:   'thanh',
  };

  for (const [dept, deptTaskList] of tasksByDept) {
    const bundleOwner = deptManager[dept] ?? p.owner;
    // Trong cùng phase + dept: ngày bắt đầu sớm nhất, ngày kết thúc muộn nhất
    const sortedDates = [...deptTaskList].sort((a, b) => a.start.localeCompare(b.start));
    const bStartDate = sortedDates[0].start;
    const bEndDate = sortedDates[sortedDates.length - 1].end;

    const nameInfo = bundleNames[`${p.code}|${dept}`] ?? {
      title: `${p.title} — phòng ${dept}`,
      description: `Các công việc phòng ${dept} trong ${p.title}.`,
    };

    const bundleInfo = insertBundle.run(
      phaseId,
      `${p.code}-${dept}`,                          // bundle code: GD-01-QLDA
      nameInfo.title,                                // bundle title (theo bảng trên)
      nameInfo.description,                          // banner cho hạng mục
      userIds[bundleOwner],
      userIds[bundleOwner],                          // Phase G3: created_by
      bStartDate,
      bEndDate,
      'doing',
    );
    const bundleId = Number(bundleInfo.lastInsertRowid);

    for (const t of deptTaskList) {
      const info = insertTask.run(
        bundleId,                                            // 1. bundle_id
        t.code,                                              // 2. code
        t.title,                                             // 3. title
        `Kết quả đầu ra: ${t.deliverable}`,                  // 4. description
        userIds[t.owner],                                    // 5. owner_user_id
        userIds[bundleOwner],                                // 6. created_by_user_id (manager tạo)
        userIds[bundleOwner],                                // 7. assigned_by_user_id (cùng người tạo)
        t.dept,                                              // 8. department_code
        t.start,                                             // 9. start_date
        t.end,                                               // 10. end_date
        t.progress ?? 0,                                     // 11. progress
        t.status ?? 'pending',                               // 12. status
        t.priority ?? 'normal',                              // 13. priority
        0,                                                   // 14. is_today
        null,                                                // 15. is_today_date (chưa mark today)
      );
      insertedTasks.push({ id: Number(info.lastInsertRowid), code: t.code, title: t.title });
    }
  }
}

const taskCount = insertedTasks.length;
const totalTasksExpected = phases.reduce((acc, p) => acc + p.tasks.length, 0);
const totalBundles = db.prepare("SELECT COUNT(*) AS c FROM bundles WHERE phase_id IN (SELECT id FROM phases WHERE project_id = ?)").get(projectId) as { c: number };
console.log(`   ✓ 1 project → 7 phases → ${totalBundles.c} bundles (chia theo phòng ban) → ${taskCount} tasks`);
if (taskCount !== totalTasksExpected) {
  console.error(`   ⚠️  Expected ${totalTasksExpected} tasks, got ${taskCount}`);
}

// ============================================================================
// 5. Daily log demo: gắn vào vài task đầu GĐ1 & GĐ2 cho thấy pattern 4-cột
// ============================================================================

console.log('📝 Inserting daily logs (demo)…');
const insertLog = db.prepare(`
  INSERT INTO daily_logs (task_id, log_date, description, result, obstacle, progress, author_user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Tìm task theo code
function findTaskByCode(code: string): number | undefined {
  return insertedTasks.find((t) => t.code === code)?.id;
}

const t1_03 = findTaskByCode('T1-03'); // Thiết kế kỹ thuật
const t1_05 = findTaskByCode('T1-05'); // Lập & phê duyệt dự toán
const t4_02 = findTaskByCode('T4-02'); // Nghiệm thu công việc

if (t1_03) {
  insertLog.run(
    t1_03,
    '2026-10-11',
    'Triển khai bản vẽ kiến trúc tầng 1-3, phối hợp MEP',
    'Hoàn tất 60% bản vẽ kiến trúc, MEP còn chờ phản hồi tư vấn PCCC',
    'Đơn vị tư vấn PCCC phản hồi chậm 1 ngày',
    60,
    userIds['hung'],
  );
}
if (t1_05) {
  insertLog.run(
    t1_05,
    '2026-10-12',
    'Tổng hợp dự toán các gói thầu, trình BGĐ phê duyệt',
    'Đã trình BGĐ, kỳ vọng phê duyệt trước 13/10',
    '',
    40,
    userIds['hung'],
  );
}
if (t4_02) {
  insertLog.run(
    t4_02,
    '2026-10-17',
    'Nghiệm thu cốt thép móng đơn, cốp pha cột tầng 1',
    'Đạt yêu cầu, đã lập biên bản',
    '',
    30,
    userIds['thanh'],
  );
}

// ============================================================================
// 6. Blocker note demo trên 1 task KTTC (bảo lãnh)
// ============================================================================

console.log('📝 Inserting demo blocker_note on T2-04…');
const t2_04 = findTaskByCode('T2-04');
if (t2_04) {
  db.prepare(`UPDATE tasks SET blocker_note = ? WHERE id = ?`).run(
    'Cần BGĐ xác nhận ngân hàng bảo lãnh trước khi phát hành thư bảo lãnh.',
    t2_04,
  );
}

// ============================================================================
// 6b. Phase G7: Help messages history demo (lịch sử escalation)
// ============================================================================

console.log('💬 Inserting help_messages history demo on T2-04…');
if (t2_04) {
  const insertHelp = db.prepare(`
    INSERT INTO task_help_messages (task_id, body, author_user_id)
    VALUES (?, ?, ?)
  `);
  // Cùng nội dung với blocker_note hiện tại, để demo flow
  insertHelp.run(
    t2_04,
    'Cần BGĐ xác nhận ngân hàng bảo lãnh trước khi phát hành thư bảo lãnh.',
    userIds['cuong'],  // manager KTTC gửi
  );
  // Một message nữa của admin resolve
  const info = db.prepare(`
    INSERT INTO task_help_messages (task_id, body, author_user_id, is_resolved, resolved_by_user_id, resolved_at)
    VALUES (?, ?, ?, 1, ?, datetime('now'))
  `).run(
    t2_04,
    'Đã xác nhận với ngân hàng Vietcombank chi nhánh X, thư bảo lãnh dự kiến phát hành 16/10.',
    userIds['admin'],
    userIds['admin'],
  );
  console.log(`   - 2 help messages (1 resolved, 1 open)`);
}

// ============================================================================
// 7. Audit log demo
// ============================================================================

console.log('📜 Inserting audit log demo…');
db.prepare(`
  INSERT INTO audit_log (entity_type, entity_id, action, new_values, actor_user_id, actor_username, actor_ip)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  'project', projectId, 'create',
  JSON.stringify({ code: 'DA-68', title: 'Hồ sơ hoàn công dự án 68' }),
  userIds['hung'], 'hung', '127.0.0.1',
);

// Phase IDs đã insert: xếp theo thứ tự phases[] nên phase đầu = 1 (vừa insert)
// Lấy lại từ DB cho chắc:
const firstPhaseId = db.prepare(
  'SELECT id FROM phases WHERE project_id = ? AND code = ?'
).get(projectId, 'GD-01') as { id: number } | undefined;
if (firstPhaseId) {
  db.prepare(`
    INSERT INTO audit_log (entity_type, entity_id, action, new_values, actor_user_id, actor_username, actor_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'phase', firstPhaseId.id, 'create',
    JSON.stringify({ code: 'GD-01', title: phases[0].title }),
    userIds['hung'], 'hung', '127.0.0.1',
  );
}

const firstTaskId = findTaskByCode('T1-03');
if (firstTaskId) {
  db.prepare(`
    INSERT INTO audit_log (entity_type, entity_id, action, new_values, actor_user_id, actor_username, actor_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'task', firstTaskId, 'create',
    JSON.stringify({ code: 'T1-03', title: 'Thiết kế kỹ thuật / bản vẽ thi công' }),
    userIds['hung'], 'hung', '127.0.0.1',
  );
}

// ============================================================================
// Summary
// ============================================================================

db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();

console.log('\n✅ Seed "Hồ sơ hoàn công dự án 68" complete!');
console.log('   - 4 departments, 11 users (giữ nguyên dàn nhân sự cũ)');
console.log(`   - 1 project "DA-68" → 7 phases → ${totalBundles.c} bundles (chia theo phòng ban: QLDA/KTTC/TC) → ${taskCount} tasks`);
console.log('   - 3 daily log demo + 1 blocker_note demo + 2 help_messages');
console.log('   - 3 audit log entries');
console.log('\n   Default password:');
console.log('   - admin / admin123');
console.log('   - all others / 123456');