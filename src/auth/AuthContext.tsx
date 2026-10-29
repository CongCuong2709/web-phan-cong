/**
 * AuthContext — single source of truth cho "ai đang đăng nhập".
 *
 * localStorage chỉ còn 2 mục đích hợp lệ:
 *   1. `mvp_token`      — JWT bearer token (đọc bởi apiClient để gắn vào mọi request)
 *   2. `mvp_session_v1` — user ID hiện tại, để restore session sau khi F5/reload trang
 *
 * Tất cả data nghiệp vụ (tier items, tasks, members…) đến từ backend API sau login.
 *
 * Auto-restore: khi mount mà có token, gọi /api/auth/me để re-hydrate user + departments
 * (xem `restoreStatus`). Token không hợp lệ → 401 → về trang đăng nhập.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Department, User } from '../types';
import { api, getToken } from '../lib/apiClient';

/** Chỉ giữ session ID để restore "ai đang login" sau khi reload trang. */
const SESSION_KEY = 'mvp_session_v1';

const loadSessionUserId = (): string | null => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};

export interface AuthContextValue {
  user: User | null;
  users: User[];
  /** Trạng thái khôi phục phiên khi tải trang — App không hiện trang đăng nhập khi đang 'checking'/'failed'. */
  restoreStatus: 'checking' | 'failed' | 'done';
  retryRestore: () => void;
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  logout: () => void;
  /** Refresh users (e.g. sau khi admin edit profile). */
  setUsers: (next: User[]) => void;
  /** True nếu current user thấy items thuộc `department`. */
  canSeeDepartment: (dept?: Department) => boolean;
  /** True nếu current user thấy "Việc của tôi" của `username`. */
  canSeeOwner: (ownerUsername?: string) => boolean;
  /** Resolve 1 user by username. */
  findUser: (username?: string) => User | undefined;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  /**
   * `users` — danh sách users đang biết phía frontend.
   * Khởi tạo rỗng — backend `/api/users` (cho manager/admin) hoặc `user` payload từ
   * login (cho employee) sẽ populate sau khi đăng nhập.
   */
  const [users, setUsersState] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => loadSessionUserId());

  /** Persist session ID để restore sau reload — KHÔNG persist users list. */
  useEffect(() => {
    try {
      if (currentUserId) localStorage.setItem(SESSION_KEY, currentUserId);
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, [currentUserId]);

  /**
   * Khôi phục phiên sau khi tải lại trang: có token thì hỏi /api/auth/me.
   *   - 'checking' — đang hỏi; App hiện màn chờ thay vì trang đăng nhập.
   *   - 'failed'   — không liên lạc được máy chủ; token vẫn giữ, người dùng bấm thử lại.
   *   - 'done'     — đã có kết quả (đăng nhập lại được, hoặc token hết hạn → trang đăng nhập).
   */
  const [restoreStatus, setRestoreStatus] = useState<'checking' | 'failed' | 'done'>(
    () => (getToken() ? 'checking' : 'done'),
  );

  const restoreSession = useCallback(async () => {
    if (!getToken()) {
      setRestoreStatus('done');
      return;
    }
    setRestoreStatus('checking');
    const r = await api.me();
    if (r.ok) {
      const u = r.data.user;
      const hydrated: User = {
        id: String(u.id),
        username: u.username,
        fullname: u.fullname,
        email: u.email ?? '',
        role: u.role,
        departments: Array.isArray(u.departments) ? (u.departments as Department[]) : [],
        initial: u.fullname?.charAt(0) ?? '',
        avatar: u.avatar_url ?? '',
      };
      setUsersState([hydrated]);
      setCurrentUserId(hydrated.id);
      setRestoreStatus('done');
    } else if (r.networkError || r.error.error === 'internal') {
      setRestoreStatus('failed');
    } else {
      // 401: apiClient đã xoá token và phát 'auth:logout'.
      setCurrentUserId(null);
      setRestoreStatus('done');
    }
  }, []);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // Máy chủ trả 401 cho bất kỳ request nào (token hết hạn / bị thu hồi) → về trang đăng nhập.
  useEffect(() => {
    const onLogout = () => {
      setCurrentUserId(null);
      setUsersState([]);
    };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const user = useMemo(
    () => users.find((u) => u.id === currentUserId) ?? null,
    [users, currentUserId]
  );

  /**
   * Login: gọi backend API duy nhất.
   * - Success → save token (apiClient), merge user từ backend vào state, set session.
   * - Network error / 401 → trả message lỗi rõ ràng.
   */
  const login = useCallback(
    async (username: string, password: string) => {
      const trimmed = username.trim();

      const apiResult = await api.login(trimmed, password);
      if (apiResult.ok) {
        const backendUser = apiResult.data.user;
        const backendId = String(backendUser.id);

        // Ưu tiên departments từ backend response (fetch từ user_departments table).
        // Fallback sang string CSV hoặc existing user nếu backend chưa trả departments.
        const existing = users.find((u) => u.id === backendId || u.username.toLowerCase() === backendUser.username.toLowerCase());
        const rawDepts = backendUser.departments;
        const backendDepts: Department[] =
          Array.isArray(rawDepts) && rawDepts.length > 0
            ? (rawDepts as Department[])
            : typeof rawDepts === 'string' && rawDepts.trim()
            ? (rawDepts.split(',').map((d) => d.trim()) as Department[])
            : (existing?.departments ?? []);

        const merged: User = {
          id: backendId,
          username: backendUser.username,
          fullname: backendUser.fullname,
          email: backendUser.email ?? existing?.email,
          role: backendUser.role,
          departments: backendDepts,
          avatar: backendUser.avatar_url ?? existing?.avatar,
          initial: backendUser.initial ?? existing?.initial ?? backendUser.fullname.charAt(0),
        };

        setUsersState((prev) => {
          const without = prev.filter((u) => u.id !== backendId && u.username.toLowerCase() !== backendUser.username.toLowerCase());
          return [...without, merged];
        });
        setCurrentUserId(backendId);
        return { ok: true as const };
      }

      // Backend lỗi (network hoặc 4xx/5xx) — trả message gốc.
      const reason = apiResult.networkError
        ? 'Không kết nối được backend. Vui lòng kiểm tra mạng hoặc liên hệ admin.'
        : (apiResult.error.message ?? 'Sai tài khoản hoặc mật khẩu.');
      return { ok: false as const, reason };
    },
    [users]
  );

  const logout = useCallback(() => {
    setCurrentUserId(null);
    api.logout().catch(() => { /* swallow */ });
  }, []);

  const setUsers = useCallback((next: User[]) => setUsersState(next), []);

  const canSeeDepartment = useCallback(
    (dept?: Department) => {
      if (!user) return false;
      const userDepts = user.departments ?? [];
      if (!userDepts.length) return true; // admin sentinel (departments rỗng = all-access)
      if (!dept) return true; // item không tag department → mọi người thấy
      return userDepts.includes(dept);
    },
    [user]
  );

  const canSeeOwner = useCallback(
    (ownerUsername?: string) => {
      if (!user) return false;
      if (user.role === 'admin' || user.role === 'board' || user.role === 'director') return true;
      if (user.role === 'manager') {
        if (!ownerUsername) return true;
        const owner = users.find((u) => u.username.toLowerCase() === ownerUsername.toLowerCase());
        if (!owner) return true;
        const userDepts = user.departments ?? [];
        const ownerDepts = owner.departments ?? [];
        return ownerDepts.some((d) => userDepts.includes(d));
      }
      return ownerUsername?.toLowerCase() === user.username.toLowerCase();
    },
    [user, users]
  );

  const findUser = useCallback(
    (username?: string) => (username ? users.find((u) => u.username === username) : undefined),
    [users]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      users,
      restoreStatus,
      retryRestore: restoreSession,
      login,
      logout,
      setUsers,
      canSeeDepartment,
      canSeeOwner,
      findUser,
    }),
    [user, restoreStatus, restoreSession, login, logout, setUsers, canSeeDepartment, canSeeOwner, findUser, users]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
};