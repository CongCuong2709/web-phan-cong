/**
 * apiClient.ts — HTTP client gọi backend Express server.
 *
 * localStorage chỉ được dùng cho JWT token (`mvp_token`).
 * Mọi data nghiệp vụ đến từ API — không có localStorage cache.
 *
 * Usage:
 *   import { api } from './lib/apiClient';
 *   await api.login('admin', 'admin123');
 *   api.createTierItem({ ... });  // fire-and-forget
 */

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';
const TOKEN_KEY = 'mvp_token';

// ─────────────────────────────────────────────────────────────────────
// Token management
// ─────────────────────────────────────────────────────────────────────

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────
// Internal fetch wrapper
// ─────────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message?: string;
}

export type ApiResponse<T = unknown> =
  | { ok: true; data: T; error?: never; networkError?: false }
  | { ok: false; error: ApiError; networkError: boolean };

async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; requireAuth?: boolean } = {}
): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 401) {
      // Token expired/invalid → auto-logout
      clearToken();
      // Dispatch event để AuthContext cần biết (best-effort)
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }

    if (!res.ok) {
      let errPayload: ApiError = { error: 'http_error' };
      try {
        errPayload = await res.json();
      } catch {
        /* ignore JSON parse */
      }
      return { ok: false, error: errPayload, networkError: false };
    }

    // 204 No Content
    if (res.status === 204) {
      return { ok: true, data: undefined as T };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    clearTimeout(timeoutId);
    // Network error, abort, hoặc CORS — fail silent cho dual-write
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      error: { error: isAbort ? 'timeout' : 'network', message: String(err) },
      networkError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API — typed helpers
// ─────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  user: {
    id: number;
    username: string;
    fullname: string;
    email?: string | null;
    role: 'admin' | 'director' | 'manager' | 'employee';
    departments?: string[] | string | null;
    initial?: string | null;
    avatar_url?: string | null;
  };
}

export interface TierItemDto {
  id?: number;
  code?: string;
  tier: 1 | 2 | 3 | 4;
  title: string;
  parent_id?: number | null;
  department_code?: string | null;
  owner_user_id?: number | null;
  deadline?: string;
  progress?: number;
  status?: string;
  priority?: string;
  description?: string;
  management_notes?: string;
  start_week?: number;
  end_week?: number;
  gantt_label?: string | null;
  gantt_bar_color?: string | null;
}

export interface DailyLogDto {
  subtaskId: number;
  description: string;
  result?: string;
  obstacle?: string;
  progress: number;
}

// Fix TD-05: typed DTOs thay cho `unknown[]`. TypeScript sẽ bắt lỗi runtime
// (sai tên field, missing field) ngay lúc compile thay vì chỉ nổn console.
export interface TeamLeadTaskDto {
  id: number;
  code: string;
  title: string;
  category?: string;
  deliverable_type: 'pdf' | 'spreadsheet' | 'text' | 'photo';
  deliverable_text?: string;
  file_name?: string;
  owner_fullname?: string;
  owner_username_str?: string;
  department_code?: string;
  submitted_at: string;
  deadline?: string;
  status: 'pending_approval' | 'need_help' | 'in_progress' | 'done';
  priority?: 'Cao' | 'Thường';
  progress_text?: string;
  help_message_body?: string;
  help_message_author?: string;
  help_message_timeago?: string;
}

export interface EmployeeTaskDto {
  id: number;
  code: string;
  bundle_name?: string;
  title: string;
  description?: string;
  current_deliverable?: string;
  last_updated?: string;
  deadline?: string;
  is_today?: number | boolean;
  status: 'doing' | 'done' | 'pending';
  manager_fullname?: string;
  manager_username?: string;
  manager_avatar_url?: string;
  owner_fullname?: string;
  owner_username?: string;
  notesCount?: number;
  owner_username_str?: string;
  department_code?: string;
}

export interface QuickHelpRequestDto {
  id: number;
  sender_user_id: number;
  sender_fullname?: string;
  sender_username?: string;
  sender_avatar_url?: string;
  reason: string;
  message: string;
  status: 'pending' | 'resolved';
  related_team_lead_task_id?: number | null;
  created_at: string;
  resolved_at?: string | null;
  resolved_by_user_id?: number | null;
}

export interface TeamMemberDto {
  id?: number;
  username: string;
  name?: string;
  role?: string;
  avatar?: string;
  activeTasks?: number;
  onTimeRate?: string;
  statusText?: string;
  statusType?: 'busy' | 'idle' | 'need_help';
  workloadPercent?: number;
  needHelp?: boolean;
  department?: string;
}

export interface SubtaskDto {
  id: number;
  tier_item_id: number;
  name: string;
  description?: string;
  assignee_username_str?: string;
  assignee_fullname?: string;
  start_date: string;
  end_date: string;
  progress: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked' | 'review';
  priority: 'low' | 'medium' | 'high' | 'critical';
  results?: string;
  notes?: string;
}

export interface DailyLogRowDto {
  id: number;
  subtask_id: number;
  log_date: string;
  description: string;
  result?: string;
  obstacle?: string;
  progress: number;
  author_user_id: number;
  user_username_str?: string;
  user_fullname?: string;
  created_at: string;
}

export interface HistoryEntryDto {
  id: number;
  entity_type: 'project' | 'phase' | 'bundle' | 'task' | 'subtask' | 'team_lead_task' | 'employee_task';
  entity_id: number;
  action: string;
  author_user_id?: number;
  author_username?: string;
  author_fullname?: string;
  created_at: string;
}

export const api = {
  /** POST /api/auth/login — Save token on success. */
  async login(username: string, password: string) {
    const r = await request<LoginResponse>('POST', '/api/auth/login', { username, password });
    if (r.ok && r.data.token) {
      setToken(r.data.token);
    }
    return r;
  },

  /** POST /api/auth/logout */
  async logout() {
    const r = await request('POST', '/api/auth/logout');
    clearToken();
    return r;
  },

  /** GET /api/health — dùng để check backend lên hay chưa */
  async health() {
    return request<{ ok: boolean; time: string }>('GET', '/api/health');
  },

  // --- Tier items ---
  async listTierItems() {
    return request<{ items: TierItemDto[] }>('GET', '/api/tier-items');
  },
  async createTierItem(item: TierItemDto) {
    return request<{ item: TierItemDto }>('POST', '/api/tier-items', item);
  },
  async updateTierItem(id: number, patch: Partial<TierItemDto>) {
    return request('PATCH', `/api/tier-items/${id}`, patch);
  },
  async deleteTierItem(id: number) {
    return request('DELETE', `/api/tier-items/${id}`);
  },

  // --- Subtasks + Daily logs (Phase 2 — endpoints tồn tại ở backend, chưa patch frontend) ---
  async addDailyLog(log: DailyLogDto) {
    return request('POST', `/api/subtasks/${log.subtaskId}/logs`, {
      description: log.description,
      result: log.result,
      obstacle: log.obstacle,
      progress: log.progress,
    });
  },

  // --- Team tasks ---
  async listTeamTasks() {
    return request<{ tasks: TeamLeadTaskDto[] }>('GET', '/api/team-tasks');
  },
  async approveTask(id: number) {
    return request('POST', `/api/team-tasks/${id}/approve`);
  },
  async resolveHelp(id: number) {
    return request('POST', `/api/team-tasks/${id}/resolve`);
  },

  // --- Employee tasks ---
  async listEmployeeTasks() {
    return request<{ tasks: EmployeeTaskDto[] }>('GET', '/api/employee-tasks');
  },
  async createEmployeeTask(task: {
    title: string;
    description: string;
    deadline: string;
  }) {
    return request('POST', '/api/employee-tasks', task);
  },

  // --- Help requests ---
  async listHelpRequests() {
    return request<{ requests: QuickHelpRequestDto[] }>('GET', '/api/help-requests');
  },

  // --- Team members (derived) ---
  async listTeamMembers() {
    return request<{ members: TeamMemberDto[] }>('GET', '/api/team-members');
  },

  // --- Subtasks + Daily logs ---
  async listSubtasks() {
    return request<{ items: SubtaskDto[] }>('GET', '/api/subtasks');
  },
  async listDailyLogs() {
    return request<{ items: DailyLogRowDto[] }>('GET', '/api/daily-logs');
  },

  // --- History ---
  async listHistory(limit = 50) {
    return request<{ items: HistoryEntryDto[] }>('GET', `/api/history?limit=${limit}`);
  },
};

/**
 * Helper: fire-and-forget helper. Log lỗi nhẹ ra console nhưng không throw.
 * Dùng cho dual-write — UI không bao giờ bị block vì API lỗi.
 */
export function fireAndForget<T>(
  promise: Promise<ApiResponse<T>>,
  context: string
): void {
  promise.then((r) => {
    if (!r.ok) {
      if (r.networkError) {
        console.debug(`[api/${context}] skipped (backend offline)`);
      } else {
        console.debug(`[api/${context}] failed:`, r.error);
      }
    }
  });
}

export const apiBaseUrl = API_BASE;