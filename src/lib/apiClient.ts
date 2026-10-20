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

// Fix C3: port backend mặc định là 3000 (xem backend/.env PORT=3000),
// không phải 3001. Sai port này làm frontend không gọi được API mặc định.
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
  owner_username?: string | null; // Backend tra cứu user_id từ username.
  assigned_by_user_id?: number | null;
  start_date?: string;
  end_date?: string;
  progress?: number;
  status?: string;
  priority?: string;
  description?: string;
  management_notes?: string;
  is_today?: number;
  bundle_name?: string | null;
  last_updated?: string | null;
  /** Escalation NV ↔ Manager (1 dòng text). */
  blocker_note?: string | null;
  blocker_alert?: string | null;
  start_week?: number;
  end_week?: number;
  collapsed?: number;
  owner_username_str?: string;
  owner_fullname?: string;
  assigned_by_username_str?: string;
  assigned_by_fullname?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DailyLogDto {
  taskId: number;
  description: string;
  result?: string;
  obstacle?: string;
  progress: number;
}

// Typed DTOs thay cho `unknown[]` — TypeScript bắt lỗi sai/missing field lúc compile.
export interface TeamLeadTaskDto {
  id: number;
  code: string;
  title: string;
  category?: string;
  owner_fullname?: string;
  owner_username_str?: string;
  department_code?: string;
  submitted_at: string;
  deadline?: string;
  status: 'pending_approval' | 'need_help' | 'in_progress' | 'done';
  priority?: 'Cao' | 'Thường';
  progress_text?: string;
  /** 1 dòng blocker do NV viết (escalation). */
  blocker_note?: string | null;
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
  owner_username_str?: string;
  department_code?: string;
  /** NV viết "đang vướng ở đâu" — Manager xem khi mở task. */
  blocker_note?: string | null;
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

export interface DailyLogRowDto {
  id: number;
  task_id: number;
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
  entity_type: 'project' | 'phase' | 'bundle' | 'task' | 'daily_log' | 'team_lead_task' | 'employee_task';
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

  /**
   * POST /api/auth/change-password — Public endpoint (không cần auth).
   * Dùng từ trang Login: user nhập username + mật khẩu cũ + mật khẩu mới.
   * Trả 204 nếu thành công; 400/401 nếu input invalid / sai mật khẩu cũ.
   */
  async changePassword(
    username: string,
    currentPassword: string,
    newPassword: string
  ) {
    return request('POST', '/api/auth/change-password', {
      username,
      currentPassword,
      newPassword,
    });
  },

  /** GET /api/health — dùng để check backend lên hay chưa */
  async health() {
    return request<{ ok: boolean; time: string }>('GET', '/api/health');
  },

  // --- Tasks (tier-specific endpoints) ---
  /**
   * GET /api/tasks — List filtered theo role. Backend trả TẤT CẢ 4 tier
   * với field `tier` set sẵn. Frontend dùng TierItemDto (kèm tier) cho cả 4 loại.
   */
  async listTasks() {
    return request<{ items: TierItemDto[] }>('GET', '/api/tasks');
  },
  /** GET /api/tasks/:tier/:id — tier ∈ {1,2,3,4}. Response trả `{ item }`. */
  async getTask(tier: number, id: number) {
    return request<{ item: TierItemDto }>(
      'GET', `/api/tasks/${tier}/${id}`
    );
  },
  /** POST /api/tasks — body chứa `tier` để dispatch. */
  async createTask(item: TierItemDto) {
    return request<{ item: TierItemDto }>('POST', '/api/tasks', item);
  },
  /** PATCH /api/tasks/:tier/:id. */
  async updateTask(tier: number, id: number, patch: Partial<TierItemDto>) {
    return request<{ item: TierItemDto }>('PATCH', `/api/tasks/${tier}/${id}`, patch);
  },
  /** DELETE /api/tasks/:tier/:id. */
  async deleteTask(tier: number, id: number) {
    return request('DELETE', `/api/tasks/${tier}/${id}`);
  },

  // --- Sub-resource trên task (daily_logs + blocker_note) ---
  async approveTask(tier: number, id: number) {
    return request<{ item: TierItemDto }>('POST', `/api/tasks/${tier}/${id}/approve`);
  },
  /** POST /api/tasks/:id/blocker — NV ghi 1 dòng blocker_note (escalation). */
  async setTaskBlocker(tier: number, id: number, note: string) {
    return request<{ item: TierItemDto; blocker_note: string }>(
      'POST', `/api/tasks/${tier}/${id}/blocker`, { note }
    );
  },
  async toggleTask(tier: number, id: number) {
    return request<{ item: TierItemDto }>('POST', `/api/tasks/${tier}/${id}/toggle`);
  },

  // Backward-compat aliases đã xoá — frontend chỉ dùng /api/tasks.
  // TierItem/TeamLeadTask/EmployeeTask DTO types vẫn dùng cho transforms,
  // nhưng API chỉ có 1 endpoint /api/tasks.

  // --- Daily logs (gắn trực tiếp vào task) ---
  async addDailyLog(log: DailyLogDto) {
    return request('POST', `/api/tasks/${log.taskId}/logs`, {
      description: log.description,
      result: log.result,
      obstacle: log.obstacle,
      progress: log.progress,
    });
  },

  // --- Users (BUG-04 fix: NewItemModal cần danh sách user thật cho dropdown) ---
  /**
   * GET /api/users — admin thấy tất cả, manager thấy users trong cùng department.
   * (xem routes/users.js:19-43). Employee bị 403, không dùng được từ client.
   */
  async listUsers(department?: string) {
    const qs = department ? `?department=${encodeURIComponent(department)}` : '';
    return request<{
      users: Array<{
        id: number;
        username: string;
        fullname: string;
        email?: string | null;
        role: 'admin' | 'director' | 'manager' | 'employee';
        departments?: string | null;
        initial?: string | null;
        avatar_url?: string | null;
      }>;
    }>('GET', `/api/users${qs}`);
  },

  // --- Team members (derived) ---
  async listTeamMembers() {
    return request<{ members: TeamMemberDto[] }>('GET', '/api/team-members');
  },

  // --- Daily logs (bulk — cho Báo cáo tổng quan + per-task) ---
  async listDailyLogs() {
    return request<{ items: DailyLogRowDto[] }>('GET', '/api/daily-logs');
  },
  async listDailyLogsByTask(taskId: number) {
    return request<{ items: DailyLogRowDto[] }>('GET', `/api/tasks/${taskId}/logs`);
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