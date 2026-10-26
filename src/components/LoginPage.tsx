import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/apiClient';
import { BrandMark } from './ui/Brand';

type Mode = 'login' | 'change-password';

const LoginPage: React.FC = () => {
  const { login } = useAuth();

  // Mode toggle: 'login' (mặc định) ↔ 'change-password'
  const [mode, setMode] = useState<Mode>('login');

  // Login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Change-password state
  const [cpUsername, setCpUsername] = useState('');
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);
  const [cpSuccess, setCpSuccess] = useState<string | null>(null);
  const [cpSubmitting, setCpSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }
    setSubmitting(true);
    const result = await login(username, password);
    setSubmitting(false);
    if (!result.ok) setError(result.reason);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpError(null);
    setCpSuccess(null);

    if (!cpUsername.trim() || !cpCurrent || !cpNew || !cpConfirm) {
      setCpError('Vui lòng nhập đầy đủ tất cả các trường.');
      return;
    }
    if (cpNew !== cpConfirm) {
      setCpError('Mật khẩu mới và xác nhận mật khẩu không khớp.');
      return;
    }

    setCpSubmitting(true);
    const r = await api.changePassword(cpUsername, cpCurrent, cpNew);
    setCpSubmitting(false);

    if (r.ok) {
      setCpSuccess('Đổi mật khẩu thành công. Bạn có thể đăng nhập với mật khẩu mới.');
      // Clear các field nhạy cảm
      setCpCurrent('');
      setCpNew('');
      setCpConfirm('');
      // Sau 1.5s chuyển về form login và pre-fill username
      setTimeout(() => {
        setUsername(cpUsername.trim());
        setPassword('');
        setCpUsername('');
        setCpSuccess(null);
        setMode('login');
      }, 1500);
    } else {
      setCpError(r.error.message ?? 'Đổi mật khẩu thất bại.');
    }
  };

  const switchMode = (next: Mode) => {
    setError(null);
    setCpError(null);
    setCpSuccess(null);
    setMode(next);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-container-low via-surface to-surface-container flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border border-surface-container shadow-xl p-7 sm:p-9 flex flex-col gap-6">
        {/* ===== Brand ===== */}
        <div className="flex items-center gap-3">
          <BrandMark className="h-10 w-10 shrink-0" />
          <span className="text-base font-bold text-on-surface">Hệ thống công việc và báo cáo TAG</span>
        </div>

        {/* ===== Title ===== */}
        <h1 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">
          {mode === 'login' ? 'Đăng nhập hệ thống' : 'Đổi mật khẩu'}
        </h1>

        {mode === 'login' ? (
          <>
            {/* ===== Login form ===== */}
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="username"
                  className="text-xs font-semibold text-on-surface uppercase tracking-wider"
                >
                  Tên đăng nhập
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Tên đăng nhập"
                  className="px-4 py-2.5 rounded-lg bg-surface-container-low border border-surface-container-high focus:border-primary focus:outline-none focus:bg-white text-sm text-on-surface placeholder:text-outline"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="password"
                  className="text-xs font-semibold text-on-surface uppercase tracking-wider"
                >
                  Mật khẩu
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mật khẩu"
                    className="w-full px-4 py-2.5 pr-12 rounded-lg bg-surface-container-low border border-surface-container-high focus:border-primary focus:outline-none focus:bg-white text-sm text-on-surface placeholder:text-outline"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-md flex items-center justify-center text-secondary hover:bg-surface-container-high transition-colors"
                    title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 bg-error-container/40 border border-error-fixed rounded-lg text-xs text-on-error-container font-medium">
                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">error</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 px-4 py-3 rounded-lg bg-primary hover:bg-primary-container disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">login</span>
                <span>{submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}</span>
              </button>
            </form>

            {/* ===== Switch to change-password ===== */}
            <div className="flex items-center justify-center gap-2 -mt-2 text-xs text-secondary">
              <span>Bạn muốn thay đổi mật khẩu?</span>
              <button
                type="button"
                onClick={() => switchMode('change-password')}
                className="font-semibold text-primary hover:text-primary-container hover:underline transition-colors"
              >
                Đổi mật khẩu
              </button>
            </div>
          </>
        ) : (
          <>
            {/* ===== Change-password form ===== */}
            <p className="text-xs text-secondary -mt-2">
              Nhập tên đăng nhập và mật khẩu hiện tại để đặt mật khẩu mới.
            </p>

            <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
              {/* Username */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="cp-username"
                  className="text-xs font-semibold text-on-surface uppercase tracking-wider"
                >
                  Tên đăng nhập
                </label>
                <input
                  id="cp-username"
                  type="text"
                  autoComplete="username"
                  value={cpUsername}
                  onChange={(e) => setCpUsername(e.target.value)}
                  placeholder="Tên đăng nhập"
                  className="px-4 py-2.5 rounded-lg bg-surface-container-low border border-surface-container-high focus:border-primary focus:outline-none focus:bg-white text-sm text-on-surface placeholder:text-outline"
                />
              </div>

              {/* Current password */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="cp-current"
                  className="text-xs font-semibold text-on-surface uppercase tracking-wider"
                >
                  Mật khẩu hiện tại
                </label>
                <div className="relative">
                  <input
                    id="cp-current"
                    type={showCurrent ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={cpCurrent}
                    onChange={(e) => setCpCurrent(e.target.value)}
                    placeholder="Nhập mật khẩu hiện tại"
                    className="w-full px-4 py-2.5 pr-12 rounded-lg bg-surface-container-low border border-surface-container-high focus:border-primary focus:outline-none focus:bg-white text-sm text-on-surface placeholder:text-outline"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-md flex items-center justify-center text-secondary hover:bg-surface-container-high transition-colors"
                    title={showCurrent ? 'Ẩn' : 'Hiện'}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                      {showCurrent ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* New password */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="cp-new"
                  className="text-xs font-semibold text-on-surface uppercase tracking-wider"
                >
                  Mật khẩu mới
                </label>
                <div className="relative">
                  <input
                    id="cp-new"
                    type={showNew ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={cpNew}
                    onChange={(e) => setCpNew(e.target.value)}
                    placeholder="Nhập mật khẩu mới"
                    className="w-full px-4 py-2.5 pr-12 rounded-lg bg-surface-container-low border border-surface-container-high focus:border-primary focus:outline-none focus:bg-white text-sm text-on-surface placeholder:text-outline"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-md flex items-center justify-center text-secondary hover:bg-surface-container-high transition-colors"
                    title={showNew ? 'Ẩn' : 'Hiện'}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                      {showNew ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Confirm new password */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="cp-confirm"
                  className="text-xs font-semibold text-on-surface uppercase tracking-wider"
                >
                  Xác nhận mật khẩu mới
                </label>
                <div className="relative">
                  <input
                    id="cp-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={cpConfirm}
                    onChange={(e) => setCpConfirm(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    className="w-full px-4 py-2.5 pr-12 rounded-lg bg-surface-container-low border border-surface-container-high focus:border-primary focus:outline-none focus:bg-white text-sm text-on-surface placeholder:text-outline"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-md flex items-center justify-center text-secondary hover:bg-surface-container-high transition-colors"
                    title={showConfirm ? 'Ẩn' : 'Hiện'}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                      {showConfirm ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {cpError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-error-container/40 border border-error-fixed rounded-lg text-xs text-on-error-container font-medium">
                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">error</span>
                  <span>{cpError}</span>
                </div>
              )}

              {cpSuccess && (
                <div className="flex items-center gap-2 px-3 py-2 bg-tertiary-fixed/30 border border-tertiary-fixed-dim rounded-lg text-xs text-tertiary font-medium">
                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">check_circle</span>
                  <span>{cpSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={cpSubmitting}
                className="w-full mt-2 px-4 py-3 rounded-lg bg-primary hover:bg-primary-container disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">lock_reset</span>
                <span>{cpSubmitting ? 'Đang đổi mật khẩu…' : 'Đổi mật khẩu'}</span>
              </button>
            </form>

            {/* ===== Switch back to login ===== */}
            <div className="flex items-center justify-center gap-2 -mt-2 text-xs text-secondary">
              <span>Đã nhớ mật khẩu?</span>
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="font-semibold text-primary hover:text-primary-container hover:underline transition-colors"
              >
                Quay lại đăng nhập
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
