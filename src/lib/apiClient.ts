/**
 * apiClient.ts — HTTP client gọi backend Express server.
 *
 * Phase 1 (dual-write): frontend vẫn dùng localStorage làm source of truth
 * cho UI, nhưng đồng thời gọi API để sync dữ liệu lên backend.
 * Nếu API down → app vẫn chạy bình thường (graceful degradation).
 *
 * Phase 2 (backend-only): bỏ localStorage, dùng React Query.
 *
 * Usage:
 *   import { api } from './lib/apiClient';
 *   await api.login('admin', 'admin123');
 *   api.createTierItem({ ... });  // fire-and-forget
 */

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001';
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

interface ApiError {
  error: string;
  message?: string;
}

async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; requireAuth?: boolean } = {}
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError; networkError: boolean }> {
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
    return request('POST', '/api/tier-items', item);
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
    return request<{ tasks: unknown[] }>('GET', '/api/team-tasks');
  },
  async approveTask(id: number) {
    return request('POST', `/api/team-tasks/${id}/approve`);
  },
  async resolveHelp(id: number) {
    return request('POST', `/api/team-tasks/${id}/resolve`);
  },

  // --- Employee tasks ---
  async listEmployeeTasks() {
    return request<{ tasks: unknown[] }>('GET', '/api/employee-tasks');
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
    return request<{ requests: unknown[] }>('GET', '/api/help-requests');
  },

  // --- Team members (derived) ---
  async listTeamMembers() {
    return request<{ members: unknown[] }>('GET', '/api/team-members');
  },

  // --- Subtasks + Daily logs ---
  async listSubtasks() {
    return request<{ items: unknown[] }>('GET', '/api/subtasks');
  },
  async listDailyLogs() {
    return request<{ items: unknown[] }>('GET', '/api/daily-logs');
  },

  // --- History ---
  async listHistory(limit = 50) {
    return request<{ items: unknown[] }>('GET', `/api/history?limit=${limit}`);
  },
};

/**
 * Helper: fire-and-forget helper. Log lỗi nhẹ ra console nhưng không throw.
 * Dùng cho dual-write — UI không bao giờ bị block vì API lỗi.
 */
export function fireAndForget<T>(
  promise: Promise<{ ok: true; data: T } | { ok: false; error: ApiError; networkError: boolean }>,
  context: string
): void {
  promise.then((r) => {
    if (!r.ok && r.networkError) {
      console.debug(`[api/${context}] skipped (backend offline)`);
    } else if (!r.ok) {
      console.debug(`[api/${context}] failed:`, r.error);
    }
  });
}

export const apiBaseUrl = API_BASE;