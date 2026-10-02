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

export interface TierItem {
  id: string;
  code: string;
  tier: TierLevel;
  tierName: string; // "Tầng 1: Dự án" | "Tầng 2: Giai đoạn" | "Tầng 3: Hạng mục giao" | "Tầng 4: Đầu việc"
  tierBadge: string; // "DỰ ÁN T1" | "GIAI ĐOẠN T2" | "HẠNG MỤC T3" | "VIỆC T4"
  title: string;
  parentId?: string;
  owner: {
    name: string;
    role: string;
    initial: string;
    avatar?: string;
  };
  /** Username that owns the work item (used for employee visibility). */
  ownerUsername?: string;
  /** Department the item is associated with (used for manager/director scoping). */
  department?: Department;
  deadline: string; // e.g. "31/10/2026"
  daysRemaining?: number;
  progress: number; // 0 - 100
  status: 'Đang chạy' | 'Sắp xong' | 'Đã xong' | 'Điểm nghẽn' | 'Đang làm' | 'Đang nghẽn' | 'Lên lịch' | 'Chuẩn bị';
  statusBadgeColor?: string;
  priority: 'Cao (Critical Path)' | 'Trung bình' | 'Thấp';
  description: string;
  deliverables: Deliverable[];
  managementNotes: string;
  blockerAlert?: string;
  gantt: {
    startWeek: number; // 1 to 4
    endWeek: number; // 1 to 4 (e.g. 1.5, 2.8, etc.)
    label?: string;
    barColor?: string;
    isBlocked?: boolean;
  };
  collapsed?: boolean;
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
export type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'review';

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
  status: TaskStatus;
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