/**
 * AuthContext — single source of truth cho "ai đang đăng nhập".
 *
 * localStorage chỉ còn 2 mục đích hợp lệ:
 *   1. `mvp_token`      — JWT bearer token (đọc bởi apiClient để gắn vào mọi request)
 *   2. `mvp_session_v1` — user ID hiện tại, để restore session sau khi F5/reload trang
 *
 * Tất cả data nghiệp vụ (tier items, tasks, members…) đến từ backend API sau login.
 * Offline fallback: nếu backend down → dùng plaintext password từ SEED_USERS.
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
import { SEED_USERS } from '../data/users';
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
   * Khởi tạo bằng SEED_USERS (cho offline fallback).
   * Sau khi login thành công sẽ được merge với user thật từ backend.
   */
  const [users, setUsersState] = useState<User[]>(SEED_USERS);
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

  const user = useMemo(
    () => users.find((u) => u.id === currentUserId) ?? null,
    [users, currentUserId]
  );

  /**
   * Login: ưu tiên gọi backend API.
   * - Success → save token (apiClient), merge user từ backend vào state, set session.
   * - Network error → fallback local SEED_USERS (plaintext check).
   * - 401 → trả message lỗi từ backend.
   */
  const login = useCallback(
    async (username: string, password: string) => {
      const trimmed = username.trim();

      // 1. Try backend API
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
          password: '', // không bao giờ lưu plaintext sau khi backend login
        };

        setUsersState((prev) => {
          const without = prev.filter((u) => u.id !== backendId && u.username.toLowerCase() !== backendUser.username.toLowerCase());
          return [...without, merged];
        });
        setCurrentUserId(backendId);
        return { ok: true as const };
      }

      // 2. Failure branch (check network error or backend error)
      if (!apiResult.ok) {
        if (apiResult.networkError) {
          const match = SEED_USERS.find((u) => u.username.toLowerCase() === trimmed.toLowerCase());
          if (match && match.password === password) {
            // Đảm bảo user có trong state khi offline
            setUsersState((prev) =>
              prev.some((u) => u.id === match.id) ? prev : [...prev, match]
            );
            setCurrentUserId(match.id);
            return { ok: true as const };
          }
          return { ok: false as const, reason: 'Sai tài khoản/mật khẩu (backend offline).' };
        }

        // 3. 401 từ backend → trả message gốc
        return { ok: false as const, reason: apiResult.error.message ?? 'Sai tài khoản hoặc mật khẩu.' };
      }
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