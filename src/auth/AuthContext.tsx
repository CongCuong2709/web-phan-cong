/**
 * AuthContext — single source of truth cho "ai đang đăng nhập".
 *
 * Phase 1 (dual-write): login ưu tiên gọi backend API (bcrypt verify).
 * Nếu backend offline → fallback dùng local SEED_USERS (plaintext).
 *
 * Lưu ý: mọi mutation trên users (setUsers) vẫn persist localStorage
 * để dùng khi backend down.
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

const USERS_KEY = 'mvp_users_v1';
const SESSION_KEY = 'mvp_session_v1';

const loadUsers = (): User[] => {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) return JSON.parse(raw) as User[];
  } catch {
    /* ignore corrupt storage */
  }
  localStorage.setItem(USERS_KEY, JSON.stringify(SEED_USERS));
  return SEED_USERS;
};

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
  /** Demo-only quick-login (e.g. từ "Tài khoản demo" list). */
  loginAs: (username: string) => void;
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
  const [users, setUsersState] = useState<User[]>(() => loadUsers());
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => loadSessionUserId());

  useEffect(() => {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch {
      /* ignore quota errors */
    }
  }, [users]);

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
   * - Success → save token, update users từ backend, set session.
   * - Network error → fallback local SEED_USERS check.
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

        // Merge backend user vào local users array (giữ local data: dept, avatar, etc.)
        const existing = users.find((u) => u.id === backendId || u.username === backendUser.username);
        const merged: User = {
          id: backendId,
          username: backendUser.username,
          fullname: backendUser.fullname,
          email: backendUser.email ?? existing?.email,
          role: backendUser.role,
          departments: existing?.departments ?? [],
          avatar: backendUser.avatar_url ?? existing?.avatar,
          initial: backendUser.initial ?? existing?.initial ?? backendUser.fullname.charAt(0),
          password: '', // never store plaintext after backend login
        };
        setUsersState((prev) => {
          const without = prev.filter((u) => u.id !== backendId);
          return [...without, merged];
        });
        setCurrentUserId(backendId);
        return { ok: true as const };
      }

      // 2. Network error → fallback local SEED_USERS check
      if (apiResult.networkError) {
        const match = users.find((u) => u.username.toLowerCase() === trimmed.toLowerCase());
        if (match && match.password === password) {
          setCurrentUserId(match.id);
          return { ok: true as const };
        }
        return { ok: false as const, reason: 'Sai tài khoản/mật khẩu (backend offline).' };
      }

      // 3. 401 từ backend → trả message gốc
      return { ok: false as const, reason: apiResult.error.message ?? 'Sai tài khoản hoặc mật khẩu.' };
    },
    [users]
  );

  const loginAs = useCallback(
    (username: string) => {
      // Demo quick-login: dùng password plaintext từ SEED_USERS.
      // Nếu backend up sẽ verify qua API; nếu offline thì dùng local.
      const seed = SEED_USERS.find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (!seed) return;
      login(seed.username, seed.password).catch(() => { /* swallow */ });
    },
    [login]
  );

  const logout = useCallback(() => {
    setCurrentUserId(null);
    api.logout().catch(() => { /* swallow */ });
  }, []);

  const setUsers = useCallback((next: User[]) => setUsersState(next), []);

  const canSeeDepartment = useCallback(
    (dept?: Department) => {
      if (!user) return false;
      if (!user.departments.length) return true; // admin sentinel
      if (!dept) return true; // untagged items are visible to anyone
      return user.departments.includes(dept);
    },
    [user]
  );

  const canSeeOwner = useCallback(
    (ownerUsername?: string) => {
      if (!user) return false;
      if (user.role === 'admin' || user.role === 'director') return true;
      if (user.role === 'manager') {
        if (!ownerUsername) return true;
        const owner = users.find((u) => u.username === ownerUsername);
        if (!owner) return true;
        return owner.departments.some((d) => user.departments.includes(d));
      }
      return ownerUsername === user.username;
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
      loginAs,
      setUsers,
      canSeeDepartment,
      canSeeOwner,
      findUser,
    }),
    [user, login, loginAs, logout, setUsers, canSeeDepartment, canSeeOwner, findUser, users]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
};