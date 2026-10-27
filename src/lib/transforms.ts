/**
 * transforms.ts — Map backend API responses → frontend entity types.
 *
 * Backend (SQLite) trả về schema rút gọn (flat fields, key snake_case) trong
 * khi frontend dùng shape phong phú hơn (nested object, key camelCase).
 * Module này convert 1-1.
 *
 * Input type duy nhất: `TaskApiRowDto` (xem lib/apiClient.ts) — mô tả đúng
 * shape thật của `GET /api/tasks`. Không dùng `any` ở đây: nếu backend đổi
 * tên cột, TypeScript báo lỗi compile thay vì lỗi runtime im lặng.
 *
 * Lưu ý: field nào frontend cần mà backend không trả sẽ fill bằng giá trị mặc
 * định để component render an toàn (vd `tierName`, `tierBadge`, `gantt`).
 */

import type {
  TierItem,
  TierLevel,
  TeamLeadTask,
  EmployeeTask,
  TeamMember,
  DailyLog,
  HistoryEntry,
} from '../types';
import type {
  TaskApiRowDto,
  TeamMemberDto,
  DailyLogRowDto,
  HistoryEntryDto,
} from './apiClient';

// ─────────────────────────────────────────────────────────────────────
// Tier item: backend → frontend
// ─────────────────────────────────────────────────────────────────────

const TIER_NAMES: Record<TierLevel, string> = {
  1: 'Tầng 1: Dự án',
  2: 'Tầng 2: Giai đoạn',
  3: 'Tầng 3: Hạng mục giao',
  4: 'Tầng 4: Đầu việc',
};

const TIER_BADGES: Record<TierLevel, string> = {
  1: 'DỰ ÁN T1',
  2: 'GIAI ĐOẠN T2',
  3: 'HẠNG MỤC T3',
  4: 'VIỆC T4',
};

/**
 * Build composite id dạng "<tier>-<numericId>".
 *
 * Tại sao cần: schema backend có 4 bảng (projects/phases/bundles/tasks), mỗi bảng
 * dùng sequence INTEGER riêng nên có thể có id=1 ở cả 4 tier. Nếu chỉ stringify
 * `api.id`, frontend thấy nhiều item cùng id="1" → khi walk cây cha-con
 * (Gantt4TangView.visit, App.tsx rollup, App.tsx walk-up) sẽ truy nhầm parent
 * và gây infinite recursion ("Maximum call stack size exceeded").
 *
 * Composite id fix bằng cách embed tier vào id → mỗi row backend có frontend id
 * phân biệt. Numeric id gốc vẫn truy ra được qua `extractBackendId()` khi cần gọi API.
 */
export function toCompositeId(tier: TierLevel, numericId: number | string): string {
  return `${tier}-${numericId}`;
}

/**
 * Trích numeric id từ composite id.
 * - "4-1" → 1
 * - "1"  → 1          (back-compat cho local id cũ)
 * - "tier-item-123" → NaN  (local-only id, không sync backend)
 * - undefined / ""   → NaN
 */
export function extractBackendId(id: string | number | null | undefined): number {
  if (id === null || id === undefined) return NaN;
  const s = String(id);
  const dash = s.indexOf('-');
  const tail = dash >= 0 ? s.slice(dash + 1) : s;
  const n = Number(tail);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Map 1 row từ `GET /api/tasks` → TierItem shape frontend.
 * start_date/end_date là source of truth; daysRemaining derive runtime.
 */
export function apiToTierItem(api: TaskApiRowDto): TierItem {
  const tier = api.tier;
  const ownerFullname = api.owner_fullname || '—';
  const department = api.department_code || undefined;
  const endDate = api.end_date ?? '';

  // daysRemaining: compute runtime từ endDate
  const daysRemaining = endDate ? computeDaysRemaining(endDate) : undefined;

  // parentId dùng composite id `<parentTier>-<parentNumericId>` để tránh nhầm
  // giữa các tier khi walk cây. Parent tier luôn = child.tier - 1:
  //   T2 → parent = T1, T3 → parent = T2, T4 → parent = T3.
  return {
    id: toCompositeId(tier, api.id),
    code: api.code,
    tier,
    tierName: TIER_NAMES[tier],
    tierBadge: TIER_BADGES[tier],
    title: api.title,
    // parentId composite để khớp với id của parent (vd "2-2" cho T3 con của T2.id=2)
    parentId:
      tier === 4 && api.bundle_id != null ? toCompositeId(3, api.bundle_id)
      : tier === 3 && api.phase_id != null ? toCompositeId(2, api.phase_id)
      : tier === 2 && api.project_id != null ? toCompositeId(1, api.project_id)
      : undefined,
    owner: {
      name: ownerFullname,
      role: department || '',
      initial: ownerFullname.charAt(0).toUpperCase(),
      avatar: undefined,
    },
    ownerUsername: api.owner_username_str ?? undefined,
    department: department as TierItem['department'],
    startDate: api.start_date ?? '',
    endDate,
    daysRemaining,
    progress: api.progress_rollup ?? api.progress ?? 0,
    status: statusEnumToVi(api.status),
    // Map priority từ enum sang tiếng Việt. Chỉ T4 có cột priority.
    priority: priorityEnumToVi(api.priority) as TierItem['priority'],
    description: api.description,
    managementNotes: api.management_notes ?? '',
    blockerAlert: api.blocker_alert ?? undefined,
    // 1 cột blocker_note (escalation NV ↔ Manager) — chỉ T4.
    blockerNote: api.blocker_note ?? '',
    // gantt.startWeek/endWeek derive runtime từ start_date/end_date — 1 nguồn sự thật.
    gantt: {
      startWeek: computeWeekFromDate(api.start_date),
      endWeek: computeWeekFromDate(api.end_date),
    },
  };
}

/**
 * Nhãn tiếng Việt ↔ enum status DB — 1:1, đúng 5 trạng thái của
 * backend/lib/stateMachine.js. Không thêm nhãn đồng nghĩa: mỗi trạng thái
 * chỉ có một tên trên toàn bộ UI.
 */
const STATUS_VI: Record<string, TierItem['status']> = {
  pending: 'Chuẩn bị',
  doing: 'Đang chạy',
  pending_approval: 'Chờ duyệt',
  blocked: 'Điểm nghẽn',
  done: 'Đã xong',
};

export const TIER_STATUS_OPTIONS = Object.values(STATUS_VI);

function statusEnumToVi(s: string | null | undefined): TierItem['status'] {
  return STATUS_VI[String(s)] ?? 'Chuẩn bị';
}

/**
 * Quá hạn = đã qua hạn chót mà CHƯA BÁO XONG. Việc "Chờ duyệt" không tính quá hạn
 * (nhân viên đã làm xong, phần chờ là của người duyệt) — cùng định nghĩa với
 * "Việc của tôi" và "Giao việc nhóm". Mục chưa đặt hạn không tính là quá hạn.
 */
export function isTierItemOverdue(i: Pick<TierItem, 'daysRemaining' | 'status'>): boolean {
  return i.daysRemaining !== undefined && i.daysRemaining < 0 && i.status !== 'Đã xong' && i.status !== 'Chờ duyệt';
}

/**
 * Tiến độ kế hoạch (%) theo thời gian: tỉ lệ số ngày đã qua trong khoảng
 * [startDate, endDate], tính cả 2 đầu. Chưa tới ngày bắt đầu → 0, quá hạn → 100.
 * Thiếu ngày → undefined (không so sánh được).
 */
export function expectedProgress(i: Pick<TierItem, 'startDate' | 'endDate'>, today = todayIso()): number | undefined {
  const toDay = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : NaN;
  };
  const start = toDay(i.startDate);
  const end = toDay(i.endDate);
  const now = toDay(today);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  if (now < start) return 0;
  if (now >= end) return 100;
  return Math.round(((now - start + 1) / (end - start + 1)) * 100);
}

export function viStatusToEnum(s: TierItem['status']): string {
  return Object.keys(STATUS_VI).find((k) => STATUS_VI[k] === s) ?? 'pending';
}

export function viPriorityToEnum(p: TierItem['priority'] | undefined): string {
  switch (p) {
    case 'Cao (Critical Path)': return 'critical';
    case 'Thấp': return 'low';
    default: return 'normal';
  }
}

/** Convert priority enum DB → Tiếng Việt. */
function priorityEnumToVi(p: string | null | undefined): string {
  switch (String(p)) {
    case 'critical':
    case 'high': return 'Cao (Critical Path)';
    case 'low': return 'Thấp';
    case 'normal':
    default: return 'Trung bình';
  }
}

/**
 * Tính số ngày còn lại từ hôm nay đến endDate.
 * endDate ở format ISO 'YYYY-MM-DD'.
 * Trả về số âm nếu quá hạn.
 */
function computeDaysRemaining(endDateIso: string): number {
  // Parse strict ISO date — tránh timezone issue.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDateIso);
  if (!m) return 0;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffMs = end.getTime() - now.getTime();
  return Math.round(diffMs / 86400000);
}

// ─────────────────────────────────────────────────────────────────────
// Team lead task
// ─────────────────────────────────────────────────────────────────────

export function apiToTeamLeadTask(api: TaskApiRowDto): TeamLeadTask {
  // Backend trả unified Task — chỉ có blocker_note (1 cột text) cho escalation.
  const statusMap: Record<string, TeamLeadTask['status']> = {
    'pending': 'not_started',
    'doing': 'in_progress',
    'done': 'done',
    'pending_approval': 'pending_approval',
    'blocked': 'need_help',
  };
  // Composite id (tier + numeric) để không nhầm với tier items ở tier khác.
  // TeamLeadTask hầu hết là T4, nhưng backend có thể trả tier lẫn lộn.
  const tier: TierLevel = api.tier;
  return {
    id: toCompositeId(tier, api.id),
    code: api.code,
    title: api.title,
    category: api.bundle_name ?? '',   // tên hạng mục cha (T3) do backend JOIN sẵn
    ownerName: api.owner_fullname ?? api.owner_username_str ?? '',
    ownerUsername: api.owner_username_str ?? undefined,
    department: (api.department_code ?? undefined) as TeamLeadTask['department'],
    submittedAt: api.created_at,
    updatedAt: api.updated_at,
    deadline: api.end_date ?? undefined,
    status: statusMap[api.status] ?? 'in_progress',
    priority: priorityEnumToVi(api.priority) as TeamLeadTask['priority'],
    blockerNote: api.blocker_note ?? '',
    needsHelp: api.status === 'blocked' || !!api.blocker_note?.trim(),
    progress: api.progress ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Employee task
// ─────────────────────────────────────────────────────────────────────

const EMPLOYEE_STATUSES: ReadonlyArray<EmployeeTask['status']> = [
  'pending', 'doing', 'pending_approval', 'blocked', 'done',
];

/**
 * Task T4 cho view "Việc của tôi". Status giữ nguyên enum DB — nhân viên
 * phải thấy đúng "Chờ duyệt" / "Đang vướng", không gộp về trạng thái khác.
 * currentDeliverable / progress hôm nay được gộp ở `buildEmployeeTasks`.
 */
export function apiToEmployeeTask(api: TaskApiRowDto): EmployeeTask {
  const tier: TierLevel = api.tier;
  const status = EMPLOYEE_STATUSES.find((s) => s === api.status) ?? 'pending';
  return {
    id: toCompositeId(tier, api.id),
    code: api.code,
    bundleName: api.bundle_name ?? 'Việc cá nhân',
    title: api.title,
    description: api.description,
    // currentDeliverable fill từ daily_log.result hôm nay qua useEffect (xem ViecCuaToiView).
    currentDeliverable: '',
    lastUpdated: api.updated_at,
    deadline: api.end_date ?? '',
    status,
    // Manager = assigned_by (người giao task).
    manager: {
      name: api.assigned_by_fullname ?? api.owner_fullname ?? '—',
      role: 'Trưởng phòng phụ trách',
      avatar: '',
    },
    ownerUsername: api.owner_username_str ?? undefined,
    department: (api.department_code ?? undefined) as EmployeeTask['department'],
    // blocker_note (NV viết, Manager xem khi mở task).
    blockerNote: api.blocker_note ?? '',
    progress: api.progress ?? 0,
  };
}

/** Ngày hôm nay theo giờ máy (YYYY-MM-DD) — khớp cách backend ghi log_date. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Task T4 + nhật ký hôm nay (nếu có) → baseline cho bảng nhập liệu:
 * mô tả / kết quả / tiến độ hiển thị đúng những gì đã lưu trong ngày.
 */
export function buildEmployeeTasks(rows: TaskApiRowDto[], logs: DailyLogRowDto[]): EmployeeTask[] {
  const today = todayIso();
  const todayLog = new Map<number, DailyLogRowDto>();
  for (const log of logs) {
    if (log.log_date === today && !todayLog.has(log.task_id)) todayLog.set(log.task_id, log);
  }
  return rows
    .filter((r) => r.tier === 4)
    .map((row) => {
      const base = apiToEmployeeTask(row);
      const log = todayLog.get(row.id);
      if (!log) return base;
      return {
        ...base,
        currentDeliverable: log.result ?? '',
        description: log.description?.trim() ? log.description : base.description,
        lastUpdated: 'Hôm nay',
        progress: log.progress ?? base.progress,
      };
    });
}

// ─────────────────────────────────────────────────────────────────────
// Team member (derived từ users + tier items ở backend)
// ─────────────────────────────────────────────────────────────────────

export function apiToTeamMember(api: TeamMemberDto): TeamMember {
  return {
    id: api.id,
    name: api.name,
    role: api.role,
    avatar: api.avatar ?? '',
    activeTasks: api.activeTasks,
    overdueTasks: api.overdueTasks,
    blockedTasks: api.blockedTasks,
    totalTasks: api.totalTasks,
    needHelp: api.needHelp,
    // Backend trả department dạng string; UI giữ union Department hẹp.
    department: api.department as TeamMember['department'],
    username: api.username,
  };
}

// ─────────────────────────────────────────────────────────────────────
// DailyLog (taskId thay subtaskId)
// ─────────────────────────────────────────────────────────────────────

export function apiToDailyLog(api: DailyLogRowDto): DailyLog {
  return {
    id: String(api.id),
    taskId: String(api.task_id),
    logDate: api.log_date,
    createdAt: api.created_at,
    description: api.description,
    result: api.result ?? undefined,
    obstacle: api.obstacle ?? undefined,
    progress: api.progress,
    username: api.user_username_str ?? '',
    userName: api.user_fullname ?? '',
    userRole: undefined,
    userAvatar: undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────
// HistoryEntry (audit log)
// ─────────────────────────────────────────────────────────────────────

const ENTITY_TIER: Partial<Record<HistoryEntryDto['entity_type'], TierLevel>> = {
  project: 1, phase: 2, bundle: 3, task: 4,
};

function parseJson(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Câu mô tả tiếng Việt cho 1 dòng audit — không hiện mã enum thô ra UI. */
function describeAudit(api: HistoryEntryDto, oldV: Record<string, unknown>, newV: Record<string, unknown>): string {
  if (api.entity_type === 'daily_log') {
    return `Ghi nhật ký công việc${newV.progress != null ? ` (${newV.progress}%)` : ''}`;
  }
  if (api.entity_type === 'task_help_message') {
    return api.action === 'resolve' ? 'Đã xử lý vướng mắc' : `Báo vướng mắc: ${newV.body ?? ''}`;
  }
  if (newV.unblocked) return `Gỡ vướng mắc${newV.note ? `: ${newV.note}` : ''}`;
  if (newV.returned) return `Trả về để làm lại${newV.reason ? `: ${newV.reason}` : ''}`;
  if (api.action === 'status_change' || (newV.status && oldV.status && newV.status !== oldV.status)) {
    return `Đổi trạng thái: ${statusEnumToVi(String(oldV.status))} → ${statusEnumToVi(String(newV.status))}`;
  }
  if (newV.blocker_note !== undefined) return `Cập nhật vướng mắc: ${newV.blocker_note}`;
  switch (api.action) {
    case 'create': return 'Tạo mới';
    case 'delete': return 'Xoá';
    case 'approve': return 'Nghiệm thu & duyệt hoàn thành';
    case 'update': return 'Cập nhật thông tin';
    default: return api.action;
  }
}

/**
 * Audit row → HistoryEntry. `entityId` dùng cùng composite id với TierItem
 * ("4-12") để Drawer lọc được; nhật ký / vướng mắc gắn về task cha qua task_id.
 */
export function apiToHistoryEntry(api: HistoryEntryDto): HistoryEntry {
  const username = api.author_username_str ?? api.actor_username ?? '';
  const oldV = parseJson(api.old_values);
  const newV = parseJson(api.new_values);
  const tier = ENTITY_TIER[api.entity_type];
  const parentTaskId = Number(newV.task_id);
  const entityId = tier
    ? toCompositeId(tier, api.entity_id)
    : Number.isFinite(parentTaskId) ? toCompositeId(4, parentTaskId) : String(api.entity_id);
  return {
    id: String(api.id),
    entityType: api.entity_type,
    entityId,
    action: describeAudit(api, oldV, newV),
    username,
    userName: api.author_fullname_str ?? username,
    createdAt: api.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Date helpers (derive Gantt metadata từ dates, không lưu DB)
// ─────────────────────────────────────────────────────────────────────

/**
 * Tính "tuần thứ mấy trong tháng" từ ISO date.
 * Ước lượng: (day_of_month - 1) / 7 + 1.
 * Đủ chính xác cho Gantt chart; production nên dùng thư viện date-fns nếu cần.
 */
export function computeWeekFromDate(isoDate: string | null | undefined): number {
  if (!isoDate) return 1;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return 1;
  return Math.floor((d.getUTCDate() - 1) / 7) + 1;
}