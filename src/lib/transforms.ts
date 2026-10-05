/**
 * transforms.ts — Map backend API responses → frontend entity types.
 *
 * Backend (SQLite) trả về schema rút gọn (flat fields) trong khi frontend
 * dùng shape phong phú (nested objects). Module này convert 1-1.
 *
 * Lưu ý: các field frontend cần mà backend không có (vd tierName, deliverables)
 * sẽ được fill bằng giá trị mặc định để component render an toàn.
 */

import type {
  TierItem,
  TierLevel,
  TeamLeadTask,
  EmployeeTask,
  QuickHelpRequest,
} from '../types';

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
 * Map 1 row tier_items từ backend → TierItem shape frontend.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiToTierItem(api: any): TierItem {
  const tier = (api.tier as TierLevel) || 4;
  const ownerFullname = (api.owner_fullname as string) || '—';
  const department = (api.department_code as string) || undefined;

  return {
    id: String(api.id),
    code: String(api.code || ''),
    tier,
    tierName: TIER_NAMES[tier],
    tierBadge: TIER_BADGES[tier],
    title: String(api.title || ''),
    parentId: api.parent_id != null ? String(api.parent_id) : undefined,
    owner: {
      name: ownerFullname,
      role: department || '',
      initial: ownerFullname.charAt(0).toUpperCase(),
      avatar: undefined,
    },
    ownerUsername: (api.owner_username_str as string) || undefined,
    department: department as TierItem['department'],
    deadline: String(api.deadline || ''),
    daysRemaining: api.days_remaining != null ? Number(api.days_remaining) : undefined,
    progress: Number(api.progress ?? 0),
    status: (api.status as TierItem['status']) || 'Chuẩn bị',
    priority: (api.priority as TierItem['priority']) || 'Trung bình',
    description: String(api.description || ''),
    deliverables: [], // API trả riêng qua /deliverables endpoint
    managementNotes: String(api.management_notes || ''),
    blockerAlert: api.blocker_alert as string | undefined,
    gantt: {
      startWeek: Number(api.start_week ?? 1),
      endWeek: Number(api.end_week ?? 1),
      label: (api.gantt_label as string) || undefined,
      barColor: (api.gantt_bar_color as string) || undefined,
    },
    collapsed: Boolean(api.collapsed),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Team lead task
// ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiToTeamLeadTask(api: any): TeamLeadTask {
  return {
    id: String(api.id),
    code: String(api.code || ''),
    title: String(api.title || ''),
    category: String(api.category || ''),
    deliverableType: (api.deliverable_type as TeamLeadTask['deliverableType']) || 'text',
    deliverableText: String(api.deliverable_text || ''),
    fileName: (api.file_name as string) || undefined,
    ownerName: String(api.owner_fullname || api.owner_username_str || ''),
    ownerUsername: (api.owner_username_str as string) || undefined,
    department: api.department_code as TeamLeadTask['department'],
    submittedAt: String(api.submitted_at || ''),
    deadline: (api.deadline as string) || undefined,
    status: (api.status as TeamLeadTask['status']) || 'in_progress',
    priority: (api.priority as TeamLeadTask['priority']) || undefined,
    progressText: (api.progress_text as string) || undefined,
    helpMessage:
      api.help_message_body && api.help_message_author
        ? {
            author: String(api.help_message_author),
            message: String(api.help_message_body),
            timeAgo: String(api.help_message_timeago || 'Vừa xong'),
          }
        : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Employee task
// ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiToEmployeeTask(api: any): EmployeeTask {
  return {
    id: String(api.id),
    code: String(api.code || ''),
    bundleName: String(api.bundle_name || '—'),
    title: String(api.title || ''),
    description: String(api.description || ''),
    currentDeliverable: String(api.current_deliverable || ''),
    lastUpdated: String(api.last_updated || ''),
    deadline: String(api.deadline || ''),
    isToday: Boolean(api.is_today),
    status: (api.status as EmployeeTask['status']) || 'doing',
    manager: {
      name: '',
      role: '',
      avatar: '',
    },
    notesCount: Number(api.notesCount ?? 0),
    notes: [],
    ownerUsername: (api.owner_username_str as string) || undefined,
    department: api.department_code as EmployeeTask['department'],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Help request
// ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiToHelpRequest(api: any): QuickHelpRequest {
  return {
    id: String(api.id),
    timestamp: String(api.created_at || ''),
    sender: '',
    reason: String(api.reason || ''),
    message: String(api.message || ''),
    status: (api.status as QuickHelpRequest['status']) || 'pending',
  };
}