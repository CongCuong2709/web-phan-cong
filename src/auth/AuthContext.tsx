/**
 * AuthContext — single source of truth cho "ai đang đăng nhập".
 *
 * localStorage chỉ còn 2 mục đích hợp lệ:
 *   1. `mvp_token`      — JWT bearer token (đọc bởi apiClient để gắn vào mọi request)
 *   2. `mvp_session_v1` — user ID hiện tại, để restore session sau khi F5/reload trang
 *
 * Tất cả data nghiệp vụ (tier items, tasks, members…) đến từ backend API sau login.
 *
 * Auto-restore: khi component mount và có token trong localStorage nhưng `user === null`
 * (do users state bị reset sau reload), gọi /api/auth/me để re-hydrate user + departments.
 * Nếu token không hợp lệ → 401 → clear session.
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
import { api } from '../lib/apiClient';

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
   * Auto-restore session on mount.
   *
   * Sau khi F5/reload, React state `users` rỗng; currentUserId được restore từ
   * localStorage nhưng `user = useMemo(() => users.find(...), [...])` sẽ trả null
   * → AppShell render `<LoginPage />` mặc dù token vẫn còn hiệu lực.
   *
   * Fix: nếu có token trong localStorage mà `users` rỗng và chưa có user,
   * gọi /api/auth/me để re-hydrate user. Nếu 401 → clearSession.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Có token hợp lệ + đang ở trạng thái login (currentUserId = null sau reload
      // nhưng session key có data). Tuy nhiên currentUserId đã restore từ loadSessionUserId
      // nên user = find(...) ?? null. Logic rehydrate: nếu currentUserId có mà user null
      // → gọi /api/auth/me.
      // (Đơn giản hơn: chỉ cần có token + users rỗng là rehydrate, độc lập currentUserId.)
      try {
        const hasToken =
          typeof localStorage !== 'undefined' &&
          !!localStorage.getItem('mvp_token');
        if (!hasToken) return;
        // Tránh rehydrate trùng lặp nếu user đã có (vd. vừa setUsers ở login callback)
        if (users.length > 0) return;

        const r = await api.me();
        if (cancelled) return;
        if (r.ok && r.data?.user) {
          const u = r.data.user;
          // Populate users state để useMemo `user` resolve được.
          const backendDepts: Department[] = Array.isArray(u.departments)
            ? (u.departments as Department[])
            : [];
          const hydrated: User = {
            id: String(u.id),
            username: u.username,
            fullname: u.fullname,
            email: u.email ?? '',
            role: u.role,
            departments: backendDepts,
            initial: u.fullname?.charAt(0) ?? '',
            avatar: u.avatar_url ?? '',
          };
          setUsersState([hydrated]);
          setCurrentUserId(String(u.id));
        } else if (!r.ok && (r.error as { error?: string })?.error) {
          // Token invalid/expired/revoked → clear session
          const errCode = (r.error as { error?: string }).error;
          if (
            errCode === 'invalid_token' ||
            errCode === 'token_expired' ||
            errCode === 'session_revoked' ||
            errCode === 'session_expired' ||
            errCode === 'user_inactive'
          ) {
            setCurrentUserId(null);
            try {
              localStorage.removeItem('mvp_token');
            } catch {/* ignore */}
          }
        }
      } catch {
        /* network error — giữ state, user sẽ phải login lại */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Chỉ chạy 1 lần khi mount — tránh loop với setUsersState.

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
      if (user.role === 'admin' || user.role === 'director') return true;
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
      login,
      logout,
      setUsers,
      canSeeDepartment,
      canSeeOwner,
      findUser,
    }),
    [user, login, logout, setUsers, canSeeDepartment, canSeeOwner, findUser, users]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
};