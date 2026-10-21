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
    // Map status từ enum DB sang tiếng Việt (UI Gantt đang dùng tiếng Việt).
    status: statusEnumToVi(api.status) as TierItem['status'],
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

/** Convert status enum DB → Tiếng Việt (cho Gantt view). */
function statusEnumToVi(s: string | null | undefined): string {
  switch (String(s)) {
    case 'done': return 'Đã xong';
    case 'doing': return 'Đang chạy';
    case 'pending': return 'Chuẩn bị';
    case 'pending_approval': return 'Sắp xong';
    case 'blocked': return 'Điểm nghẽn';
    default: return String(s || 'Chuẩn bị');
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
    'pending': 'in_progress',
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
    submittedAt: api.created_at,       // created_at là proxy submitted_at
    deadline: api.end_date ?? undefined,
    status: statusMap[api.status] ?? 'in_progress',
    priority: priorityEnumToVi(api.priority) as TeamLeadTask['priority'],
    progressText: api.progress != null ? `${api.progress}%` : undefined,
    // 1 dòng blocker_note thay cho helpMessage 1:N cũ.
    blockerNote: api.blocker_note ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Employee task
// ─────────────────────────────────────────────────────────────────────

export function apiToEmployeeTask(api: TaskApiRowDto): EmployeeTask {
  // Map status enum từ unified Task sang EmployeeTask enum.
  // currentDeliverable là trường DERIVED — không có sẵn trên /api/tasks; App.tsx sẽ merge từ
  // daily_log.result của HÔM NAY sau khi fetch xong Promise.all ở useEffect login.
  // Hàm này chỉ trả về baseline (''). Đừng tự fill ở đây — sẽ tạo duplicate logic.
  const statusMap: Record<string, EmployeeTask['status']> = {
    'pending': 'pending',
    'doing': 'doing',
    'done': 'done',
    'pending_approval': 'doing',   // pending_approval vẫn đang làm
    'blocked': 'pending',           // blocked → pending cho personal view
  };
  // Composite id để tránh nhầm với tier items ở các tier khác.
  const tier: TierLevel = api.tier;
  return {
    id: toCompositeId(tier, api.id),
    code: api.code,
    bundleName: api.bundle_name ?? '—',
    title: api.title,
    description: api.description,
    // currentDeliverable fill từ daily_log.result hôm nay qua useEffect (xem ViecCuaToiView).
    currentDeliverable: '',
    lastUpdated: api.updated_at,
    deadline: api.end_date ?? '',
    isToday: Boolean(api.is_today),
    status: statusMap[api.status] ?? 'doing',
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
    // Tiến độ từ API (tasks.progress). App.tsx sẽ override bằng
    // daily_log.progress của HÔM NAY nếu có, để slider hiển thị giá trị mới nhất.
    progress: api.progress ?? 0,
  };
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
    onTimeRate: api.onTimeRate ?? '',
    statusText: api.statusText,
    statusType: api.statusType,
    workloadPercent: api.workloadPercent,
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

export function apiToHistoryEntry(api: HistoryEntryDto): HistoryEntry {
  // Ưu tiên tên join từ bảng users; fallback sang snapshot actor_username
  // trong audit_log (vẫn còn khi user đã bị xoá).
  const username = api.author_username_str ?? api.actor_username ?? '';
  return {
    id: String(api.id),
    entityType: api.entity_type,
    entityId: String(api.entity_id),
    action: api.action,
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