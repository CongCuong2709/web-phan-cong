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

/** User object trả về từ /api/auth/me (subset đủ dùng để restore session). */
export interface MeUser {
  id: number;
  username: string;
  fullname: string;
  email?: string;
  role: 'admin' | 'director' | 'manager' | 'employee';
  departments: string[];
  avatar_url?: string;
}

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

/**
 * TaskApiRowDto — 1 row của `GET /api/tasks` (và `GET /api/tasks/:tier/:id`).
 *
 * Đây là shape THẬT của response sau khi backend hợp nhất 4 bảng
 * projects/phases/bundles/tasks về 1 endpoint và gắn `tier` vào mỗi row
 * (xem backend/routes/tasks.js `enrichWithTier`). Mọi field là optional vì
 * mỗi tier có cột riêng: `progress` chỉ có ở T4, `progress_rollup` chỉ có ở
 * T1–T3, `bundle_name` chỉ có ở T4.
 *
 * Field có hậu tố `_str` là alias do SQL JOIN tạo ra (vd `owner_username_str`).
 */
export interface TaskApiRowDto {
  id: number;
  /** Tier 1=project, 2=phase, 3=bundle, 4=task. Do backend gắn, không có trong DB. */
  tier: 1 | 2 | 3 | 4;

  // ── Common (mọi tier) ──
  code: string;
  title: string;
  description: string;
  owner_user_id: number;
  created_by_user_id: number;
  status: 'pending' | 'doing' | 'done' | 'pending_approval' | 'blocked';
  start_date: string | null;
  end_date: string | null;
  collapsed: number;
  created_at: string;
  updated_at: string;
  /** LEFT JOIN users — có thể null nếu owner đã bị xoá. */
  owner_username_str: string | null;
  owner_fullname: string | null;

  // ── T1 project ──
  // (project là root, không có parent FK)

  // ── T2 phase ──
  project_id?: number | null;

  // ── T3 bundle ──
  phase_id?: number | null;

  // ── T4 task ──
  bundle_id: number | null;
  assigned_by_user_id?: number | null;
  department_code: string | null;
  priority: 'low' | 'normal' | 'high' | 'critical';
  progress: number;
  is_today: number;
  is_today_date: string | null;
  blocker_note: string;
  assigned_by_username_str?: string | null;
  assigned_by_fullname?: string | null;
  /** LEFT JOIN bundles — tên hạng mục cha (chỉ T4). */
  bundle_name?: string | null;

  // ── T1/T2/T3 rollup ──
  progress_rollup?: number;

  // ── T2 only ──
  management_notes?: string;
  blocker_alert?: string | null;
}

/**
 * TierItemDto — payload gửi lên khi tạo item mới (`POST /api/tasks`).
 * Khác `TaskApiRowDto`: đây là input, không phải output.
 */
export interface TierItemDto {
  id?: number;
  code?: string;
  tier: 1 | 2 | 3 | 4;
  title: string;
  /**
   * Id của cha theo tier (T2→project_id, T3→phase_id, T4→bundle_id).
   * Backend nhận đúng tên `parent_id` và dispatch theo `tier`
   * (xem routes/tasks.js POST). Bắt buộc với T2/T3; T4 có thể null.
   */
  parent_id?: number | null;
  /** Backend nhận `owner_username` và tự tra `owner_user_id`. */
  owner_username?: string | null;
  owner_user_id?: number | null;
  department_code?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  progress?: number;
  status?: string;
  priority?: string;
  description?: string;
  management_notes?: string;
  blocker_alert?: string | null;
  collapsed?: number;
  created_by_user_id?: number;
  assigned_by_user_id?: number | null;
  /** Chỉ T4: đánh dấu "việc hôm nay". */
  is_today?: number;
  /** Chỉ T4: ngày cụ thể của cờ hôm nay (YYYY-MM-DD). */
  is_today_date?: string | null;
}

export interface DailyLogDto {
  taskId: number;
  description: string;
  result?: string;
  obstacle?: string;
  progress: number;
}

/** TeamLeadTaskDto / EmployeeTaskDto đã bị xoá: `/api/tasks` đã hợp nhất 4 tier
 * về 1 endpoint. `transforms.ts` nhận `TaskApiRowDto` rồi phân nhánh theo tier. */

export interface TeamMemberDto {
  id: string;
  username: string;
  name: string;
  role: string;
  department?: string;
  statusText: string;
  /** Backend trả 'good' | 'warning' | 'idle' (xem routes/teamMembers.js:62). */
  statusType: 'good' | 'warning' | 'idle';
  activeTasks: number;
  totalTasks?: number;
  needHelp: boolean;
  workloadPercent: number;
  onTimeRate?: string;
  avatar?: string;
}

export interface DailyLogRowDto {
  id: number;
  task_id: number;
  log_date: string;
  description: string;
  result: string | null;
  obstacle: string | null;
  progress: number;
  author_user_id: number;
  /** LEFT JOIN users — tên người viết log. */
  user_username_str: string | null;
  user_fullname: string | null;
  created_at: string;
}

export interface HistoryEntryDto {
  id: number;
  entity_type: 'project' | 'phase' | 'bundle' | 'task' | 'daily_log' | 'task_help_message' | 'user';
  entity_id: number;
  action: string;
  actor_user_id: number | null;
  /** Snapshot tên user tại thời điểm ghi — giữ lại kể cả user đã bị xoá. */
  actor_username: string | null;
  actor_ip?: string | null;
  old_values: string | null;
  new_values: string | null;
  created_at: string;
  /** LEFT JOIN users trong routes/history.js — có thể null nếu actor đã xoá. */
  author_username_str?: string | null;
  author_fullname_str?: string | null;
}

export interface HelpMessageDto {
  id: number;
  task_id: number;
  body: string;
  author_user_id: number;
  author_fullname?: string | null;
  author_username?: string | null;
  is_resolved: number;
  resolved_by_user_id?: number | null;
  resolved_at?: string | null;
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

  /**
   * GET /api/auth/me — Current authenticated user.
   * Dùng để restore session sau khi reload: kiểm tra token còn hợp lệ.
   * Trả về user info (kèm departments) hoặc fail với 401 khi token invalid/expired.
   */
  async me() {
    return request<{ user: import('./apiClient').MeUser }>('GET', '/api/auth/me');
  },

  // --- Tasks (unified 4-tier endpoint) ---
  /**
   * GET /api/tasks — List theo role. Backend trả TẤT CẢ 4 tier, mỗi row có
   * field `tier` (1–4). `canSee` lọc theo role + department phía backend.
   */
  async listTasks() {
    return request<{ items: TaskApiRowDto[] }>('GET', '/api/tasks');
  },
  /** GET /api/tasks/:tier/:id — tier ∈ {1,2,3,4}. Response trả `{ item }`. */
  async getTask(tier: number, id: number) {
    return request<{ item: TaskApiRowDto }>(
      'GET', `/api/tasks/${tier}/${id}`
    );
  },
  /** POST /api/tasks — body chứa `tier` để dispatch. */
  async createTask(item: TierItemDto) {
    return request<{ item: TaskApiRowDto }>('POST', '/api/tasks', item);
  },
  /** PATCH /api/tasks/:tier/:id. */
  async updateTask(tier: number, id: number, patch: Partial<TierItemDto>) {
    return request<{ item: TaskApiRowDto }>('PATCH', `/api/tasks/${tier}/${id}`, patch);
  },
  /** DELETE /api/tasks/:tier/:id. */
  async deleteTask(tier: number, id: number) {
    return request('DELETE', `/api/tasks/${tier}/${id}`);
  },

  // --- Sub-resource trên task (daily_logs + blocker_note) ---
  async approveTask(tier: number, id: number) {
    return request<{ item: TaskApiRowDto }>('POST', `/api/tasks/${tier}/${id}/approve`);
  },
  /** POST /api/tasks/4/:id/blocker — NV ghi 1 dòng blocker_note (escalation). */
  async setTaskBlocker(tier: number, id: number, note: string) {
    return request<{ item: TaskApiRowDto; blocker_note: string }>(
      'POST', `/api/tasks/${tier}/${id}/blocker`, { note }
    );
  },
  async toggleTask(tier: number, id: number) {
    return request<{ item: TaskApiRowDto }>('POST', `/api/tasks/${tier}/${id}/toggle`);
  },
  /** POST /api/tasks/4/:id/toggle-today — bật/tắt cờ "việc hôm nay". */
  async toggleToday(tier: number, id: number) {
    return request<{ item: TaskApiRowDto }>('POST', `/api/tasks/${tier}/${id}/toggle-today`);
  },
  /** GET /api/tasks/4/:id/help-messages — lịch sử escalation. */
  async listHelpMessages(tier: number, id: number) {
    return request<{ items: HelpMessageDto[] }>('GET', `/api/tasks/${tier}/${id}/help-messages`);
  },

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