/**
 * AuthContext — single source of truth for "who is logged in" plus the small
 * helper predicates the views use to decide what a user is allowed to see.
 *
 * Storage strategy (MVP):
 *  - users persist under `mvp_users_v1` (allows future profile edits without
 *    re-seeding).
 *  - current session under `mvp_session_v1` (only `userId` is stored so the
 *    displayed name reflects the latest staff value).
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
  login: (username: string, password: string) => { ok: true } | { ok: false; reason: string };
  logout: () => void;
  /** Demo-only quick-login (e.g. from the "Tài khoản demo" list). */
  loginAs: (username: string) => void;
  /** Refresh users (e.g. after admin edits a profile). */
  setUsers: (next: User[]) => void;
  /** True if current user can see items belonging to `department`. */
  canSeeDepartment: (dept?: Department) => boolean;
  /** True if current user can see "Việc của tôi" items belonging to `username`. */
  canSeeOwner: (ownerUsername?: string) => boolean;
  /** Resolve a user by username (handy for sender/manager lookups). */
  findUser: (username?: string) => User | undefined;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsersState] = useState<User[]>(() => loadUsers());
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => loadSessionUserId());

  // Persist users whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch {
      /* ignore quota errors */
    }
  }, [users]);

  // Persist the active session id.
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

  const login = useCallback(
    (username: string, password: string) => {
      const trimmed = username.trim().toLowerCase();
      const match = users.find((u) => u.username.toLowerCase() === trimmed);
      if (!match) return { ok: false as const, reason: 'Không tìm thấy tài khoản.' };
      if (match.password !== password) {
        return { ok: false as const, reason: 'Mật khẩu không đúng.' };
      }
      setCurrentUserId(match.id);
      return { ok: true as const };
    },
    [users]
  );

  const loginAs = useCallback(
    (username: string) => {
      const match = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (match) setCurrentUserId(match.id);
    },
    [users]
  );

  const logout = useCallback(() => setCurrentUserId(null), []);

  const setUsers = useCallback((next: User[]) => setUsersState(next), []);

  const canSeeDepartment = useCallback(
    (dept?: Department) => {
      if (!user) return false;
      if (!user.departments.length) return true; // admin sentinel: no departments = unrestricted
      if (!dept) return true; // untagged items are visible to anyone
      return user.departments.includes(dept);
    },
    [user]
  );

  const canSeeOwner = useCallback(
    (ownerUsername?: string) => {
      if (!user) return false;
      // Admin / ĐH director can see everything.
      if (user.role === 'admin' || user.role === 'director') return true;
      // Manager: see emails in their department (we resolve through the user list).
      if (user.role === 'manager') {
        if (!ownerUsername) return true; // untagged tasks default to "team" visibility
        const owner = users.find((u) => u.username === ownerUsername);
        if (!owner) return true; // legacy data — keep visible to managers
        return owner.departments.some((d) => user.departments.includes(d));
      }
      // Employee: only their own.
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