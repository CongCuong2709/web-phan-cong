/**
 * apiClient.ts — HTTP client gọi backend Express server.
 *
 * localStorage chỉ được dùng cho JWT token (`mvp_token`).
 * Mọi data nghiệp vụ đến từ API — không có localStorage cache.
 *
 * Mọi hàm trả `ApiResponse` (không throw). Nơi gọi PHẢI xử lý nhánh `ok: false`
 * — dùng `describeApiError()` để báo cho người dùng; không nuốt lỗi.
 */

// Backend mặc định chạy ở :3001 (backend/.env.example PORT=3001).
const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001';
const TOKEN_KEY = 'mvp_token';

/** board = HĐQT, director = Điều hành, manager = Trưởng phòng, employee = Nhân viên. */
export type UserRole = 'admin' | 'board' | 'director' | 'manager' | 'employee';

/** User object trả về từ /api/auth/me (subset đủ dùng để restore session). */
export interface MeUser {
  id: number;
  username: string;
  fullname: string;
  email?: string;
  role: UserRole;
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: unknown,
  opts: {
    timeoutMs?: number;
    requireAuth?: boolean;
    /** Gửi nguyên nội dung tệp thay cho JSON (tải tệp lên). */
    raw?: Blob;
    /** Nhận nội dung nhị phân (tải tệp xuống) thay cho JSON. */
    blob?: boolean;
  } = {}
): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': opts.raw ? opts.raw.type || 'application/octet-stream' : 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
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

    const data = opts.blob ? await res.blob() : await res.json();
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
    role: UserRole;
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

  // ── Người phụ trách của chuỗi cha (dùng cho phân quyền phía UI) ──
  /** Điều hành phụ trách dự án chứa mục này (với T1 = chính owner). */
  project_owner_user_id: number;
  /** Chỉ T4: Trưởng phòng phụ trách hạng mục chứa đầu việc. */
  bundle_owner_user_id?: number;

  // ── T1 project ──
  // (project là root, không có parent FK)

  // ── T2 phase ──
  project_id?: number | null;

  // ── T3 bundle ──
  phase_id?: number | null;

  // ── T4 task ──
  bundle_id: number | null;
  /** T3: phòng của hạng mục. T4: phòng của đầu việc (= phòng của hạng mục). */
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

  // ── T4: đếm sẵn ở GET /api/tasks (không có ở GET /api/tasks/:tier/:id) ──
  /** Số tin trong luồng trao đổi. */
  message_count?: number;
  /** Số lần báo vướng mắc / số vướng mắc chưa được gỡ. */
  blocker_count?: number;
  open_blocker_count?: number;
  /** Thời điểm (UTC) của vướng mắc chưa gỡ gần nhất. */
  open_blocker_at?: string | null;
  /** Số tệp đính kèm khi tạo / giao việc (không tính tệp trong tin trao đổi). */
  attachment_count?: number;

  // ── Lưu trữ ──
  /** Chỉ T1/T2: thời điểm lưu trữ (null = đang hoạt động). */
  archived_at?: string | null;
  /** Do `GET /api/tasks` gắn: 1 nếu chính mục hoặc dự án / giai đoạn chứa nó đã lưu trữ. */
  archived?: number;

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
   * (xem routes/tasks.js POST). Bắt buộc với T2–T4.
   */
  parent_id?: number | null;
  /** Người phụ trách: T1 = Điều hành, T3 = Trưởng phòng, T4 = người làm. T2 bỏ qua. */
  owner_username?: string | null;
  owner_user_id?: number | null;
  /** Chỉ T3: phòng của hạng mục (mặc định = phòng đầu tiên của Trưởng phòng). */
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
  /** Việc chưa báo xong (không tính chờ duyệt / đã xong). */
  activeTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  totalTasks: number;
  needHelp: boolean;
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

/** Loại tin trong luồng trao đổi — khớp CHECK `task_help_messages.kind` (backend/sql/schema.sql). */
export type TaskMessageKind = 'note' | 'blocker' | 'start' | 'submit' | 'approve' | 'return' | 'unblock';

/** 1 tệp đính kèm (GET /api/tasks/:tier/:id/attachments, hoặc `attachments` của 1 tin). */
export interface AttachmentDto {
  id: number;
  /** null với tệp của dự án / giai đoạn / hạng mục. */
  task_id: number | null;
  /** null = tệp của task; có giá trị = tệp gắn trong tin trao đổi đó. */
  message_id: number | null;
  original_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by_user_id: number;
  uploader_fullname: string | null;
  created_at: string;
}

/** 1 tin của luồng trao đổi (GET /api/tasks/4/:id/messages), cũ → mới. */
export interface TaskMessageDto {
  id: number;
  task_id: number;
  kind: TaskMessageKind;
  body: string;
  author_user_id: number;
  author_fullname?: string | null;
  author_username_str?: string | null;
  /** Chỉ có nghĩa với `kind = 'blocker'`. */
  is_resolved: number;
  resolved_by_user_id?: number | null;
  resolved_by_fullname?: string | null;
  resolved_at?: string | null;
  created_at: string;
  attachments: AttachmentDto[];
}

/** Ghi chú tuỳ chọn kèm thao tác đổi trạng thái; `with_files` khi sẽ gắn tệp ngay sau đó. */
export interface ActionNote {
  note?: string;
  with_files?: boolean;
}

/** Thao tác có thể sinh 1 tin trao đổi trả về `message_id` (null khi không có ghi chú). */
interface WithMessageId {
  message_id?: number | null;
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
  /** Duyệt / nghiệm thu. Ghi chú chỉ có tác dụng với T4. */
  async approveTask(tier: number, id: number, note?: ActionNote) {
    return request<{ item: TaskApiRowDto } & WithMessageId>('POST', `/api/tasks/${tier}/${id}/approve`, note);
  },
  /** POST /api/tasks/4/:id/blocker — NV ghi 1 dòng blocker_note (escalation). */
  async setTaskBlocker(tier: number, id: number, note: string) {
    return request<{ item: TaskApiRowDto; blocker_note: string }>(
      'POST', `/api/tasks/${tier}/${id}/blocker`, { note }
    );
  },
  /** POST /api/tasks/4/:id/return — TP trả việc chờ duyệt về làm lại (lý do bắt buộc). */
  async returnTask(id: number, reason: string, withFiles = false) {
    return request<{ item: TaskApiRowDto } & WithMessageId>(
      'POST', `/api/tasks/4/${id}/return`, { reason, with_files: withFiles }
    );
  },
  /** POST /api/tasks/4/:id/unblock — TP gỡ vướng mắc (xoá blocker_note, đóng các vướng mắc đang mở). */
  async unblockTask(id: number, note: string, withFiles = false) {
    return request<{ item: TaskApiRowDto } & WithMessageId>(
      'POST', `/api/tasks/4/${id}/unblock`, { note, with_files: withFiles }
    );
  },
  /** POST /api/tasks/:tier/:id/archive|unarchive — lưu trữ / khôi phục dự án, giai đoạn. */
  async setArchived(tier: number, id: number, archived: boolean) {
    return request<{ item: TaskApiRowDto }>(
      'POST', `/api/tasks/${tier}/${id}/${archived ? 'archive' : 'unarchive'}`
    );
  },
  async toggleTask(tier: number, id: number, note?: ActionNote) {
    return request<{ item: TaskApiRowDto } & WithMessageId>('POST', `/api/tasks/${tier}/${id}/toggle`, note);
  },

  // --- Trao đổi (chỉ T4) + tệp đính kèm (mọi tầng) ---
  /** GET /api/tasks/4/:id/messages — luồng trao đổi, cũ → mới, kèm tệp của từng tin. */
  async listMessages(taskId: number) {
    return request<{ items: TaskMessageDto[] }>('GET', `/api/tasks/4/${taskId}/messages`);
  },
  /** POST /api/tasks/4/:id/messages — ghi chú hoặc báo vướng mắc. */
  async postMessage(taskId: number, body: string, kind: 'note' | 'blocker', withFiles = false) {
    return request<{ item: TaskApiRowDto; message_id: number }>(
      'POST', `/api/tasks/4/${taskId}/messages`, { body, kind, with_files: withFiles }
    );
  },
  /** GET /api/tasks/:tier/:id/attachments — mọi tệp của mục (với đầu việc: kể cả tệp trong tin, có message_id). */
  async listAttachments(tier: number, id: number) {
    return request<{ items: AttachmentDto[] }>('GET', `/api/tasks/${tier}/${id}/attachments`);
  },
  /** POST /api/tasks/:tier/:id/attachments — 1 tệp mỗi lần; `messageId` (chỉ T4) để gắn vào tin vừa gửi. */
  async uploadAttachment(tier: number, id: number, file: File, messageId?: number | null) {
    const qs = new URLSearchParams({ name: file.name });
    if (messageId) qs.set('message_id', String(messageId));
    return request<{ item: AttachmentDto }>(
      'POST', `/api/tasks/${tier}/${id}/attachments?${qs}`, undefined, { raw: file, timeoutMs: 120_000 }
    );
  },
  /** GET /api/attachments/:id — nội dung tệp (cần token nên không dùng link trực tiếp). */
  async downloadAttachment(id: number) {
    return request<Blob>('GET', `/api/attachments/${id}`, undefined, { blob: true, timeoutMs: 120_000 });
  },
  async deleteAttachment(id: number) {
    return request('DELETE', `/api/attachments/${id}`);
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

  // --- Users (dropdown người phụ trách trong NewItemModal) ---
  /**
   * GET /api/users — danh bạ để chọn người phụ trách (HĐQT chọn Điều hành, Điều hành chọn
   * Trưởng phòng, Trưởng phòng chọn nhân viên). Nhân viên bị 403.
   */
  async listUsers(department?: string) {
    const qs = department ? `?department=${encodeURIComponent(department)}` : '';
    return request<{
      users: Array<{
        id: number;
        username: string;
        fullname: string;
        email?: string | null;
        role: UserRole;
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
  /** GET /api/history?entity_type=&entity_id= — lịch sử của 1 đối tượng (mọi role đã đăng nhập). */
  async listEntityHistory(entityType: HistoryEntryDto['entity_type'], entityId: number) {
    const qs = new URLSearchParams({ entity_type: entityType, entity_id: String(entityId) });
    return request<{ items: HistoryEntryDto[] }>('GET', `/api/history?${qs}`);
  },

  // --- Weekly reports (không có bước duyệt) ---
  /** GET /api/weekly-reports?week=YYYY-MM-DD[&user=<id>] — item null = chưa có report. */
  async getWeeklyReport(week: string, userId?: number) {
    const qs = new URLSearchParams({ week });
    if (userId) qs.set('user', String(userId));
    return request<{ item: WeeklyReportDto | null; weekBounds?: { start: string; end: string } }>(
      'GET', `/api/weekly-reports?${qs}`
    );
  },
  /** PUT /api/weekly-reports — body { week_start, rows }. Chỉ tuần hiện tại mới OK. */
  async putWeeklyReport(body: { week_start: string; rows: WeeklyReportRowDto[] }) {
    return request<{ ok: boolean; week_start: string; week_end: string; rows: WeeklyReportRowDto[]; updated_at: string }>(
      'PUT', '/api/weekly-reports', body
    );
  },
  /** GET /api/weekly-reports/history — các tuần đã lập (chỉ tuần có data). */
  async getWeeklyReportHistory(limit = 26) {
    return request<{ items: WeeklyReportHistoryDto[] }>(
      'GET', `/api/weekly-reports/history?limit=${limit}`
    );
  },
  /** GET /api/weekly-reports/team?week= — tổng hợp người viết (NV + TP) trong phạm vi được xem. */
  async getWeeklyReportTeam(week: string) {
    return request<{ items: WeeklyTeamMemberDto[]; week: string }>(
      'GET', `/api/weekly-reports/team?week=${encodeURIComponent(week)}`
    );
  },
};

/** 1 tuần trong lịch sử (chỉ những tuần thực sự có rows). */
export interface WeeklyReportHistoryDto {
  week_start: string;
  week_end: string;
  row_count: number;
  blocked_count: number;
  updated_at: string;
}

/** 1 dòng tổng hợp phòng ban — KHÔNG chứa rows (tiết kiệm payload). */
export interface WeeklyTeamMemberDto {
  user_id: number;
  username: string;
  fullname: string;
  role: 'manager' | 'employee';
  departments: string[];
  row_count: number;
  blocked_count: number;
  updated_at: string | null;
  submitted: boolean;
}

export interface WeeklyReportRowDto {
  id: string;
  name: string;
  result: string;
  status: 'Hoàn thành' | 'Đang làm' | 'Chưa bắt đầu' | 'Vướng mắc';
  blocker: string;
}

export interface WeeklyReportDto {
  user_id: number;
  week_start: string;
  week_end: string;
  rows: WeeklyReportRowDto[];
  updated_at: string;
}

const ERROR_TEXT: Record<string, string> = {
  forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  not_found: 'Dữ liệu không còn tồn tại — có thể đã bị xoá.',
  invalid_transition: 'Không thể chuyển sang trạng thái này.',
  invalid_date: 'Ngày không hợp lệ.',
  missing_description: 'Cần nhập mô tả công việc.',
  note_required: 'Cần nhập nội dung vướng mắc.',
  body_required: 'Cần nhập nội dung.',
  reason_required: 'Cần nhập lý do trả về.',
  file_too_large: 'Tệp vượt quá 25 MB.',
  file_type_not_allowed: 'Định dạng tệp không được hỗ trợ.',
  timeout: 'Máy chủ phản hồi quá lâu.',
  network: 'Không kết nối được máy chủ.',
};

/**
 * Câu báo lỗi tiếng Việt cho người dùng từ một response thất bại.
 * Ưu tiên `message` do backend trả (đã là tiếng Việt), rồi tới bảng mã lỗi.
 */
export function describeApiError(r: { ok: false; error: ApiError; networkError: boolean }): string {
  if (r.networkError) {
    return `${ERROR_TEXT[r.error.error] ?? ERROR_TEXT.network} Thay đổi chưa được lưu.`;
  }
  return r.error.message || ERROR_TEXT[r.error.error] || `Lỗi máy chủ (${r.error.error}).`;
}

export const apiBaseUrl = API_BASE;