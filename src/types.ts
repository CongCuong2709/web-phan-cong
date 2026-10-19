/**
 * Core type definitions for 4-Tier Enterprise Execution System & Team Workspace.
 *
 * Phase F (2026-10): simplified for text-only daily-log use case.
 *   - Drop Deliverable, TaskNote, QuickHelpRequest interfaces (3 bảng backend đã xoá).
 *   - Task gắn 1 cột `blockerNote` (thay task_help_messages 1:N).
 *   - dailyLogs là sub-resource DUY NHẤT còn lại trên task.
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
 *
 * Phase F: loại bỏ deliverable* / helpMessage* / notes* (3 bảng backend đã xoá).
 *           Thêm `blockerNote` (1 cột text — escalation thay cho help_requests).
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

  // Phase F: NV ghi 1 dòng "đang vướng ở đâu / cần hỗ trợ gì".
  // Manager xem khi mở task (thay cho help_requests 1:N cũ).
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
 * TierItem — DEPRECATED. Use `Task` instead (ISS-007).
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
  status: 'Đang chạy' | 'Sắp xong' | 'Đã xong' | 'Điểm nghẽn' | 'Đang làm' | 'Đang nghẽn' | 'Lên lịch' | 'Chuẩn bị';
  priority: 'Cao (Critical Path)' | 'Trung bình' | 'Thấp';
  statusBadgeColor?: string;
  ownerUsername?: string;
  ownerUserId?: string;
  ownerFullname?: string;
  // Phase F: bỏ `deliverables` (interface Deliverable đã xoá, bảng task_deliverables đã xoá).
  // Tiến độ task giờ tính từ MAX(daily_logs.progress) thay vì deliverables hoàn thành.
}

/**
 * TeamLeadTask — DEPRECATED. Use `Task` instead (ISS-007).
 * Giữ lại để GiaoViecNhomView không phải refactor toàn bộ.
 *
 * Phase F: loại bỏ deliverableType/text/fileName/helpMessage (3 bảng backend đã xoá).
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
  submittedAt: string;
  deadline?: string;
  status: 'pending_approval' | 'need_help' | 'in_progress' | 'done';
  priority?: 'Cao' | 'Thường';
  /** Phase F: 1 dòng blocker do NV viết (thay helpMessage 1:N cũ). */
  blockerNote?: string;
  /** Hiển thị rollup progress mới nhất (lấy từ daily_logs.progress). */
  progressText?: string;
}

/**
 * EmployeeTask — DEPRECATED. Use `Task` instead (ISS-007).
 * Giữ lại để ViecCuaToiView không phải refactor toàn bộ.
 *
 * Phase F: loại bỏ currentDeliverable (chuyển sang daily_log.result),
 *          notesCount/notes (bảng task_notes đã xoá, dùng daily_log.description).
 *          Thêm blockerNote.
 */
export interface EmployeeTask {
  id: string;
  code: string;
  bundleName: string;
  title: string;
  description: string;
  /** Phase F: text kết quả bàn giao inline (giờ sync với daily_log.result hôm nay). */
  currentDeliverable: string;
  lastUpdated: string;
  deadline: string;
  isToday?: boolean;
  status: 'doing' | 'done' | 'pending';
  /**
   * Tiến độ task (%) lấy từ daily_log.progress mới nhất.
   * Fix #1: cần có baseline để `getDraft()` không luôn default = 0 → bug reset progress.
   * Backend rollup đã có ở `tasks.progress` (transforms.ts) — App.tsx merge
   * từ daily_log.progress của HÔM NAY để slider hiển thị đúng giá trị.
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
  /** Phase F: NV viết "đang vướng ở đâu" → manager xem. */
  blockerNote?: string;
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

/**
 * Construction-domain extensions: each T4 task can have several Daily Logs
 * (Nhật ký thi công) — sub-resource 1:N duy nhất còn lại.
 *
 * Phase E: bỏ SubTask tier. Task là leaf (T4 nhỏ nhất).
 * Phase F: 1 log/(task,ngày) — UPSERT ở routes/dailyLogs.js.
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
  entityType: 'project' | 'phase' | 'bundle' | 'task' | 'daily_log';
  entityId: string;
  action: string;
  username: string;
  userName: string;
  createdAt: string;
}

export type ActiveAppTab = 'cay-gantt-4-tang' | 'giao-viec-nhom' | 'viec-cua-toi' | 'bao-cao';
