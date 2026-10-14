/**
 * Core type definitions for 4-Tier Enterprise Execution System & Team Workspace
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
  /** Demo-only: plain-text password for MVP. Production should use a backend hash. */
  password: string;
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

export interface Deliverable {
  id: string;
  title: string;
  completed: boolean;
  fileUrl?: string;
  fileName?: string;
}

export interface Deliverable {
  id: string;
  title: string;
  completed: boolean;
  fileUrl?: string;
  fileName?: string;
}

// ============================================================================
// ISS-007: Unified Task type — single source of truth cho mọi loại "đầu việc".
// Thay thế 3 bảng backend cũ (tier_items, team_lead_tasks, employee_tasks) và
// 3 type frontend cũ (TierItem, TeamLeadTask, EmployeeTask).
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
  isToday?: boolean;
  bundleName?: string;
  lastUpdated?: string;

  // Inline deliverable (from team_lead_tasks)
  deliverableType?: 'pdf' | 'spreadsheet' | 'text' | 'photo';
  deliverableText?: string;
  deliverableCompleted?: boolean;
  fileName?: string;

  // Inline help message (from team_lead_tasks)
  helpMessageAuthor?: string;
  helpMessageBody?: string;
  helpMessageTimeago?: string;

  // Management
  managementNotes: string;
  blockerAlert?: string;

  // Gantt denormalized
  gantt: {
    startWeek: number;
    endWeek: number;
  };

  // Notes (loaded với `GET /api/tasks/:id`)
  notesCount?: number;
  notes?: TaskNote[];
}

export interface TaskNote {
  id: string;
  taskId: string;
  body: string;
  authorUserId: string;
  authorUsername?: string;
  authorFullname?: string;
  createdAt: string;
}

/**
 * TierItem — DEPRECATED. Use `Task` instead (ISS-007).
 *
 * Giữ lại để backward-compat với components đang dùng các field display như
 * `tierName`, `tierBadge`, `owner` (object thay vì id). Transform runtime ở
 * transforms.ts sẽ bổ sung các field display.
 *
 * Status / Priority giữ lại Tiếng Việt (UI Gantt) — để khớp với code đang
 * so sánh `v.status === 'Đã xong'` ở components. Transform sẽ convert từ
 * enum DB sang Tiếng Việt.
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
  // transforms.ts convert enum DB → Tiếng Việt khi parse response.
  status: 'Đang chạy' | 'Sắp xong' | 'Đã xong' | 'Điểm nghẽn' | 'Đang làm' | 'Đang nghẽn' | 'Lên lịch' | 'Chuẩn bị';
  priority: 'Cao (Critical Path)' | 'Trung bình' | 'Thấp';
  statusBadgeColor?: string;
  deliverables: Deliverable[];
  ownerUsername?: string;
  ownerUserId?: string;
  ownerFullname?: string;
}

/**
 * TeamLeadTask — DEPRECATED. Use `Task` instead (ISS-007).
 * Giữ lại để GiaoViecNhomView không phải refactor toàn bộ.
 * Standalone interface (KHÔNG extends Task) để tránh cascading type errors.
 */
export interface TeamLeadTask {
  id: string;
  code: string;
  title: string;
  category: string;
  deliverableType: 'pdf' | 'spreadsheet' | 'text' | 'photo';
  deliverableText: string;
  fileName?: string;
  ownerName: string;
  ownerAvatar?: string;
  ownerUsername?: string;
  department?: Department;
  submittedAt: string;
  deadline?: string;
  status: 'pending_approval' | 'need_help' | 'in_progress' | 'done';
  priority?: 'Cao' | 'Thường';
  helpMessage?: {
    author: string;
    message: string;
    timeAgo: string;
  };
  progressText?: string;
}

/**
 * EmployeeTask — DEPRECATED. Use `Task` instead (ISS-007).
 * Giữ lại để ViecCuaToiView không phải refactor toàn bộ.
 * Standalone interface.
 */
export interface EmployeeTask {
  id: string;
  code: string;
  bundleName: string;
  title: string;
  description: string;
  currentDeliverable: string;
  lastUpdated: string;
  deadline: string;
  isToday?: boolean;
  status: 'doing' | 'done' | 'pending';
  manager: {
    name: string;
    role: string;
    avatar: string;
  };
  notesCount: number;
  notes?: string[];
  ownerUsername?: string;
  department?: Department;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  activeTasks: number;
  onTimeRate: string;
  statusText: string;
  statusType: 'good' | 'warning' | 'idle';
  workloadPercent: number;
  urgentNote?: string;
  needHelp?: boolean;
  /** Department the member belongs to. */
  department?: Department;
  /** Username mapping (so manager filtering can resolve the actual user account). */
  username?: string;
}

export interface TeamLeadTask {
  id: string;
  code: string;
  title: string;
  category: string;
  deliverableType: 'pdf' | 'spreadsheet' | 'text' | 'photo';
  deliverableText: string;
  fileName?: string;
  ownerName: string;
  ownerAvatar?: string;
  /** Username that owns this team task (employee). */
  ownerUsername?: string;
  /** Department the task is rolled up to. */
  department?: Department;
  submittedAt: string;
  deadline?: string;
  status: 'pending_approval' | 'need_help' | 'in_progress' | 'done';
  priority?: 'Cao' | 'Thường';
  helpMessage?: {
    author: string;
    message: string;
    timeAgo: string;
  };
  progressText?: string;
}

export interface EmployeeTask {
  id: string;
  code: string;
  bundleName: string;
  title: string;
  description: string;
  currentDeliverable: string;
  lastUpdated: string;
  deadline: string;
  isToday?: boolean;
  status: 'doing' | 'done' | 'pending';
  manager: {
    name: string;
    role: string;
    avatar: string;
  };
  notesCount: number;
  notes?: string[];
  /** Username of the employee that owns this task (primary key for "Việc của tôi"). */
  ownerUsername?: string;
  /** Department for manager cross-check. */
  department?: Department;
}

export interface QuickHelpRequest {
  id: string;
  timestamp: string;
  sender: string;
  reason: string;
  message: string;
  status: 'pending' | 'resolved';
}

/**
 * Construction-domain extensions: each T4 task can own several SubTasks
 * (T4.5), and each SubTask can have several Daily Logs (Nhật ký thi công).
 */
export type SubtaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked' | 'review';
export type TaskPriorityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SubTask {
  id: string;
  /** Parent T4 TierItem.id. */
  taskId: string;
  name: string;
  description?: string;
  assigneeUsername?: string;
  assigneeName?: string;
  assigneeRole?: string;
  assigneeAvatar?: string;
  /** Display strings in dd/MM format, e.g. "12/10". */
  startDate: string;
  endDate: string;
  progress: number;
  status: SubtaskStatus;
  priority: TaskPriorityLevel;
  results?: string;
  notes?: string;
}

export interface DailyLog {
  id: string;
  subtaskId: string;
  /** Display string for the day (ISO). */
  logDate: string;
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
  entityType: 'project' | 'phase' | 'bundle' | 'task' | 'subtask';
  entityId: string;
  action: string;
  username: string;
  userName: string;
  createdAt: string;
}

export type ActiveAppTab = 'cay-gantt-4-tang' | 'giao-viec-nhom' | 'viec-cua-toi' | 'bao-cao';