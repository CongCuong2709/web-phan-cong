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
const idProject     = () => `proj-${++__projectSeq}`;
const idDeliverable = () => `del-${++__deliverableSeq}`;
const idPhase       = () => `phase-${++__phaseSeq}`;

// FIX #3 / #4: trả về { id, seq } để code dùng cùng số, không tăng counter lần 2
const idBundle = (): { id: string; seq: number } => {
  const seq = ++__bundleSeq;
  return { id: `bundle-${seq}`, seq };
};
const idTask = (): { id: string; seq: number } => {
  const seq = ++__taskSeq;
  return { id: `task-${seq}`, seq };
};

const idSub     = () => `sub-${++__subtaskSeq}`;
const idLog     = () => `log-${++__logSeq}`;
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
  admin:  { id: 'u-001', username: 'admin',  fullname: 'Quản trị hệ thống', role: 'admin',    departments: ['ĐH', 'QLDA', 'KTTC', 'TC'] },
  khanh:  { id: 'u-002', username: 'khanh',  fullname: 'Khánh — Điều hành', role: 'director', departments: ['ĐH'] },
  nam:    { id: 'u-003', username: 'nam',    fullname: 'Nam — Điều hành',   role: 'director', departments: ['ĐH'] },
  hung:   { id: 'u-004', username: 'hung',   fullname: 'Hùng — TP.QLDA',   role: 'manager',  departments: ['QLDA'] },
  hong:   { id: 'u-005', username: 'hong',   fullname: 'Hồng — NV.QLDA',   role: 'employee', departments: ['QLDA'] },
  cuong:  { id: 'u-006', username: 'cuong',  fullname: 'Cường — TP.KTTC',  role: 'manager',  departments: ['KTTC'] },
  nguyet: { id: 'u-007', username: 'nguyet', fullname: 'Nguyệt — NV.KTTC', role: 'employee', departments: ['KTTC'] },
  hang:   { id: 'u-008', username: 'hang',   fullname: 'Hằng — NV.KTTC',   role: 'employee', departments: ['KTTC'] },
  tu:     { id: 'u-009', username: 'tu',     fullname: 'Tú — NV.KTTC',     role: 'employee', departments: ['KTTC'] },
  thanh:  { id: 'u-010', username: 'thanh',  fullname: 'Thành — TP.TC',    role: 'manager',  departments: ['TC'] },
  ngoc:   { id: 'u-011', username: 'ngoc',   fullname: 'Ngọc — NV.TC',     role: 'employee', departments: ['TC'] },
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
        { id: idDeliverable(), title: 'Hồ sơ quyết toán đã phê duyệt',     completed: status === 'completed' },
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
        endWeek:   Math.max(1, Math.min(4, 1 + (e_offset + 60) / 60)),
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
        { id: idDeliverable(), title: `Hoàn tất gói "${opts.desc}"`, completed: opts.status === 'closed' },
      ],
      managementNotes:
        opts.collab_depts && opts.collab_depts.length
          ? `Phối hợp: ${opts.collab_depts.join(', ')}.`
          : 'Gói việc độc lập.',
      gantt: {
        startWeek: Math.max(1, Math.min(4, 1 + (opts.start_offset + 60) / 60)),
        endWeek:   Math.max(1, Math.min(4, 1 + (opts.due_offset   + 60) / 60)),
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
        endWeek:   Math.max(1, Math.min(4, 1 + (opts.end_offset   + 60) / 60)),
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
// DỰ ÁN: Nhà ở Xã hội khu Bắc Ninh (DA-NOTX-001)
// Chủ trì theo từng task: QLDA → hong, KTTC → nguyet/hang/tu, TC → ngoc.
// -----------------------------------------------------------------------
{
  // FIX #2 + #7: makeProject tự set item.id → không cần p.item.id = p.id
  const p = makeProject(
    'DA-NOTX-001',
    'Nhà ở Xã hội khu Bắc Ninh',
    'Dự án nhà ở xã hội phục vụ công nhân và người thu nhập thấp tại khu Bắc Ninh.',
    'Khu Bắc Ninh, TP. Bắc Ninh',
    'khanh',
    -10, 55,
    'in_progress',
    250_000_000_000,
    'Q4/2026 - Q1/2027',
  );
  tierItems.push(p.item);
  history.push(makeHistory('project', p.id, `Tạo dự án "${p.item.title}"`, 'khanh'));

  // Helper: T2 + 1 T3 wrapper + N T4 tasks trong cùng phase.
  // FIX #5 + #7: builder tự set id; subtask & dailyLog được tạo cho mọi task có progress > 0
  const addPhase = (
    seq: number,
    title: string,
    bundleDesc: string,
    ownerKey: keyof typeof U,
    dept: Department,
    s: number, e: number,
    tasks: Array<{
      name: string; results: string;
      assigneeKey: keyof typeof U;
      s: number; e: number;
      progress: number; status: TaskStatus;
    }>,
  ) => {
    const ph = makePhase(p.id, seq, title, 'in_progress', s, e);
    // Chỉ override owner/department cho phase — item.id đã được set bởi makePhase
    ph.item.owner = { name: U[ownerKey].fullname, role: `TP.${dept}`, initial: U[ownerKey].fullname.charAt(0) };
    ph.item.ownerUsername = ownerKey;
    ph.item.department = dept;
    tierItems.push(ph.item);

    const b = makeBundle({
      projectId: p.id, phaseId: ph.id, ownerKey, dept,
      desc: bundleDesc,
      start_offset: s, due_offset: e,
      status: 'in_progress', progress: 0, priority: 'high',
    });
    tierItems.push(b.item);

    for (const t of tasks) {
      const task = makeTask({
        bundleId: b.id, projectId: p.id, dept,
        assigneeKey: t.assigneeKey, name: t.name,
        start_offset: t.s, end_offset: t.e,
        progress: t.progress, status: t.status, priority: 'high',
        results: t.results,
      });
      tierItems.push(task.item);

      // FIX #5: tạo subtask thực cho mọi task có progress > 0
      if (t.progress > 0) {
        const sub = makeSubTask({
          taskId: task.id,
          assigneeKey: t.assigneeKey,
          name: `Chi tiết: ${t.name}`,
          start_offset: t.s,
          end_offset: t.e,
          progress: t.progress,
          status: t.status,
          priority: 'high',
          results: t.results,
        });
        subtasks.push(sub);

        // Daily logs tương ứng theo trạng thái task
        if (t.status === 'in_progress') {
          dailyLogs.push(makeDailyLog({
            subtaskId: sub.id,
            userKey: t.assigneeKey,
            days_offset: -1,
            desc: `Cập nhật tiến độ: ${t.name}`,
            result: `Hoàn thành ${t.progress}% khối lượng`,
            progress: t.progress,
          }));
          dailyLogs.push(makeDailyLog({
            subtaskId: sub.id,
            userKey: t.assigneeKey,
            days_offset: 0,
            desc: `Tiếp tục triển khai: ${t.name}`,
            result: 'Đang tiến hành, dự kiến đúng tiến độ',
            progress: t.progress,
          }));
        } else if (t.status === 'completed') {
          dailyLogs.push(makeDailyLog({
            subtaskId: sub.id,
            userKey: t.assigneeKey,
            days_offset: t.e,
            desc: `Hoàn thành: ${t.name}`,
            result: t.results,
            progress: 100,
          }));
        }
      }
    }
  };

  // === GIAI ĐOẠN 1: THIẾT KẾ VÀ HOÀN THIỆN PHÁP LÝ XÂY DỰNG ===
  addPhase(1, 'Giai đoạn 1: THIẾT KẾ VÀ HOÀN THIỆN PHÁP LÝ XÂY DỰNG',
    'Khảo sát, thiết kế, thẩm tra và phê duyệt dự toán', 'hung', 'QLDA',
    -5, 15,
    [
      { name: '1.1 Khảo sát địa chất, địa hình bổ sung',                                                    assigneeKey: 'hong', s: -10, e:  -3, progress: 100, status: 'completed',   results: 'Báo cáo khảo sát đã nghiệm thu' },
      { name: '1.2 Lập nhiệm vụ thiết kế, yêu cầu kỹ thuật, tiêu chuẩn vật liệu',                         assigneeKey: 'hong', s:  -5, e:   5, progress:  60, status: 'in_progress', results: 'Nhiệm vụ thiết kế được duyệt' },
      { name: '1.3 Thiết kế kỹ thuật / bản vẽ thi công (kiến trúc, kết cấu, MEP, PCCC, hạ tầng)',        assigneeKey: 'hong', s:   0, e:  10, progress:  30, status: 'in_progress', results: 'Bộ hồ sơ thiết kế' },
      { name: '1.4 Thẩm tra thiết kế, dự toán',                                                             assigneeKey: 'hong', s:   5, e:  12, progress:   0, status: 'not_started', results: 'Báo cáo thẩm tra' },
      { name: '1.5 Lập và phê duyệt dự toán, tổng mức đầu tư điều chỉnh',                                 assigneeKey: 'hong', s:   8, e:  15, progress:   0, status: 'not_started', results: 'Dự toán được duyệt, làm giá gói thầu' },
    ],
  );

  // === GIAI ĐOẠN 2: LỰA CHỌN NHÀ THẦU VÀ KÝ HỢP ĐỒNG ===
  addPhase(2, 'Giai đoạn 2: LỰA CHỌN NHÀ THẦU VÀ KÝ HỢP ĐỒNG',
    'Phân chia gói thầu, mời thầu, đánh giá, ký hợp đồng', 'hung', 'QLDA',
    10, 30,
    [
      { name: '2.1 Lập kế hoạch phân chia gói thầu',                           assigneeKey: 'hong',   s: 10, e: 15, progress: 0, status: 'not_started', results: 'Kế hoạch lựa chọn nhà thầu' },
      { name: '2.2 Lập hồ sơ mời thầu / yêu cầu báo giá',                     assigneeKey: 'hong',   s: 12, e: 20, progress: 0, status: 'not_started', results: 'HSMT được duyệt' },
      { name: '2.3 Tổ chức mời thầu, đánh giá hồ sơ dự thầu',                 assigneeKey: 'hong',   s: 18, e: 25, progress: 0, status: 'not_started', results: 'Báo cáo đánh giá' },
      { name: '2.4 Nhận bảo lãnh thực hiện hợp đồng, bảo lãnh tạm ứng',      assigneeKey: 'nguyet', s: 20, e: 27, progress: 0, status: 'not_started', results: 'Bảo lãnh hợp lệ' },
      { name: '2.5 Lập kế hoạch mua sắm vật tư, thiết bị do chủ đầu tư cấp', assigneeKey: 'hong',   s: 22, e: 30, progress: 0, status: 'not_started', results: 'Kế hoạch mua sắm và dòng tiền' },
    ],
  );

  // === GIAI ĐOẠN 3: CHUẨN BỊ KHỞI CÔNG ===
  addPhase(3, 'Giai đoạn 3: CHUẨN BỊ KHỞI CÔNG',
    'Bàn giao mặt bằng, tổ chức công trường, an toàn, bảo hiểm, tạm ứng', 'thanh', 'TC',
    25, 55,
    [
      { name: '3.1 Bàn giao mặt bằng, mốc định vị, cao độ cho nhà thầu',                               assigneeKey: 'ngoc', s: 25, e: 28, progress: 0, status: 'not_started', results: 'Biên bản bàn giao mặt bằng' },
      { name: '3.2 Thành lập Ban Chỉ huy công trường, quy chế phối hợp CĐT – TVGS – nhà thầu',         assigneeKey: 'ngoc', s: 25, e: 30, progress: 0, status: 'not_started', results: 'Sơ đồ tổ chức công trường, quy chế' },
      { name: '3.3 Phê duyệt biện pháp thi công, tiến độ tổng thể và chi tiết',                        assigneeKey: 'ngoc', s: 28, e: 38, progress: 0, status: 'not_started', results: 'Biện pháp và tiến độ được duyệt' },
      { name: '3.4 Kế hoạch an toàn lao động, vệ sinh môi trường, PCCC công trường',                   assigneeKey: 'ngoc', s: 30, e: 40, progress: 0, status: 'not_started', results: 'Kế hoạch ATLĐ – VSMT' },
      { name: '3.5 Mua bảo hiểm công trình, bảo hiểm con người',                                       assigneeKey: 'hang', s: 30, e: 35, progress: 0, status: 'not_started', results: 'Hợp đồng bảo hiểm' },
      { name: '3.6 Chuẩn bị lán trại, điện nước thi công, hàng rào, biển báo',                        assigneeKey: 'ngoc', s: 32, e: 42, progress: 0, status: 'not_started', results: 'Công trường đủ điều kiện' },
      { name: '3.7 Lập quy trình quản lý hồ sơ chất lượng, biểu mẫu nghiệm thu',                     assigneeKey: 'hong', s: 35, e: 45, progress: 0, status: 'not_started', results: 'Bộ biểu mẫu thống nhất' },
      { name: '3.8 Tạm ứng hợp đồng',                                                                  assigneeKey: 'tu',   s: 40, e: 55, progress: 0, status: 'not_started', results: 'Chứng từ tạm ứng' },
    ],
  );
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

// D1 fix: tăng slice từ 12 → 20 để đảm bảo mọi phòng ban (đặc biệt TC) đều có
// task hiển thị trong view Trưởng phòng. Sắp xếp theo department để mỗi phòng
// ban được ưu tiên round-robin thay vì bị bỏ sót cuối danh sách.
const teamLeadTasks: TeamLeadTask[] = (() => {
  const candidates = tierItems
    .filter((t) => t.tier === 4 && t.progress < 100)
    .sort((a, b) => {
      // Ưu tiên round-robin theo department để TC/KTTC/QLDA đều có mặt.
      const order = (d?: string) =>
        d === 'TC' ? 0 : d === 'KTTC' ? 1 : d === 'QLDA' ? 2 : 3;
      return order(a.department) - order(b.department);
    })
    .slice(0, 20);
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

// D1 fix: tăng slice từ 10 → 16 để đảm bảo nhân viên TC (ngoc) có task hiển thị.
const employeeTasks: EmployeeTask[] = tierItems
  .filter((t) => t.tier === 4 && t.ownerUsername && ['hong', 'nguyet', 'hang', 'tu', 'ngoc'].includes(t.ownerUsername))
  .slice(0, 16)
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