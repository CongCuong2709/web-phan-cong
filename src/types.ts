/**
 * Core type definitions for 4-Tier Enterprise Execution System & Team Workspace.
 *
 *   - Task gắn 1 cột `blockerNote` (escalation NV ↔ Manager).
 *   - dailyLogs là sub-resource 1:N duy nhất còn lại trên task.
 *   - Lịch sử thay đổi lớn (Phase B/C/D/E/F/G): xem CHANGELOG.md.
 */

export type TierLevel = 1 | 2 | 3 | 4;

/**
 * === MVP Identity & Access ===
 */
export type Role = 'admin' | 'director' | 'manager' | 'employee';

/**
 * 4 organizational departments (phòng ban) used by 4-Tier Enterprise MVP.
 *  - ĐH   : Ban Điều hành (Board of Directors)
 *  - QLDA : Phòng Quản lý Dự án
 *  - KTTC : Phòng Kế toán – Tài chính
 *  - TC   : Phòng Tổ chức – Hành chính
 */
export type Department = 'ĐH' | 'QLDA' | 'KTTC' | 'TC';

export interface User {
  id: string;
  username: string;
  fullname: string;
  email?: string;
  role: Role;
  departments: Department[];
  initial?: string;
  avatar?: string;
}

export const DEPARTMENT_LABEL: Record<Department, string> = {
  'ĐH': 'Ban Điều hành',
  QLDA: 'Phòng Quản lý Dự án',
  KTTC: 'Phòng Kế toán – Tài chính',
  TC: 'Phòng Tổ chức – Hành chính',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Quản trị hệ thống',
  director: 'Điều hành',
  manager: 'Trưởng phòng',
  employee: 'Nhân viên',
};

// ============================================================================
// `Task` — single source of truth cho mọi loại "đầu việc".
// Thay thế 3 type frontend cũ (TierItem, TeamLeadTask, EmployeeTask) — vẫn giữ
// làm alias cho tới khi GiaoViecNhomView / ViecCuaToiView migrate xong.
// ============================================================================

export type TaskStatus = 'pending' | 'doing' | 'done' | 'pending_approval' | 'blocked';
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Unified Task — mirror của backend `tasks` table.
 *
 * Lifecycle:
 *   - Tier 1: Dự án (Project)         — root, parent_id = NULL
 *   - Tier 2: Giai đoạn (Phase)        — parent_id = T1.id
 *   - Tier 3: Hạng mục (Bundle)       — parent_id = T2.id
 *   - Tier 4: Đầu việc (Task, leaf)   — parent_id = T3.id, owned by NV
 *
 * Mọi view (Gantt 4 tầng, Giao việc nhóm, Việc của tôi) đều dùng chung 1 type này.
 *
 * `blockerNote` (1 cột text) là kênh escalation NV ↔ Manager.
 */
export interface Task {
  id: string;
  code: string;
  title: string;
  description: string;

  // Tree structure
  parentId?: string | null;
  tier: TierLevel;
  collapsed?: boolean;

  // Assignment
  ownerUserId: string;
  ownerUsername: string;
  ownerFullname: string;
  /** Người giao (manager/admin tạo task cho NV). Null nếu NV tự tạo. */
  assignedByUserId?: string | null;
  assignedByUsername?: string | null;
  assignedByFullname?: string | null;

  // Department
  department?: Department;

  // Schedule
  startDate: string;
  endDate: string;
  daysRemaining?: number;

  // Progress + Status
  progress: number; // 0-100
  status: TaskStatus;
  priority: TaskPriority;

  // Personal task flags (from employee_tasks)
  bundleName?: string;
  lastUpdated?: string;

  // NV viết 1 dòng "đang vướng ở đâu / cần hỗ trợ gì" — Manager xem khi mở task.
  blockerNote?: string;

  // Management
  managementNotes: string;
  blockerAlert?: string;

  // Gantt denormalized
  gantt: {
    startWeek: number;
    endWeek: number;
  };
}

/**
 * TierItem — DEPRECATED. Use `Task` instead.
 *
 * Giữ lại để backward-compat với components đang dùng các field display như
 * `tierName`, `tierBadge`, `owner` (object thay vì id). Transform runtime ở
 * transforms.ts sẽ bổ sung các field display.
 */
export interface TierItem extends Omit<Task, 'status' | 'priority' | 'ownerUserId' | 'ownerFullname' | 'ownerUsername'> {
  tierName: string;
  tierBadge: string;
  /** Display object thay vì id+username (UI-friendly). */
  owner: {
    name: string;
    role: string;
    initial: string;
    avatar?: string;
  };
  // Status / Priority giữ lại dạng Tiếng Việt để UI không phải refactor.
  /** 1:1 với 5 trạng thái của state machine — xem STATUS_VI trong lib/transforms.ts. */
  status: 'Chưa bắt đầu' | 'Đang làm' | 'Chờ duyệt' | 'Đang vướng' | 'Đã xong';
  /** Enum DB; nhãn tiếng Việt ở PRIORITY_VI (lib/transforms.ts). Chỉ T4 có cột này. */
  priority: TaskPriority;
  /** Thời điểm tạo (UTC từ SQLite) — với T4 là ngày giao việc. */
  createdAt?: string;
  statusBadgeColor?: string;
  ownerUsername?: string;
  ownerUserId?: string;
  ownerFullname?: string;
  // Tiến độ task tính từ MAX(daily_logs.progress).
  /** Thuộc nhánh đã lưu trữ (chính nó hoặc dự án / giai đoạn chứa nó). */
  archived: boolean;
  /** Chính mục này được lưu trữ (chỉ T1/T2) — mới có thể khôi phục tại đây. */
  archivedAt?: string;
}

/**
 * TeamLeadTask — DEPRECATED. Use `Task` instead.
 * Giữ lại để GiaoViecNhomView không phải refactor toàn bộ.
 */
export interface TeamLeadTask {
  id: string;
  code: string;
  title: string;
  category: string;
  ownerName: string;
  ownerAvatar?: string;
  ownerUsername?: string;
  department?: Department;
  /** Ngày giao việc (created_at). */
  submittedAt: string;
  /** Lần cập nhật gần nhất — với việc chờ duyệt là lúc NV báo xong. */
  updatedAt: string;
  deadline?: string;
  status: 'not_started' | 'in_progress' | 'pending_approval' | 'need_help' | 'done';
  priority: TaskPriority;
  /** Vướng mắc NV đã báo mà TP chưa gỡ. */
  openBlockerCount: number;
  /** NV viết "đang vướng ở đâu / cần hỗ trợ gì" — Manager xem khi mở task. */
  blockerNote?: string;
  /** Cần Trưởng phòng hỗ trợ: đang `blocked` HOẶC NV đã ghi vướng mắc (blocker_note không đổi status). */
  needsHelp: boolean;
  progress: number;
}

/**
 * EmployeeTask — DEPRECATED. Use `Task` instead.
 * Giữ lại để ViecCuaToiView không phải refactor toàn bộ.
 *
 * `currentDeliverable` đồng bộ với daily_log.result hôm nay; `blockerNote` cho escalation.
 */
export interface EmployeeTask {
  id: string;
  code: string;
  bundleName: string;
  title: string;
  /** Chỉ thị / mô tả của người giao (tasks.description) — không phải nhật ký. */
  description: string;
  /** Mô tả trong nhật ký hôm nay (daily_log.description), '' nếu chưa ghi. */
  logDescription: string;
  /** Text kết quả bàn giao inline — sync với daily_log.result hôm nay. */
  currentDeliverable: string;
  lastUpdated: string;
  deadline: string;
  /** Enum DB nguyên bản — không gộp trạng thái. */
  status: 'pending' | 'doing' | 'pending_approval' | 'blocked' | 'done';
  priority: TaskPriority;
  startDate: string;
  /** Người giao, khi khác chính người làm (việc tự tạo thì không có). */
  assignedByName?: string;
  /** Số lần báo vướng mắc / số còn chưa gỡ / số tin trao đổi / số tệp của task. */
  blockerCount: number;
  openBlockerCount: number;
  /** Thời điểm (UTC từ server) vướng mắc chưa gỡ gần nhất được gửi. */
  openBlockerAt?: string;
  messageCount: number;
  attachmentCount: number;
  /**
   * Tiến độ (%) — baseline cho slider: daily_log.progress hôm nay nếu có,
   * ngược lại tasks.progress (xem buildEmployeeTasks).
   */
  progress: number;
  manager: {
    name: string;
    role: string;
    avatar: string;
  };
  /** Username of the employee that owns this task (primary key for "Việc của tôi"). */
  ownerUsername?: string;
  /** Department for manager cross-check. */
  department?: Department;
  /** NV viết "đang vướng ở đâu" — Manager xem khi mở task. */
  blockerNote?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  /** Việc chưa báo xong (không tính chờ duyệt / đã xong). */
  activeTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  totalTasks: number;
  needHelp?: boolean;
  /** Department the member belongs to. */
  department?: Department;
  /** Username mapping (so manager filtering can resolve the actual user account). */
  username?: string;
}

/**
 * Construction-domain extensions: each T4 task can have several Daily Logs
 * (Nhật ký công việc) — sub-resource 1:N duy nhất còn lại.
 *
 * 1 log/(task, ngày) — UPSERT atomic ở routes/dailyLogs.js.
 */
export interface DailyLog {
  id: string;
  /** Parent T4 TierItem.id (numeric). */
  taskId: string;
  /** Display string for the day (ISO). */
  logDate: string;
  /** Thời điểm tạo log (backend trả ISO string). Dùng để sắp xếp nhiều log cùng ngày. */
  createdAt?: string;
  description: string;
  result?: string;
  obstacle?: string;
  progress: number;
  username: string;
  userName: string;
  userRole?: string;
  userAvatar?: string;
}

export interface HistoryEntry {
  id: string;
  /** Khớp CHECK constraint của bảng `audit_log` (xem backend/sql/schema.sql). */
  entityType: 'project' | 'phase' | 'bundle' | 'task' | 'daily_log' | 'task_help_message' | 'user';
  entityId: string;
  action: string;
  username: string;
  userName: string;
  createdAt: string;
  /** Có khi dòng này là một lần đổi trạng thái (enum DB). */
  fromStatus?: TaskStatus;
  toStatus?: TaskStatus;
}

export type ActiveAppTab = 'cay-gantt-4-tang' | 'giao-viec-nhom' | 'viec-cua-toi' | 'bao-cao';
