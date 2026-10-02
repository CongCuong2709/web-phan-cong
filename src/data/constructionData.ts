/**
 * Construction seed data — bám sát SQL `seed-construction.js` của công ty.
 *
 * Mọi thực thể được build bằng các helper `make*` để giữ cấu trúc khai báo
 * giống backend, sau đó quy đổi về:
 *   - TierItem (T1–T4) cho cây Gantt 4 tầng hiện có.
 *   - SubTask  (T4.5) cho đầu việc con của mỗi task.
 *   - DailyLog cho nhật ký thi công hằng ngày.
 *   - HistoryEntry cho dấu vết thao tác.
 *
 * "Hôm nay" neo cứng ở 02/10/2026 để output ổn định; chuyển sang Date.now()
 * nếu muốn rolling dates trong tương lai.
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
// ID counters
// ---------------------------------------------------------------------------
let __projectSeq = 0;
let __phaseSeq = 0;
let __bundleSeq = 0;
let __taskSeq = 0;
let __subtaskSeq = 0;
let __logSeq = 0;
let __historySeq = 0;

const id = (prefix: string) => `${prefix}-${++(__projectSeq)}-${Date.now().toString(36)}`;
const idPhase = () => `phase-${++__phaseSeq}`;
const idBundle = () => `bundle-${++__bundleSeq}`;
const idTask = () => `task-${++__taskSeq}`;
const idSub = () => `sub-${++__subtaskSeq}`;
const idLog = () => `log-${++__logSeq}`;
const idHistory = () => `hist-${++__historySeq}`;

// Pad "001" cho project code
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
  thanh: { id: 'u-010', username: 'thanh', fullname: 'Thành — TP.TC', role: 'manager', departments: ['TC'] },
  ngoc: { id: 'u-011', username: 'ngoc', fullname: 'Ngọc — NV.TC', role: 'employee', departments: ['TC'] },
};

// Helper xác định tier-name + badge từ tier number
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
// builder → trả về { id, item (TierItem) }
// ---------------------------------------------------------------------------

interface BuildResult {
  id: string;
  item: TierItem;
}

const makeProject = (
  code: string,
  name: string,
  desc: string,
  address: string,
  managerKey: keyof typeof U,
  s_offset: number,
  e_offset: number,
  status: 'in_progress' | 'completed' | 'pending',
  budget: number,
  ganttLabel: string,
): BuildResult => {
  const mgr = U[managerKey];
  return {
    id: id('proj'),
    item: {
      id: '', // set below
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
        { id: `del-${id('proj')}-1`, title: 'Bàn giao công trình cho khách hàng', completed: status === 'completed' },
        { id: `del-${id('proj')}-2`, title: 'Hồ sơ quyết toán đã phê duyệt', completed: status === 'completed' },
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

const makePhase = (
  projectId: string,
  seq: number,
  name: string,
  status: 'completed' | 'in_progress' | 'pending',
  s_offset: number,
  e_offset: number,
): BuildResult => ({
  id: idPhase(),
  item: {
    id: '', // set after
    code: `GD-${pad(seq)}`,
    parentId: projectId,
    tier: 2,
    tierName: TIER_NAME[2],
    tierBadge: TIER_BADGE[2],
    title: name,
    owner: { name: '—', role: '—', initial: '—' },
    department: undefined, // phase inherits from project via task filter
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
});

interface BundleOpts {
  projectId: string;
  phaseId: string;
  ownerKey: keyof typeof U;
  dept: Department;
  desc: string;
  start_offset: number;
  due_offset: number;
  status: 'assigned' | 'in_progress' | 'closed';
  progress: number;
  priority: TaskPriorityLevel;
  collab_depts?: Department[];
}
const makeBundle = (opts: BundleOpts): BuildResult => {
  const owner = U[opts.ownerKey];
  return {
    id: idBundle(),
    item: {
      id: '',
      code: `GV${pad(++__bundleSeq)}`,
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
        opts.priority === 'high'
          ? 'Cao (Critical Path)'
          : opts.priority === 'critical'
          ? 'Cao (Critical Path)'
          : 'Trung bình',
      description: opts.desc,
      deliverables: [
        { id: `del-b-${Date.now()}-${__bundleSeq}`, title: `Hoàn tất gói "${opts.desc}"`, completed: opts.status === 'closed' },
      ],
      managementNotes:
        opts.collab_depts && opts.collab_depts.length
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
const makeTask = (opts: TaskOpts): BuildResult => {
  const owner = U[opts.assigneeKey];
  const newId = idTask();
  return {
    id: newId,
    item: {
      id: newId,
      code: `CV${pad(++__taskSeq, 4)}`,
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
          id: `del-t-${__taskSeq}-1`,
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
const subtasks: SubTask[] = [];
const dailyLogs: DailyLog[] = [];
const history: HistoryEntry[] = [];

// -----------------------------------------------------------------------
// 1. DỰ ÁN 1: DA-CCM-001 — Chung cư mini 7 tầng Hoàng Mai (Đang thi công)
// -----------------------------------------------------------------------
{
  const p = makeProject(
    'DA-CCM-001',
    'Chung cư mini 7 tầng Hoàng Mai',
    'Xây dựng tòa nhà chung cư mini 7 tầng + 1 tầng hầm, diện tích sàn 450m². CĐT: Ông Trần Văn Bình.',
    '68 Nguyễn Đức Cảnh, Hoàng Mai, Hà Nội',
    'khanh',
    -60,
    120,
    'in_progress',
    12_500_000_000,
    'Tổng thể Q4/2026 – Q1/2027',
  );
  p.item.id = p.id;
  tierItems.push(p.item);
  history.push(
    makeHistory('project', p.id, `Tạo dự án "${p.item.title}"`, 'khanh'),
  );

  // Phase 1
  const ph1 = makePhase(p.id, 1, 'Chuẩn bị pháp lý & Thiết kế thi công', 'completed', -60, -25);
  ph1.item.id = ph1.id;
  tierItems.push(ph1.item);

  const b1_1 = makeBundle({
    projectId: p.id, phaseId: ph1.id, ownerKey: 'hung', dept: 'QLDA',
    desc: 'Lập hồ sơ Giấy phép xây dựng & Bản vẽ thi công',
    start_offset: -60, due_offset: -30, status: 'closed', progress: 100, priority: 'high', collab_depts: ['KTTC'],
  });
  b1_1.item.id = b1_1.id;
  tierItems.push(b1_1.item);
  {
    const t = makeTask({
      bundleId: b1_1.id, projectId: p.id, dept: 'QLDA', assigneeKey: 'hong',
      name: 'Thu thập Giấy chứng nhận QSDĐ & Hồ sơ pháp lý hiện trạng',
      start_offset: -60, end_offset: -45, progress: 100, status: 'completed', priority: 'high',
      results: 'Đã hoàn tất xác minh ranh giới thửa đất và nộp bản đồ hiện trạng.',
    });
    tierItems.push(t.item);
  }
  {
    const t = makeTask({
      bundleId: b1_1.id, projectId: p.id, dept: 'QLDA', assigneeKey: 'hung',
      name: 'Thiết kế bản vẽ thi công tầng hầm + 7 tầng nổi',
      start_offset: -45, end_offset: -30, progress: 100, status: 'completed', priority: 'high',
      results: 'Hồ sơ thiết kế kết cấu bê tông M300 đã được kiến trúc sư thẩm định.',
    });
    tierItems.push(t.item);
  }

  const b1_2 = makeBundle({
    projectId: p.id, phaseId: ph1.id, ownerKey: 'cuong', dept: 'KTTC',
    desc: 'Lập dự toán tổng mức đầu tư & Kế hoạch ngân sách',
    start_offset: -55, due_offset: -25, status: 'closed', progress: 100, priority: 'high',
  });
  b1_2.item.id = b1_2.id;
  tierItems.push(b1_2.item);
  {
    const t = makeTask({
      bundleId: b1_2.id, projectId: p.id, dept: 'KTTC', assigneeKey: 'nguyet',
      name: 'Khảo sát báo giá sắt thép Hòa Phát, bê tông M300',
      start_offset: -55, end_offset: -40, progress: 100, status: 'completed',
      results: 'Chốt hợp đồng nguyên tắc nhà cung cấp bê tông Việt Hàn.',
    });
    tierItems.push(t.item);
  }

  // Phase 2 (in_progress)
  const ph2 = makePhase(p.id, 2, 'Thi công móng & Kết cấu phần thô', 'in_progress', -25, 45);
  ph2.item.id = ph2.id;
  tierItems.push(ph2.item);

  const b1_3 = makeBundle({
    projectId: p.id, phaseId: ph2.id, ownerKey: 'thanh', dept: 'TC',
    desc: 'Giám sát ép cọc D400 & Thi công móng tầng hầm',
    start_offset: -25, due_offset: 15, status: 'in_progress', progress: 75, priority: 'high',
  });
  b1_3.item.id = b1_3.id;
  tierItems.push(b1_3.item);

  const t1_1 = makeTask({
    bundleId: b1_3.id, projectId: p.id, dept: 'TC', assigneeKey: 'thanh',
    name: 'Giám sát thi công ép 48 cọc bê tông D400 sâu 22m',
    start_offset: -25, end_offset: -10, progress: 100, status: 'completed', priority: 'high',
    results: '100% cọc ép đạt tải trọng thiết kế Pmax = 120 tấn.',
  });
  tierItems.push(t1_1.item);

  const t1_2 = makeTask({
    bundleId: b1_3.id, projectId: p.id, dept: 'TC', assigneeKey: 'ngoc',
    name: 'Thi công cốt thép dầm móng & Đổ bê tông móng băng',
    start_offset: -10, end_offset: 10, progress: 80, status: 'in_progress', priority: 'high',
    results: 'Đã hoàn thành 80% khối lượng bê tông móng băng và hầm.',
  });
  tierItems.push(t1_2.item);

  const sub1_1 = makeSubTask({
    taskId: t1_2.id, assigneeKey: 'ngoc',
    name: 'Gia công cốt thép dầm móng D18/D22',
    start_offset: -10, end_offset: -2, progress: 100, status: 'completed', priority: 'high',
    results: 'Nghiệm thu thép móng đạt khoảng cách đai 150mm.',
  });
  subtasks.push(sub1_1);
  dailyLogs.push(
    makeDailyLog({ subtaskId: sub1_1.id, userKey: 'ngoc', days_offset: -8, desc: 'Kiểm tra mật độ đai thép dầm móng D18, khoảng cách 150mm.', result: 'Đạt tiêu chuẩn TCVN', obstacle: 'Không', progress: 50 }),
    makeDailyLog({ subtaskId: sub1_1.id, userKey: 'ngoc', days_offset: -3, desc: 'Hoàn thành buộc thép dầm móng khung trục A-D. Chờ CĐT nghiệm thu.', result: 'Ký biên bản nghiệm thu chuyển bước', obstacle: 'Mưa nhẹ buổi sáng', progress: 100 }),
  );

  const sub1_2 = makeSubTask({
    taskId: t1_2.id, assigneeKey: 'ngoc',
    name: 'Đổ 350m³ bê tông thương phẩm M300 móng & Sàn hầm',
    start_offset: -2, end_offset: 5, progress: 75, status: 'in_progress', priority: 'high',
  });
  subtasks.push(sub1_2);
  dailyLogs.push(
    makeDailyLog({ subtaskId: sub1_2.id, userKey: 'ngoc', days_offset: -2, desc: 'Đổ đợt 1 được 200m³ bê tông móng băng. Lấy 6 mẫu thử nén.', result: 'Bê tông đầm kỹ, không rỗ mặt', obstacle: 'Không', progress: 50 }),
    makeDailyLog({ subtaskId: sub1_2.id, userKey: 'ngoc', days_offset: 0, desc: 'Đổ tiếp đợt 2 được 100m³ bê tông sàn hầm. Thời tiết thuận lợi.', result: 'Tiến độ đúng kế hoạch', obstacle: 'Không', progress: 75 }),
  );

  const b1_4 = makeBundle({
    projectId: p.id, phaseId: ph2.id, ownerKey: 'hung', dept: 'QLDA',
    desc: 'Quản lý nhà thầu phụ & Cung ứng vật tư móng',
    start_offset: -20, due_offset: 20, status: 'in_progress', progress: 60, priority: 'high', collab_depts: ['KTTC'],
  });
  b1_4.item.id = b1_4.id;
  tierItems.push(b1_4.item);
  {
    const t = makeTask({
      bundleId: b1_4.id, projectId: p.id, dept: 'QLDA', assigneeKey: 'hong',
      name: 'Theo dõi tiến độ cung ứng sắt thép Hòa Phát đợt 1',
      start_offset: -15, end_offset: 10, progress: 65, status: 'in_progress', priority: 'medium',
      results: 'Đã nhập kho 45 tấn thép D10-D25 đạt chứng chỉ CO/CQ.',
    });
    tierItems.push(t.item);
  }

  const b1_5 = makeBundle({
    projectId: p.id, phaseId: ph2.id, ownerKey: 'cuong', dept: 'KTTC',
    desc: 'Thanh toán tiến độ & Kiểm soát ngân sách thi công đợt 1',
    start_offset: -10, due_offset: 25, status: 'in_progress', progress: 50, priority: 'high',
  });
  b1_5.item.id = b1_5.id;
  tierItems.push(b1_5.item);
  {
    const t = makeTask({
      bundleId: b1_5.id, projectId: p.id, dept: 'KTTC', assigneeKey: 'hang',
      name: 'Thanh toán đợt 1 cho đội thi công ép cọc & làm móng',
      start_offset: -10, end_offset: 2, progress: 80, status: 'in_progress', priority: 'high',
      notes: 'Đã giải ngân 420 triệu tiền ép cọc.',
    });
    tierItems.push(t.item);
  }

  // Phase 3 & 4
  const ph3 = makePhase(p.id, 3, 'Thi công hoàn thiện & Hệ thống M&E', 'pending', 45, 100);
  ph3.item.id = ph3.id;
  tierItems.push(ph3.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph3.id, ownerKey: 'thanh', dept: 'TC',
      desc: 'Thi công hệ thống Điện nước M&E & PCCC âm tường',
      start_offset: 45, due_offset: 90, status: 'assigned', progress: 0, priority: 'medium',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
  }
  const ph4 = makePhase(p.id, 4, 'Nghiệm thu PCCC & Bàn giao quyết toán', 'pending', 100, 120);
  ph4.item.id = ph4.id;
  tierItems.push(ph4.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph4.id, ownerKey: 'cuong', dept: 'KTTC',
      desc: 'Hồ sơ quyết toán công trình & Bàn giao CĐT',
      start_offset: 105, due_offset: 120, status: 'assigned', progress: 0, priority: 'high',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
  }
}

// -----------------------------------------------------------------------
// 2. DỰ ÁN 2: DA-BT-002 — Biệt thự Vinhomes Riverside (Đang duyệt)
// -----------------------------------------------------------------------
{
  const p = makeProject(
    'DA-BT-002',
    'Biệt thự Tân cổ điển 3 tầng Vinhomes Riverside',
    'Thiết kế & Thi công hoàn thiện trọn gói biệt thự đơn lập 3 tầng, 380m² sàn. CĐT: Bà Lê Thị Hoa.',
    'Bằng Lăng 5-12, Vinhomes Riverside, Long Biên, Hà Nội',
    'nam',
    -20,
    90,
    'in_progress',
    6_800_000_000,
    'Tổng thể T10 – T12/2026',
  );
  p.item.id = p.id;
  tierItems.push(p.item);
  history.push(makeHistory('project', p.id, `Tạo dự án "${p.item.title}"`, 'nam'));

  const ph1 = makePhase(p.id, 1, 'Thiết kế 3D Nội thất & Xin phép cải tạo', 'in_progress', -20, 10);
  ph1.item.id = ph1.id;
  tierItems.push(ph1.item);

  const b2_1 = makeBundle({
    projectId: p.id, phaseId: ph1.id, ownerKey: 'hung', dept: 'QLDA',
    desc: 'Chốt phương án 3D Kiến trúc & Mẫu vật liệu cao cấp',
    start_offset: -20, due_offset: 5, status: 'in_progress', progress: 85, priority: 'high',
  });
  b2_1.item.id = b2_1.id;
  tierItems.push(b2_1.item);

  const t2_1 = makeTask({
    bundleId: b2_1.id, projectId: p.id, dept: 'QLDA', assigneeKey: 'hong',
    name: 'Phối cảnh 3D ngoại thất phong cách Tân cổ điển',
    start_offset: -20, end_offset: -5, progress: 100, status: 'completed', priority: 'high',
    results: 'Chủ nhà đã phê duyệt bản vẽ thiết kế 3D ngoại thất.',
  });
  tierItems.push(t2_1.item);

  const t2_2 = makeTask({
    bundleId: b2_1.id, projectId: p.id, dept: 'QLDA', assigneeKey: 'hung',
    name: 'Duyệt bản vẽ chi tiết điện nước M&E với gia chủ',
    start_offset: -10, end_offset: 5, progress: 75, status: 'in_progress', priority: 'high',
  });
  tierItems.push(t2_2.item);

  const sub2_1 = makeSubTask({
    taskId: t2_2.id, assigneeKey: 'hong',
    name: 'Trình duyệt mẫu đá Marble Calacatta & Gỗ Óc chó',
    start_offset: -8, end_offset: 0, progress: 90, status: 'in_progress', priority: 'high',
  });
  subtasks.push(sub2_1);
  dailyLogs.push(
    makeDailyLog({ subtaskId: sub2_1.id, userKey: 'hong', days_offset: -3, desc: 'Cùng CĐT xem 5 mẫu đá Marble tại kho Long Biên.', result: 'CĐT chốt mẫu đá vân mây M-08', obstacle: 'Không', progress: 70 }),
    makeDailyLog({ subtaskId: sub2_1.id, userKey: 'hong', days_offset: 0, desc: 'Trình bảng màu sơn Dulux & Mẫu gỗ Óc chó lát sàn.', result: 'CĐT đã ký xác nhận mẫu vật liệu', obstacle: 'Không', progress: 90 }),
  );

  const b2_2 = makeBundle({
    projectId: p.id, phaseId: ph1.id, ownerKey: 'cuong', dept: 'KTTC',
    desc: 'Lập dự toán thi công trọn gói biệt thự',
    start_offset: -15, due_offset: 10, status: 'in_progress', progress: 80, priority: 'medium',
  });
  b2_2.item.id = b2_2.id;
  tierItems.push(b2_2.item);
  {
    const t = makeTask({
      bundleId: b2_2.id, projectId: p.id, dept: 'KTTC', assigneeKey: 'nguyet',
      name: 'Báo giá thiết bị vệ sinh Kohler & Hệ thống điện thông minh',
      start_offset: -15, end_offset: -2, progress: 100, status: 'completed',
      results: 'Đã nhận báo giá chiết khấu 25% từ đại lý Kohler chính hãng.',
    });
    tierItems.push(t.item);
  }

  const ph2 = makePhase(p.id, 2, 'Tháo dỡ & Thi công ép cọc móng', 'pending', 10, 40);
  ph2.item.id = ph2.id;
  tierItems.push(ph2.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph2.id, ownerKey: 'thanh', dept: 'TC',
      desc: 'Giám sát tháo dỡ & Đào móng ép cọc nhồi D300',
      start_offset: 10, due_offset: 35, status: 'assigned', progress: 0, priority: 'high',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
  }
}

// -----------------------------------------------------------------------
// 3. DỰ ÁN 3: DA-KXS-003 — Kho xưởng Bắc Ninh (ĐÃ HOÀN THÀNH)
// -----------------------------------------------------------------------
{
  const p = makeProject(
    'DA-KXS-003',
    'Nhà máy & Kho xưởng công nghiệp 2000m² Bắc Ninh',
    'Xây dựng kho xưởng khung thép tiền chế 2000m², sàn bê tông chịu lực 5 tấn/m². Đã bàn giao.',
    'KCN Tiên Sơn, Tiên Du, Bắc Ninh',
    'khanh',
    -150,
    -10,
    'completed',
    18_500_000_000,
    'Hoàn thành T08/2026',
  );
  p.item.id = p.id;
  tierItems.push(p.item);
  history.push(makeHistory('project', p.id, `Tạo dự án "${p.item.title}"`, 'khanh'));

  const ph3_1 = makePhase(p.id, 1, 'Pháp lý KCN & Thiết kế nhà thép', 'completed', -150, -110);
  ph3_1.item.id = ph3_1.id;
  tierItems.push(ph3_1.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph3_1.id, ownerKey: 'hung', dept: 'QLDA',
      desc: 'Xin phép xây dựng KCN & Thẩm định PCCC nhà xưởng',
      start_offset: -150, due_offset: -115, status: 'closed', progress: 100, priority: 'high',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
    const t = makeTask({
      bundleId: b.id, projectId: p.id, dept: 'QLDA', assigneeKey: 'hung',
      name: 'Khảo sát địa chất & Nộp hồ sơ BQL KCN Bắc Ninh',
      start_offset: -150, end_offset: -115, progress: 100, status: 'completed',
      results: 'Đã nhận Giấy phép xây dựng số 48/GPXD-BQL.',
    });
    tierItems.push(t.item);
  }

  const ph3_2 = makePhase(p.id, 2, 'Thi công kết cấu khung thép & Lợp mái', 'completed', -110, -40);
  ph3_2.item.id = ph3_2.id;
  tierItems.push(ph3_2.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph3_2.id, ownerKey: 'thanh', dept: 'TC',
      desc: 'Gia công 160 tấn khung thép & Lợp tôn PE Kliplok',
      start_offset: -110, due_offset: -45, status: 'closed', progress: 100, priority: 'high',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
    const t = makeTask({
      bundleId: b.id, projectId: p.id, dept: 'TC', assigneeKey: 'ngoc',
      name: 'Lắp dựng khung nhà thép bằng cẩu 50 tấn',
      start_offset: -100, end_offset: -60, progress: 100, status: 'completed',
      results: 'Lắp dựng 12 vì kèo thép an toàn tuyệt đối.',
    });
    tierItems.push(t.item);
  }

  const ph3_3 = makePhase(p.id, 3, 'Bê tông nền xưởng & Hệ thống PCCC', 'completed', -40, -15);
  ph3_3.item.id = ph3_3.id;
  tierItems.push(ph3_3.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph3_3.id, ownerKey: 'thanh', dept: 'TC',
      desc: 'Đổ bê tông nền xưởng 2000m² xoa Sika Green & PCCC',
      start_offset: -40, due_offset: -18, status: 'closed', progress: 100, priority: 'high',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
    const t3_1 = makeTask({
      bundleId: b.id, projectId: p.id, dept: 'TC', assigneeKey: 'ngoc',
      name: 'Đổ bê tông tươi M300 dày 200mm & Xoa nền tăng cứng',
      start_offset: -38, end_offset: -20, progress: 100, status: 'completed', priority: 'high',
    });
    tierItems.push(t3_1.item);
    const sub3_1 = makeSubTask({
      taskId: t3_1.id, assigneeKey: 'ngoc',
      name: 'Xoa nền đánh bóng Sika Green 2000m²',
      start_offset: -35, end_offset: -20, progress: 100, status: 'completed',
    });
    subtasks.push(sub3_1);
    dailyLogs.push(
      makeDailyLog({ subtaskId: sub3_1.id, userKey: 'ngoc', days_offset: -30, desc: 'Đổ 400m³ bê tông nền. Đội xoa nền làm việc liên tục 14 tiếng.', result: 'Mặt nền phẳng bóng, không nứt nẻ', obstacle: 'Không', progress: 100 }),
    );
  }

  const ph3_4 = makePhase(p.id, 4, 'Nghiệm thu bàn giao & Quyết toán', 'completed', -15, -10);
  ph3_4.item.id = ph3_4.id;
  tierItems.push(ph3_4.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph3_4.id, ownerKey: 'cuong', dept: 'KTTC',
      desc: 'Quyết toán công trình & Thanh lý hợp đồng',
      start_offset: -15, due_offset: -5, status: 'closed', progress: 100, priority: 'high',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
    const t = makeTask({
      bundleId: b.id, projectId: p.id, dept: 'KTTC', assigneeKey: 'cuong',
      name: 'Nghiệm thu bàn giao đưa nhà xưởng vào hoạt động',
      start_offset: -12, end_offset: -5, progress: 100, status: 'completed',
      results: 'Đã nghiệm thu PCCC và thu hồi 100% công nợ 18.35 tỷ.',
    });
    tierItems.push(t.item);
  }
}

// -----------------------------------------------------------------------
// 4. DỰ ÁN 4: DA-SCL-004 — Cải tạo VP Techcombank (Khẩn, đang thi công)
// -----------------------------------------------------------------------
{
  const p = makeProject(
    'DA-SCL-004',
    'Cải tạo & Sửa chữa nâng cấp Trụ sở VP Techcom',
    'Cải tạo 3 tầng văn phòng làm việc 650m², thi công trần thạch cao, vách kính & M&E.',
    '18 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội',
    'nam',
    -25,
    25,
    'in_progress',
    3_200_000_000,
    'T10/2026 – T11/2026 (Khẩn)',
  );
  p.item.id = p.id;
  tierItems.push(p.item);
  history.push(makeHistory('project', p.id, `Tạo dự án "${p.item.title}"`, 'nam'));

  const ph4_1 = makePhase(p.id, 1, 'Tháo dỡ & Cải tạo mặt bằng cũ', 'completed', -25, -10);
  ph4_1.item.id = ph4_1.id;
  tierItems.push(ph4_1.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph4_1.id, ownerKey: 'thanh', dept: 'TC',
      desc: 'Tháo dỡ trần cũ & Đập phá tường nới rộng phòng họp',
      start_offset: -25, due_offset: -12, status: 'closed', progress: 100, priority: 'high',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
    const t = makeTask({
      bundleId: b.id, projectId: p.id, dept: 'TC', assigneeKey: 'ngoc',
      name: 'Giám sát tháo dỡ nội thất cũ & Dọn dẹp phế thải',
      start_offset: -25, end_offset: -12, progress: 100, status: 'completed',
      results: 'Đã vận chuyển 14 chuyến xe phế thải rời khỏi công trường.',
    });
    tierItems.push(t.item);
  }

  const ph4_2 = makePhase(p.id, 2, 'Thi công Trần thạch cao, Vách kính & M&E', 'in_progress', -10, 15);
  ph4_2.item.id = ph4_2.id;
  tierItems.push(ph4_2.item);

  const b4_2 = makeBundle({
    projectId: p.id, phaseId: ph4_2.id, ownerKey: 'thanh', dept: 'TC',
    desc: 'Thi công trần thạch cao Vĩnh Tường & M&E âm trần',
    start_offset: -10, due_offset: 10, status: 'in_progress', progress: 75, priority: 'high',
  });
  b4_2.item.id = b4_2.id;
  tierItems.push(b4_2.item);

  const t4_1 = makeTask({
    bundleId: b4_2.id, projectId: p.id, dept: 'TC', assigneeKey: 'thanh',
    name: 'Đi dây điện Cadivi, Dây mạng Cat6 & Ống điều hòa âm trần',
    start_offset: -10, end_offset: -2, progress: 100, status: 'completed', priority: 'high',
    results: 'Đã đo đạc thử áp lực đường ống đồng đạt 350 PSI.',
  });
  tierItems.push(t4_1.item);

  const t4_2 = makeTask({
    bundleId: b4_2.id, projectId: p.id, dept: 'TC', assigneeKey: 'ngoc',
    name: 'Bắn tấm thạch cao Gyproc chống ẩm & Trét bột sơn Dulux',
    start_offset: -2, end_offset: 10, progress: 65, status: 'in_progress', priority: 'high',
  });
  tierItems.push(t4_2.item);

  const sub4_1 = makeSubTask({
    taskId: t4_2.id, assigneeKey: 'ngoc',
    name: 'Bắn 650m² tấm thạch cao khu VP làm việc',
    start_offset: -2, end_offset: 5, progress: 70, status: 'in_progress', priority: 'high',
  });
  subtasks.push(sub4_1);
  dailyLogs.push(
    makeDailyLog({ subtaskId: sub4_1.id, userKey: 'ngoc', days_offset: -2, desc: 'Đóng khung xương sắt nẹp Vĩnh Tường tầng 2.', result: 'Khung xương phẳng, chắc chắn', obstacle: 'Không', progress: 40 }),
    makeDailyLog({ subtaskId: sub4_1.id, userKey: 'ngoc', days_offset: 0, desc: 'Bắn xong 450m² tấm thạch cao chống ẩm. Xử lý mối nối.', result: 'Bề mặt trần phẳng đẹp', obstacle: 'Không', progress: 70 }),
  );

  const b4_3 = makeBundle({
    projectId: p.id, phaseId: ph4_2.id, ownerKey: 'hung', dept: 'QLDA',
    desc: 'Cung cấp & Lắp đặt vách kính cường lực 12mm',
    start_offset: -8, due_offset: 12, status: 'in_progress', progress: 60, priority: 'medium',
  });
  b4_3.item.id = b4_3.id;
  tierItems.push(b4_3.item);

  const t4_3 = makeTask({
    bundleId: b4_3.id, projectId: p.id, dept: 'QLDA', assigneeKey: 'hong',
    name: 'Lắp đặt 180m² vách kính cường lực & Cửa thủy lực',
    start_offset: -5, end_offset: 8, progress: 60, status: 'in_progress',
  });
  tierItems.push(t4_3.item);

  const sub4_2 = makeSubTask({
    taskId: t4_3.id, assigneeKey: 'hong',
    name: 'Lắp vách kính phòng họp & Phòng Giám đốc',
    start_offset: -1, end_offset: 8, progress: 40, status: 'in_progress',
  });
  subtasks.push(sub4_2);
  dailyLogs.push(
    makeDailyLog({ subtaskId: sub4_2.id, userKey: 'hong', days_offset: -1, desc: 'Tập kết 24 tấm kính cường lực 12mm lên tầng 3.', result: 'Đã định vị 6 ô kính phòng họp', obstacle: 'Không', progress: 40 }),
  );

  const ph4_3 = makePhase(p.id, 3, 'Lắp đặt nội thất VP & Bàn giao', 'pending', 15, 25);
  ph4_3.item.id = ph4_3.id;
  tierItems.push(ph4_3.item);
  {
    const b = makeBundle({
      projectId: p.id, phaseId: ph4_3.id, ownerKey: 'cuong', dept: 'KTTC',
      desc: 'Nghiệm thu bàn giao & Thanh toán quyết toán',
      start_offset: 15, due_offset: 25, status: 'assigned', progress: 0, priority: 'high',
    });
    b.item.id = b.id;
    tierItems.push(b.item);
  }
}

// ===========================================================================
// === TÍNH LẠI TIẾN ĐỘ CỘNG DỒN (Recalculate Progress) =====================
// ===========================================================================

// 1. task progress = mean(subtasks.progress)
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

// Tính activeTasks / workload cho mỗi user từ tasks + subtasks
const userTaskCounts = new Map<string, { active: number; total: number }>();
const byUser = new Map<string, TierItem[]>();
for (const item of tierItems) {
  if (item.tier !== 4 || !item.ownerUsername) continue;
  if (!byUser.has(item.ownerUsername)) byUser.set(item.ownerUsername, []);
  byUser.get(item.ownerUsername)!.push(item);
}
for (const [username, items] of byUser.entries()) {
  const active = items.filter((i) => i.progress < 100 && i.progress >= 0).length;
  userTaskCounts.set(username, { active, total: items.length });
}

const teamMembers: TeamMember[] = (['khanh', 'nam', 'hung', 'hong', 'cuong', 'nguyet', 'hang', 'tu', 'thanh', 'ngoc'] as const)
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

// Team lead tasks (cho view "Giao việc Nhóm"): mỗi task in_progress / pending_approval / need_help
const teamLeadTasks: TeamLeadTask[] = tierItems
  .filter((t) => t.tier === 4 && (t.progress < 100))
  .slice(0, 12)
  .map((t) => {
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

// Employee tasks: các task giao cho NV (hong, nguyet, hang, tu, ngoc)
const employeeTasks: EmployeeTask[] = tierItems
  .filter((t) => t.tier === 4 && t.ownerUsername && ['hong', 'nguyet', 'hang', 'tu', 'ngoc'].includes(t.ownerUsername))
  .slice(0, 10)
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
      t.status === 'Đã xong' ? 'done' : t.status === 'Đang làm' ? 'doing' : 'pending',
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