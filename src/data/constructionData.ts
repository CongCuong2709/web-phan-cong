/**
 * Construction seed data — bám sát SQL `seed-construction.js` của công ty.
 *
 * FIXED:
 *  #1 – ID generation deterministic (bỏ Date.now(), chỉ dùng sequential counter).
 *  #2 – makeProject: capture projId một lần, tái dùng cho deliverables
 *        → __projectSeq chỉ tăng đúng 1 lần mỗi project.
 *  #3 – makeBundle: idBundle() trả về { id, seq }
 *        → code GVxxx dùng cùng seq, không double-increment __bundleSeq.
 *  #4 – makeTask:  idTask()  trả về { id, seq }
 *        → code CVxxxx dùng cùng seq, không double-increment __taskSeq.
 *  #5 – subtasks[] và dailyLogs[] được populate thực cho mọi task có progress > 0.
 *  #6 – Rollup tiến độ hoạt động đúng vì subtasks không còn rỗng.
 *  #7 – Pattern gán item.id nhất quán: builder tự set, addPhase không cần gán lại.
 *
 * "Hôm nay" neo cứng ở 02/10/2026 để output ổn định.
 */

import {
  TierLevel,
  DailyLog,
  Department,
  HistoryEntry,
  SubTask,
  TaskPriorityLevel,
  TaskStatus,
  TeamLeadTask,
  TeamMember,
  EmployeeTask,
  TierItem,
} from '../types';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
const TODAY = new Date(2026, 9, 2); // 02/10/2026 (tháng 9 = October, 0-indexed)

const pad2 = (n: number) => n.toString().padStart(2, '0');
const ddmm = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const shiftDays = (offset: number): string => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return ddmm(d);
};

const shiftDaysISO = (offset: number): string => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return ymd(d);
};

// ---------------------------------------------------------------------------
// ID counters — mỗi loại entity có counter riêng biệt
// ---------------------------------------------------------------------------
let __projectSeq = 0;
let __deliverableSeq = 0; // FIX #2: counter riêng cho deliverable
let __phaseSeq = 0;
let __bundleSeq = 0;
let __taskSeq = 0;
let __subtaskSeq = 0;
let __logSeq = 0;
let __historySeq = 0;

// FIX #1: Bỏ hoàn toàn Date.now() — ID thuần sequential, deterministic
const idProject = () => `proj-${++__projectSeq}`;
const idDeliverable = () => `del-${++__deliverableSeq}`;
const idPhase = () => `phase-${++__phaseSeq}`;

// FIX #3 / #4: trả về { id, seq } để code dùng cùng số, không tăng counter lần 2
const idBundle = (): { id: string; seq: number } => {
  const seq = ++__bundleSeq;
  return { id: `bundle-${seq}`, seq };
};
const idTask = (): { id: string; seq: number } => {
  const seq = ++__taskSeq;
  return { id: `task-${seq}`, seq };
};

const idSub = () => `sub-${++__subtaskSeq}`;
const idLog = () => `log-${++__logSeq}`;
const idHistory = () => `hist-${++__historySeq}`;

// Pad "001" / "0001" cho code
const pad = (n: number, len = 3) => String(n).padStart(len, '0');

// ---------------------------------------------------------------------------
// Bảng tra cứu user (mirror users.ts)
// ---------------------------------------------------------------------------
interface UserRef {
  id: string;
  username: string;
  fullname: string;
  role: 'admin' | 'director' | 'manager' | 'employee';
  departments: Department[];
}

const U: Record<string, UserRef> = {
  admin: { id: 'u-001', username: 'admin', fullname: 'Quản trị hệ thống', role: 'admin', departments: ['ĐH', 'QLDA', 'KTTC', 'TC'] },
  khanh: { id: 'u-002', username: 'khanh', fullname: 'Khánh — Điều hành', role: 'director', departments: ['ĐH'] },
  nam: { id: 'u-003', username: 'nam', fullname: 'Nam — Điều hành', role: 'director', departments: ['ĐH'] },
  hung: { id: 'u-004', username: 'hung', fullname: 'Hùng — TP.QLDA', role: 'manager', departments: ['QLDA'] },
  hong: { id: 'u-005', username: 'hong', fullname: 'Hồng — NV.QLDA', role: 'employee', departments: ['QLDA'] },
  cuong: { id: 'u-006', username: 'cuong', fullname: 'Cường — TP.KTTC', role: 'manager', departments: ['KTTC'] },
  nguyet: { id: 'u-007', username: 'nguyet', fullname: 'Nguyệt — NV.KTTC', role: 'employee', departments: ['KTTC'] },
  hang: { id: 'u-008', username: 'hang', fullname: 'Hằng — NV.KTTC', role: 'employee', departments: ['KTTC'] },
  tu: { id: 'u-009', username: 'tu', fullname: 'Tú — NV.KTTC', role: 'employee', departments: ['KTTC'] },
  nhi: { id: 'u-010', username: 'nhi', fullname: 'Nhi — NV.KTTC', role: 'employee', departments: ['KTTC'] },
  thanh: { id: 'u-011', username: 'thanh', fullname: 'Thành — TP.TC', role: 'manager', departments: ['TC'] },
  ngoc: { id: 'u-012', username: 'ngoc', fullname: 'Ngọc — NV.TC', role: 'employee', departments: ['TC'] },
};

const TIER_NAME: Record<TierLevel, string> = {
  1: 'Tầng 1: Dự án',
  2: 'Tầng 2: Giai đoạn',
  3: 'Tầng 3: Hạng mục giao',
  4: 'Tầng 4: Đầu việc',
};
const TIER_BADGE: Record<TierLevel, string> = {
  1: 'DỰ ÁN T1',
  2: 'GIAI ĐOẠN T2',
  3: 'HẠNG MỤC T3',
  4: 'VIỆC T4',
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
interface BuildResult {
  id: string;
  item: TierItem;
}

// FIX #2: capture projId một lần → dùng cho item.id VÀ deliverables
//         __projectSeq chỉ tăng đúng 1 lần mỗi project (không còn gọi id() 3 lần)
const makeProject = (
  code: string,
  name: string,
  desc: string,
  address: string,
  managerKey: keyof typeof U,
  _s_offset: number,
  e_offset: number,
  status: 'in_progress' | 'completed' | 'pending',
  budget: number,
  ganttLabel: string,
): BuildResult => {
  const mgr = U[managerKey];
  const projId = idProject(); // ← tăng __projectSeq đúng 1 lần
  return {
    id: projId,
    item: {
      id: projId, // FIX #7: builder tự set, không cần gán lại bên ngoài
      code,
      tier: 1,
      tierName: TIER_NAME[1],
      tierBadge: TIER_BADGE[1],
      title: name,
      owner: {
        name: mgr.fullname,
        role: 'Giám đốc dự án',
        initial: mgr.fullname.charAt(0),
      },
      ownerUsername: mgr.username,
      department: mgr.departments[0],
      deadline: shiftDays(e_offset),
      daysRemaining: Math.max(0, e_offset),
      progress: 0,
      status: status === 'completed' ? 'Đã xong' : status === 'pending' ? 'Lên lịch' : 'Đang chạy',
      statusBadgeColor:
        status === 'completed'
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-primary/10 text-primary',
      priority: 'Cao (Critical Path)',
      description: `${desc}\n📍 ${address} • 💰 ${(budget / 1_000_000_000).toFixed(2)} tỷ VNĐ`,
      deliverables: [
        { id: idDeliverable(), title: 'Bàn giao công trình cho khách hàng', completed: status === 'completed' },
        { id: idDeliverable(), title: 'Hồ sơ quyết toán đã phê duyệt', completed: status === 'completed' },
      ],
      managementNotes: `Quản lý bởi ${mgr.fullname}. Mã dự án: ${code}.`,
      gantt: {
        startWeek: 1,
        endWeek: 4,
        label: ganttLabel,
        barColor: status === 'completed' ? '#006243' : '#0F172A',
      },
      collapsed: false,
    },
  };
};

// FIX #7: makePhase tự set item.id → không cần gán lại ở addPhase
const makePhase = (
  projectId: string,
  seq: number,
  name: string,
  status: 'completed' | 'in_progress' | 'pending',
  s_offset: number,
  e_offset: number,
): BuildResult => {
  const phaseId = idPhase();
  return {
    id: phaseId,
    item: {
      id: phaseId,
      code: `GD-${pad(seq)}`,
      parentId: projectId,
      tier: 2,
      tierName: TIER_NAME[2],
      tierBadge: TIER_BADGE[2],
      title: name,
      owner: { name: '—', role: '—', initial: '—' },
      department: undefined,
      deadline: shiftDays(e_offset),
      daysRemaining: Math.max(0, e_offset),
      progress: status === 'completed' ? 100 : status === 'pending' ? 0 : 50,
      status: status === 'completed' ? 'Đã xong' : status === 'pending' ? 'Lên lịch' : 'Đang chạy',
      statusBadgeColor:
        status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-[#004ac6]/10 text-[#004ac6]',
      priority: 'Cao (Critical Path)',
      description: name,
      deliverables: [],
      managementNotes: `Giai đoạn ${seq} – ${status === 'completed' ? 'đã hoàn tất' : status === 'in_progress' ? 'đang triển khai' : 'chưa khởi động'}.`,
      gantt: {
        startWeek: Math.max(1, Math.min(4, 1 + (s_offset + 60) / 60)),
        endWeek: Math.max(1, Math.min(4, 1 + (e_offset + 60) / 60)),
        label: `${shiftDays(s_offset)} → ${shiftDays(e_offset)}`,
        barColor: status === 'completed' ? '#006243' : status === 'pending' ? '#94a3b8' : '#004ac6',
      },
      collapsed: false,
    },
  };
};

interface BundleOpts {
  projectId: string;
  phaseId: string;
  ownerKey: keyof typeof U;
  dept: Department;
  desc: string;
  result?: string;
  start_offset: number;
  due_offset: number;
  status: 'assigned' | 'in_progress' | 'closed';
  progress: number;
  priority: TaskPriorityLevel;
  collab_depts?: Department[];
}

// FIX #3: idBundle() trả về { id, seq } → code GVxxx dùng cùng seq
//         __bundleSeq chỉ tăng đúng 1 lần mỗi bundle
const makeBundle = (opts: BundleOpts): BuildResult => {
  const owner = U[opts.ownerKey];
  const { id: bundleId, seq } = idBundle(); // ← tăng đúng 1 lần
  return {
    id: bundleId,
    item: {
      id: bundleId,
      code: `GV${pad(seq)}`, // ← dùng seq đã lấy, không ++__bundleSeq lần 2
      parentId: opts.phaseId,
      tier: 3,
      tierName: TIER_NAME[3],
      tierBadge: TIER_BADGE[3],
      title: opts.desc,
      owner: {
        name: owner.fullname,
        role: `${owner.role === 'manager' ? 'TP.' : 'NV.'}${opts.dept}`,
        initial: owner.fullname.charAt(0),
      },
      ownerUsername: owner.username,
      department: opts.dept,
      deadline: shiftDays(opts.due_offset),
      daysRemaining: Math.max(0, opts.due_offset),
      progress: opts.progress,
      status:
        opts.status === 'closed'
          ? 'Đã xong'
          : opts.status === 'in_progress'
            ? 'Đang chạy'
            : 'Lên lịch',
      statusBadgeColor:
        opts.status === 'closed'
          ? 'bg-emerald-100 text-emerald-800'
          : opts.status === 'in_progress'
            ? 'bg-primary/10 text-primary'
            : 'bg-slate-200 text-slate-800',
      priority:
        opts.priority === 'high' || opts.priority === 'critical'
          ? 'Cao (Critical Path)'
          : 'Trung bình',
      description: opts.desc,
      deliverables: [
        { id: idDeliverable(), title: opts.result ? `Kết quả: ${opts.result}` : `Hoàn tất gói "${opts.desc}"`, completed: opts.status === 'closed' },
      ],
      managementNotes:
        opts.result
          ? `Kết quả đầu ra: ${opts.result}`
          : opts.collab_depts && opts.collab_depts.length
            ? `Phối hợp: ${opts.collab_depts.join(', ')}.`
            : 'Gói việc độc lập.',
      gantt: {
        startWeek: Math.max(1, Math.min(4, 1 + (opts.start_offset + 60) / 60)),
        endWeek: Math.max(1, Math.min(4, 1 + (opts.due_offset + 60) / 60)),
        label: `${shiftDays(opts.start_offset)} → ${shiftDays(opts.due_offset)}`,
        barColor:
          opts.status === 'closed'
            ? '#006243'
            : opts.status === 'in_progress'
              ? '#004ac6'
              : '#94a3b8',
      },
      collapsed: false,
    },
  };
};

interface TaskOpts {
  bundleId: string;
  projectId: string;
  dept: Department;
  assigneeKey: keyof typeof U;
  name: string;
  start_offset: number;
  end_offset: number;
  progress: number;
  status: TaskStatus;
  priority?: TaskPriorityLevel;
  results?: string;
  notes?: string;
}

// FIX #4: idTask() trả về { id, seq } → code CVxxxx dùng cùng seq
//         __taskSeq chỉ tăng đúng 1 lần mỗi task
const makeTask = (opts: TaskOpts): BuildResult => {
  const owner = U[opts.assigneeKey];
  const { id: taskId, seq } = idTask(); // ← tăng đúng 1 lần
  return {
    id: taskId,
    item: {
      id: taskId,
      code: `CV${pad(seq, 4)}`, // ← dùng seq đã lấy, không ++__taskSeq lần 2
      parentId: opts.bundleId,
      tier: 4,
      tierName: TIER_NAME[4],
      tierBadge: TIER_BADGE[4],
      title: opts.name,
      owner: {
        name: owner.fullname,
        role: `${owner.role === 'manager' ? 'TP.' : 'NV.'}${opts.dept}`,
        initial: owner.fullname.charAt(0),
      },
      ownerUsername: owner.username,
      department: opts.dept,
      deadline: shiftDays(opts.end_offset),
      daysRemaining: Math.max(0, opts.end_offset),
      progress: opts.progress,
      status:
        opts.status === 'completed'
          ? 'Đã xong'
          : opts.status === 'in_progress'
            ? 'Đang làm'
            : opts.status === 'blocked'
              ? 'Đang nghẽn'
              : 'Lên lịch',
      statusBadgeColor:
        opts.status === 'completed'
          ? 'bg-emerald-100 text-emerald-800'
          : opts.status === 'in_progress'
            ? 'bg-primary/10 text-primary'
            : opts.status === 'blocked'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-slate-200 text-slate-800',
      priority:
        opts.priority === 'high' || opts.priority === 'critical'
          ? 'Cao (Critical Path)'
          : opts.priority === 'low'
            ? 'Thấp'
            : 'Trung bình',
      description: opts.name,
      deliverables: [
        {
          id: idDeliverable(),
          title: opts.results || `Hoàn tất "${opts.name}"`,
          completed: opts.status === 'completed',
        },
      ],
      managementNotes: opts.notes || (opts.results ? `Kết quả: ${opts.results}` : '—'),
      gantt: {
        startWeek: Math.max(1, Math.min(4, 1 + (opts.start_offset + 60) / 60)),
        endWeek: Math.max(1, Math.min(4, 1 + (opts.end_offset + 60) / 60)),
        label: `${opts.progress}%`,
        barColor:
          opts.status === 'completed'
            ? '#006243'
            : opts.status === 'blocked'
              ? '#ba1a1a'
              : '#2563eb',
      },
    },
  };
};

interface SubOpts {
  taskId: string;
  assigneeKey: keyof typeof U;
  name: string;
  start_offset: number;
  end_offset: number;
  progress: number;
  status: TaskStatus;
  priority?: TaskPriorityLevel;
  results?: string;
  notes?: string;
}
const makeSubTask = (opts: SubOpts): SubTask => {
  const owner = U[opts.assigneeKey];
  return {
    id: idSub(),
    taskId: opts.taskId,
    name: opts.name,
    assigneeUsername: owner.username,
    assigneeName: owner.fullname,
    assigneeRole: owner.role === 'manager' ? `TP.${owner.departments[0]}` : `NV.${owner.departments[0]}`,
    startDate: shiftDays(opts.start_offset),
    endDate: shiftDays(opts.end_offset),
    progress: opts.progress,
    status: opts.status,
    priority: opts.priority || 'medium',
    results: opts.results,
    notes: opts.notes,
  };
};

interface LogOpts {
  subtaskId: string;
  userKey: keyof typeof U;
  days_offset: number;
  desc: string;
  result?: string;
  obstacle?: string;
  progress: number;
}
const makeDailyLog = (opts: LogOpts): DailyLog => {
  const u = U[opts.userKey];
  return {
    id: idLog(),
    subtaskId: opts.subtaskId,
    logDate: shiftDaysISO(opts.days_offset),
    description: opts.desc,
    result: opts.result,
    obstacle: opts.obstacle,
    progress: opts.progress,
    username: u.username,
    userName: u.fullname,
    userRole: u.role === 'manager' ? `TP.${u.departments[0]}` : `NV.${u.departments[0]}`,
  };
};

const makeHistory = (
  entityType: HistoryEntry['entityType'],
  entityId: string,
  action: string,
  userKey: keyof typeof U,
): HistoryEntry => {
  const u = U[userKey];
  return {
    id: idHistory(),
    entityType,
    entityId,
    action,
    username: u.username,
    userName: u.fullname,
    createdAt: shiftDaysISO(0),
  };
};

// ===========================================================================
// === BẮT ĐẦU TẠO DỮ LIỆU ===================================================
// ===========================================================================

const tierItems: TierItem[] = [];
const subtasks: SubTask[] = [];    // FIX #5: sẽ được populate bên dưới
const dailyLogs: DailyLog[] = [];  // FIX #5: sẽ được populate bên dưới
const history: HistoryEntry[] = [];

// -----------------------------------------------------------------------
// DỰ ÁN: Hoàn thiện thanh quyết toán công trình CT12 (DA-CT12-001)
// Thời gian: 01/10/2026 - 15/10/2026 (-1 đến +13 ngày)
// -----------------------------------------------------------------------
{
  const p = makeProject(
    'DA-CT12-001',
    'Hoàn thiện thanh quyết toán công trình CT12',
    'Dự án hoàn thiện thanh quyết toán công trình CT12 từ 01/10/2026 đến 15/10/2026.',
    'Công trình CT12, TP. Hà Nội',
    'khanh',
    -1, 13,
    'in_progress',
    150_000_000_000,
    '01/10/2026 - 15/10/2026',
  );
  tierItems.push(p.item);
  history.push(makeHistory('project', p.id, `Tạo dự án "${p.item.title}"`, 'khanh'));

  const addPhase = (
    seq: number,
    title: string,
    ownerKey: keyof typeof U,
    dept: Department,
    s: number, e: number,
    bundles: Array<{
      name: string;
      dept: Department;
      ownerKey: keyof typeof U;
      results: string;
      s: number; e: number;
      progress: number;
      status: 'assigned' | 'in_progress' | 'closed';
    }>,
  ) => {
    const ph = makePhase(p.id, seq, title, 'in_progress', s, e);
    ph.item.owner = { name: U[ownerKey].fullname, role: `TP.${dept}`, initial: U[ownerKey].fullname.charAt(0) };
    ph.item.ownerUsername = ownerKey;
    ph.item.department = dept;
    tierItems.push(ph.item);

    for (const bOpts of bundles) {
      const b = makeBundle({
        projectId: p.id,
        phaseId: ph.id,
        ownerKey: bOpts.ownerKey,
        dept: bOpts.dept,
        desc: bOpts.name,
        result: bOpts.results,
        start_offset: bOpts.s,
        due_offset: bOpts.e,
        status: bOpts.status,
        progress: bOpts.progress,
        priority: 'high',
      });
      tierItems.push(b.item);
    }
  };

  // === GIAI ĐOẠN 1: THIẾT KẾ VÀ HOÀN THIỆN PHÁP LÝ XÂY DỰNG (Phòng QLDA) ===
  addPhase(1, 'GIAI ĐOẠN 1: THIẾT KẾ VÀ HOÀN THIỆN PHÁP LÝ XÂY DỰNG', 'hung', 'QLDA', -1, 4, [
    { name: 'Khảo sát địa chất, địa hình bổ sung (nếu cần)', dept: 'QLDA', ownerKey: 'hung', results: 'Báo cáo khảo sát đã nghiệm thu', s: -1, e: 1, progress: 100, status: 'closed' },
    { name: 'Lập nhiệm vụ thiết kế, yêu cầu kỹ thuật, tiêu chuẩn vật liệu và hoàn thiện theo định vị sản phẩm', dept: 'QLDA', ownerKey: 'hung', results: 'Nhiệm vụ thiết kế được duyệt', s: -1, e: 2, progress: 100, status: 'closed' },
    { name: 'Thiết kế kỹ thuật / bản vẽ thi công (kiến trúc, kết cấu, MEP, PCCC, hạ tầng)', dept: 'QLDA', ownerKey: 'hung', results: 'Bộ hồ sơ thiết kế', s: 0, e: 3, progress: 70, status: 'in_progress' },
    { name: 'Thẩm tra thiết kế, dự toán', dept: 'QLDA', ownerKey: 'hung', results: 'Báo cáo thẩm tra', s: 1, e: 3, progress: 50, status: 'in_progress' },
    { name: 'Lập và phê duyệt dự toán, tổng mức đầu tư điều chỉnh (nếu có)', dept: 'QLDA', ownerKey: 'hung', results: 'Dự toán được duyệt, làm giá gói thầu', s: 2, e: 4, progress: 20, status: 'in_progress' },
  ]);

  // === GIAI ĐOẠN 2: LỰA CHỌN NHÀ THẦU VÀ KÝ HỢP ĐỒNG (Phòng QLDA) ===
  addPhase(2, 'GIAI ĐOẠN 2: LỰA CHỌN NHÀ THẦU VÀ KÝ HỢP ĐỒNG', 'hung', 'QLDA', 1, 6, [
    { name: 'Lập kế hoạch phân chia gói thầu: phần ngầm, phần thân, hoàn thiện, MEP, thang máy, hạ tầng, cảnh quan, vật tư CĐT cấp', dept: 'QLDA', ownerKey: 'hung', results: 'Kế hoạch lựa chọn nhà thầu', s: 1, e: 3, progress: 80, status: 'in_progress' },
    { name: 'Lập hồ sơ mời thầu / yêu cầu báo giá', dept: 'QLDA', ownerKey: 'hung', results: 'HSMT được duyệt', s: 2, e: 4, progress: 60, status: 'in_progress' },
    { name: 'Tổ chức mời thầu, đánh giá hồ sơ dự thầu (kỹ thuật và tài chính)', dept: 'QLDA', ownerKey: 'hung', results: 'Báo cáo đánh giá', s: 3, e: 5, progress: 30, status: 'in_progress' },
    { name: 'Nhận bảo lãnh thực hiện hợp đồng, bảo lãnh tạm ứng', dept: 'KTTC', ownerKey: 'cuong', results: 'Bảo lãnh hợp lệ', s: 3, e: 5, progress: 40, status: 'in_progress' },
    { name: 'Lập kế hoạch mua sắm vật tư, thiết bị do chủ đầu tư cấp', dept: 'QLDA', ownerKey: 'hung', results: 'Kế hoạch mua sắm và dòng tiền', s: 4, e: 6, progress: 10, status: 'in_progress' },
  ]);

  // === GIAI ĐOẠN 3: CHUẨN BỊ KHỞI CÔNG (Phòng TC) ===
  addPhase(3, 'GIAI ĐOẠN 3: CHUẨN BỊ KHỞI CÔNG', 'thanh', 'TC', 3, 8, [
    { name: 'Bàn giao mặt bằng, mốc định vị, cao độ cho nhà thầu', dept: 'TC', ownerKey: 'thanh', results: 'Biên bản bàn giao mặt bằng', s: 3, e: 5, progress: 60, status: 'in_progress' },
    { name: 'Thành lập Ban Chỉ huy công trường, quy chế phối hợp CĐT – TVGS – nhà thầu', dept: 'TC', ownerKey: 'thanh', results: 'Sơ đồ tổ chức công trường, quy chế', s: 4, e: 6, progress: 50, status: 'in_progress' },
    { name: 'Phê duyệt biện pháp thi công, tiến độ tổng thể và chi tiết', dept: 'TC', ownerKey: 'thanh', results: 'Biện pháp và tiến độ được duyệt', s: 4, e: 6, progress: 40, status: 'in_progress' },
    { name: 'Kế hoạch an toàn lao động, vệ sinh môi trường, PCCC công trường', dept: 'TC', ownerKey: 'thanh', results: 'Kế hoạch ATLĐ – VSMT', s: 4, e: 7, progress: 20, status: 'in_progress' },
    { name: 'Mua bảo hiểm công trình, bảo hiểm con người', dept: 'KTTC', ownerKey: 'cuong', results: 'Hợp đồng bảo hiểm', s: 4, e: 7, progress: 30, status: 'in_progress' },
    { name: 'Chuẩn bị lán trại, điện nước thi công, hàng rào, biển báo', dept: 'TC', ownerKey: 'thanh', results: 'Công trường đủ điều kiện', s: 5, e: 7, progress: 10, status: 'in_progress' },
    { name: 'Lập quy trình quản lý hồ sơ chất lượng, biểu mẫu nghiệm thu', dept: 'QLDA', ownerKey: 'hung', results: 'Bộ biểu mẫu thống nhất', s: 5, e: 8, progress: 0, status: 'assigned' },
    { name: 'Tạm ứng hợp đồng', dept: 'KTTC', ownerKey: 'cuong', results: 'Chứng từ tạm ứng', s: 5, e: 8, progress: 0, status: 'assigned' },
  ]);

  // === GIAI ĐOẠN 4: THI CÔNG XÂY DỰNG (Phòng TC) ===
  addPhase(4, 'GIAI ĐOẠN 4: THI CÔNG XÂY DỰNG', 'thanh', 'TC', 5, 11, [
    { name: 'Kiểm soát vật liệu đầu vào: phê duyệt mẫu, chứng chỉ, thí nghiệm', dept: 'TC', ownerKey: 'thanh', results: 'Biên bản duyệt mẫu, kết quả thí nghiệm', s: 5, e: 8, progress: 20, status: 'in_progress' },
    { name: 'Nghiệm thu công việc, bộ phận, giai đoạn (cốt thép, cốp pha, bê tông, xây tô…)', dept: 'TC', ownerKey: 'thanh', results: 'Biên bản nghiệm thu', s: 6, e: 9, progress: 0, status: 'assigned' },
    { name: 'Quản lý tiến độ: báo cáo ngày, tuần, tháng; cảnh báo chậm trễ', dept: 'TC', ownerKey: 'thanh', results: 'Báo cáo tiến độ', s: 6, e: 9, progress: 0, status: 'assigned' },
    { name: 'Giao ban công trường định kỳ', dept: 'TC', ownerKey: 'thanh', results: 'Biên bản giao ban', s: 6, e: 10, progress: 0, status: 'assigned' },
    { name: 'Quản lý thay đổi thiết kế, phát sinh khối lượng', dept: 'QLDA', ownerKey: 'hung', results: 'Phụ lục hợp đồng, phê duyệt phát sinh', s: 7, e: 10, progress: 0, status: 'assigned' },
    { name: 'Giám sát an toàn lao động, môi trường, PCCC', dept: 'TC', ownerKey: 'thanh', results: 'Nhật ký an toàn, biên bản xử lý vi phạm', s: 7, e: 10, progress: 0, status: 'assigned' },
    { name: 'Quản lý giao nhận vật tư CĐT cấp, đối chiếu tồn kho', dept: 'TC', ownerKey: 'thanh', results: 'Phiếu nhập xuất, biên bản đối chiếu', s: 7, e: 10, progress: 0, status: 'assigned' },
    { name: 'Quản lý nhân công khoán (nếu có): chấm công, xác nhận khối lượng', dept: 'TC', ownerKey: 'thanh', results: 'Bảng khối lượng, chấm công', s: 8, e: 10, progress: 0, status: 'assigned' },
    { name: 'Cập nhật nhật ký thi công, bản vẽ hoàn công từng phần', dept: 'TC', ownerKey: 'thanh', results: 'Nhật ký, bản vẽ hoàn công từng phần', s: 8, e: 11, progress: 0, status: 'assigned' },
    { name: 'Nghiệm thu khối lượng hoàn thành theo đợt', dept: 'TC', ownerKey: 'thanh', results: 'Bảng xác nhận khối lượng', s: 8, e: 11, progress: 0, status: 'assigned' },
    { name: 'Thanh toán theo đợt, thu hồi tạm ứng, giữ lại tiền bảo hành', dept: 'KTTC', ownerKey: 'cuong', results: 'Hồ sơ thanh toán đợt', s: 8, e: 11, progress: 0, status: 'assigned' },
    { name: 'Báo cáo tài chính dự án: kế hoạch và thực tế dòng tiền', dept: 'KTTC', ownerKey: 'cuong', results: 'Báo cáo dòng tiền', s: 8, e: 11, progress: 0, status: 'assigned' },
  ]);

  // === GIAI ĐOẠN 5: NGHIỆM THU HOÀN THÀNH VÀ HOÀN CÔNG (Phòng TC) ===
  addPhase(5, 'GIAI ĐOẠN 5: NGHIỆM THU HOÀN THÀNH VÀ HOÀN CÔNG', 'thanh', 'TC', 9, 13, [
    { name: 'Chạy thử đơn động, liên động hệ thống MEP, thang máy, PCCC', dept: 'TC', ownerKey: 'thanh', results: 'Biên bản chạy thử', s: 9, e: 11, progress: 0, status: 'assigned' },
    { name: 'Kiểm định thiết bị có yêu cầu nghiêm ngặt về an toàn (thang máy, bình áp lực…)', dept: 'TC', ownerKey: 'thanh', results: 'Giấy chứng nhận kiểm định', s: 9, e: 12, progress: 0, status: 'assigned' },
    { name: 'Lập bản vẽ hoàn công tổng thể', dept: 'TC', ownerKey: 'thanh', results: 'Bộ bản vẽ hoàn công', s: 10, e: 12, progress: 0, status: 'assigned' },
    { name: 'Tập hợp hồ sơ chất lượng công trình', dept: 'QLDA', ownerKey: 'hung', results: 'Hồ sơ hoàn thành công trình', s: 10, e: 12, progress: 0, status: 'assigned' },
    { name: 'Đấu nối hạ tầng: điện, nước, thoát nước, viễn thông', dept: 'TC', ownerKey: 'thanh', results: 'Hợp đồng và biên bản đấu nối', s: 10, e: 12, progress: 0, status: 'assigned' },
    { name: 'Nghiệm thu hoàn thành hạng mục hoặc công trình đưa vào sử dụng', dept: 'QLDA', ownerKey: 'hung', results: 'Biên bản nghiệm thu hoàn thành', s: 11, e: 13, progress: 0, status: 'assigned' },
  ]);

  // === GIAI ĐOẠN 6: BÀN GIAO (Phòng QLDA) ===
  addPhase(6, 'GIAI ĐOẠN 6: BÀN GIAO', 'hung', 'QLDA', 11, 15, [
    { name: 'Kiểm tra hoàn thiện từng căn/sản phẩm, lập danh sách lỗi và khắc phục', dept: 'TC', ownerKey: 'thanh', results: 'Checklist bàn giao từng căn', s: 11, e: 13, progress: 0, status: 'assigned' },
    { name: 'Lập quy trình bảo trì công trình', dept: 'QLDA', ownerKey: 'hung', results: 'Quy trình bảo trì được duyệt', s: 11, e: 13, progress: 0, status: 'assigned' },
    { name: 'Bàn giao hồ sơ, tài liệu kỹ thuật cho đơn vị quản lý vận hành', dept: 'QLDA', ownerKey: 'hung', results: 'Biên bản bàn giao hồ sơ', s: 12, e: 14, progress: 0, status: 'assigned' },
    { name: 'Bàn giao công trình, thiết bị cho đơn vị quản lý vận hành, đào tạo vận hành', dept: 'TC', ownerKey: 'thanh', results: 'Biên bản bàn giao', s: 12, e: 14, progress: 0, status: 'assigned' },
    { name: 'Thu tiền đợt cuối, kinh phí bảo trì (nếu có) theo hợp đồng mua bán', dept: 'KTTC', ownerKey: 'cuong', results: 'Chứng từ thu', s: 12, e: 14, progress: 0, status: 'assigned' },
    { name: 'Theo dõi, xử lý bảo hành trong thời gian bảo hành', dept: 'TC', ownerKey: 'thanh', results: 'Sổ theo dõi bảo hành', s: 13, e: 15, progress: 0, status: 'assigned' },
  ]);

  // === GIAI ĐOẠN 7: THANH QUYẾT TOÁN (Phòng KTTC) ===
  addPhase(7, 'GIAI ĐOẠN 7: THANH QUYẾT TOÁN', 'cuong', 'KTTC', 11, 15, [
    { name: 'Tổng hợp khối lượng hoàn thành theo hoàn công từng gói thầu', dept: 'QLDA', ownerKey: 'hung', results: 'Bảng khối lượng quyết toán', s: 11, e: 13, progress: 0, status: 'assigned' },
    { name: 'Đối chiếu phát sinh, phụ lục, khấu trừ (vật tư CĐT cấp, điện nước, phạt vi phạm)', dept: 'KTTC', ownerKey: 'cuong', results: 'Biên bản đối chiếu', s: 12, e: 14, progress: 0, status: 'assigned' },
    { name: 'Thẩm tra quyết toán hợp đồng (nội bộ hoặc thuê kiểm toán)', dept: 'KTTC', ownerKey: 'cuong', results: 'Báo cáo thẩm tra', s: 12, e: 14, progress: 0, status: 'assigned' },
    { name: 'Thanh toán phần còn lại, giữ bảo hành hoặc nhận bảo lãnh bảo hành', dept: 'KTTC', ownerKey: 'cuong', results: 'Chứng từ thanh toán', s: 13, e: 15, progress: 0, status: 'assigned' },
    { name: 'Hoàn trả tiền bảo hành, giải tỏa bảo lãnh khi hết hạn', dept: 'KTTC', ownerKey: 'cuong', results: 'Chứng từ hoàn trả', s: 13, e: 15, progress: 0, status: 'assigned' },
    { name: 'Quyết toán tổng chi phí đầu tư dự án', dept: 'KTTC', ownerKey: 'cuong', results: 'Báo cáo quyết toán dự án', s: 13, e: 15, progress: 0, status: 'assigned' },
    { name: 'Quyết toán thuế, nghĩa vụ tài chính với Nhà nước liên quan dự án', dept: 'KTTC', ownerKey: 'cuong', results: 'Hồ sơ thuế', s: 14, e: 15, progress: 0, status: 'assigned' },
    { name: 'Lưu trữ hồ sơ dự án', dept: 'QLDA', ownerKey: 'hung', results: 'Kho hồ sơ số hóa', s: 14, e: 15, progress: 0, status: 'assigned' },
  ]);
}

// ===========================================================================
// === TÍNH LẠI TIẾN ĐỘ CỘNG DỒN (Recalculate Progress) =====================
// ===========================================================================

// 1. task progress = mean(subtasks.progress)
// FIX #6: subtasks[] có dữ liệu thực → rollup này giờ có tác dụng
const subtasksByTask = new Map<string, SubTask[]>();
for (const s of subtasks) {
  if (!subtasksByTask.has(s.taskId)) subtasksByTask.set(s.taskId, []);
  subtasksByTask.get(s.taskId)!.push(s);
}
for (const item of tierItems) {
  if (item.tier !== 4) continue;
  const subs = subtasksByTask.get(item.id);
  if (subs && subs.length > 0) {
    const avg = Math.round(subs.reduce((acc, s) => acc + s.progress, 0) / subs.length);
    item.progress = avg;
    if (avg === 100) item.status = 'Đã xong';
    else if (avg > 0) item.status = 'Đang làm';
  }
}

// 2. bundle progress = mean(tasks.progress)
const tasksByBundle = new Map<string, TierItem[]>();
for (const item of tierItems) {
  if (item.tier !== 4 || !item.parentId) continue;
  if (!tasksByBundle.has(item.parentId)) tasksByBundle.set(item.parentId, []);
  tasksByBundle.get(item.parentId)!.push(item);
}
for (const item of tierItems) {
  if (item.tier !== 3) continue;
  const tasks = tasksByBundle.get(item.id);
  if (tasks && tasks.length > 0) {
    const avg = Math.round(tasks.reduce((acc, t) => acc + t.progress, 0) / tasks.length);
    item.progress = avg;
    if (avg === 100) item.status = 'Đã xong';
    else if (avg > 90) item.status = 'Sắp xong';
  }
}

// 3. phase progress = mean(bundles.progress)
const bundlesByPhase = new Map<string, TierItem[]>();
for (const item of tierItems) {
  if (item.tier !== 3 || !item.parentId) continue;
  if (!bundlesByPhase.has(item.parentId)) bundlesByPhase.set(item.parentId, []);
  bundlesByPhase.get(item.parentId)!.push(item);
}
for (const item of tierItems) {
  if (item.tier !== 2) continue;
  const bundles = bundlesByPhase.get(item.id);
  if (bundles && bundles.length > 0) {
    const avg = Math.round(bundles.reduce((acc, b) => acc + b.progress, 0) / bundles.length);
    item.progress = avg;
    if (avg === 100) item.status = 'Đã xong';
    else if (avg > 90) item.status = 'Sắp xong';
  }
}

// 4. project progress = mean(phases.progress)
for (const proj of tierItems) {
  if (proj.tier !== 1) continue;
  const phases = tierItems.filter((t) => t.tier === 2 && t.parentId === proj.id);
  if (phases.length > 0) {
    const avg = Math.round(phases.reduce((acc, p) => acc + p.progress, 0) / phases.length);
    proj.progress = avg;
  }
}

// ===========================================================================
// === TẠO TEAM_MEMBERS / TEAM_TASKS / EMPLOYEE_TASKS từ dữ liệu dự án ======
// ===========================================================================

const userTaskCounts = new Map<string, { active: number; total: number }>();
const byUser = new Map<string, TierItem[]>();
for (const item of tierItems) {
  if ((item.tier === 3 || item.tier === 4) && item.ownerUsername) {
    if (!byUser.has(item.ownerUsername)) byUser.set(item.ownerUsername, []);
    byUser.get(item.ownerUsername)!.push(item);
  }
}
for (const [username, items] of byUser.entries()) {
  const active = items.filter((i) => i.progress < 100 && i.progress >= 0).length;
  userTaskCounts.set(username, { active, total: items.length });
}

const teamMembers: TeamMember[] = (['khanh', 'nam', 'hung', 'hong', 'cuong', 'nguyet', 'hang', 'tu', 'nhi', 'thanh', 'ngoc'] as const)
  .map((key) => {
    const u = U[key];
    const counts = userTaskCounts.get(u.username) || { active: 0, total: 0 };
    return {
      id: `mem-${u.username}`,
      name: u.fullname,
      role: u.role === 'manager' ? `TP.${u.departments[0]}` : `NV.${u.departments[0]}`,
      avatar: '',
      activeTasks: counts.active,
      onTimeRate: counts.total > 0 && counts.active === 0 ? '100% đúng hạn' : `${counts.active}/${counts.total} đang chạy`,
      statusText: counts.active > 0 ? `${counts.active} việc đang làm` : 'Hoàn tất gói việc',
      statusType: counts.active > 2 ? 'warning' : counts.active > 0 ? 'good' : 'idle',
      workloadPercent: Math.min(100, counts.active * 25),
      department: u.departments[0],
      username: u.username,
    } satisfies TeamMember;
  });

const teamLeadTasks: TeamLeadTask[] = (() => {
  const candidates = tierItems
    .filter((t) => (t.tier === 3 || t.tier === 4) && t.progress < 100)
    .sort((a, b) => {
      const order = (d?: string) =>
        d === 'TC' ? 0 : d === 'KTTC' ? 1 : d === 'QLDA' ? 2 : 3;
      return order(a.department) - order(b.department);
    })
    .slice(0, 30);
  return candidates.map((t) => {
    const status: TeamLeadTask['status'] =
      t.status === 'Đang nghẽn' || t.status === 'Điểm nghẽn'
        ? 'need_help'
        : t.progress === 100
          ? 'done'
          : 'in_progress';
    return {
      id: `tlt-${t.id}`,
      code: t.code,
      title: t.title,
      category: t.department || '—',
      deliverableType: 'text',
      deliverableText: t.managementNotes || '—',
      ownerName: t.owner.name,
      ownerUsername: t.ownerUsername,
      department: t.department,
      submittedAt: shiftDays(-2),
      deadline: t.deadline,
      status,
      priority: t.priority === 'Cao (Critical Path)' ? 'Cao' : 'Thường',
      progressText: `${t.progress}%`,
    } satisfies TeamLeadTask;
  });
})();

const employeeTasks: EmployeeTask[] = tierItems
  .filter((t) => (t.tier === 3 || t.tier === 4) && t.ownerUsername && ['hong', 'nguyet', 'hang', 'tu', 'nhi', 'ngoc'].includes(t.ownerUsername))
  .slice(0, 30)
  .map((t) => ({
    id: `emp-${t.id}`,
    code: t.code,
    bundleName: t.parentId
      ? tierItems.find((b) => b.id === t.parentId)?.title ?? '—'
      : '—',
    title: t.title,
    description: t.description,
    currentDeliverable: t.managementNotes,
    lastUpdated: 'Cập nhật trong hệ thống',
    deadline: t.deadline,
    isToday: t.progress > 0 && t.progress < 100,
    status:
      t.status === 'Đã xong' ? 'done' : t.status === 'Đang chạy' || t.status === 'Đang làm' ? 'doing' : 'pending',
    manager: { name: '—', role: '—', avatar: '' },
    notesCount: 2,
    notes: [],
    ownerUsername: t.ownerUsername,
    department: t.department,
  }));

// ===========================================================================
// === EXPORTS ================================================================
// ===========================================================================

export const CONSTRUCTION_TIER_ITEMS: TierItem[] = tierItems;
export const CONSTRUCTION_SUBTASKS: SubTask[] = subtasks;
export const CONSTRUCTION_DAILY_LOGS: DailyLog[] = dailyLogs;
export const CONSTRUCTION_HISTORY: HistoryEntry[] = history;
export const CONSTRUCTION_TEAM_MEMBERS: TeamMember[] = teamMembers;
export const CONSTRUCTION_TEAM_LEAD_TASKS: TeamLeadTask[] = teamLeadTasks;
export const CONSTRUCTION_EMPLOYEE_TASKS: EmployeeTask[] = employeeTasks;