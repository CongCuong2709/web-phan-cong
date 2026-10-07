import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { BRAND_LOGO_URL } from '../data/initialData';

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }
    const result = await login(username, password);
    if (!result.ok) setError(result.reason);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#eef3ff] via-[#f8f9ff] to-[#e7f0ff] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#e5eeff] shadow-xl shadow-blue-900/5 p-7 sm:p-9 flex flex-col gap-6">
        {/* ===== Brand ===== */}
        <div className="flex items-center gap-3">
          <img
            src={BRAND_LOGO_URL}
            alt="Brand"
            className="h-10 w-auto object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <span className="text-[16px] font-bold text-[#0b1c30]">Hệ thống công việc và báo cáo TAG</span>
        </div>

        {/* ===== Title ===== */}
        <h1 className="text-[24px] sm:text-[28px] font-bold text-[#0b1c30] tracking-tight">
          Đăng nhập hệ thống
        </h1>

        {/* ===== Form ===== */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="username"
              className="text-[12px] font-semibold text-[#0b1c30] uppercase tracking-wider"
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
              className="px-4 py-2.5 rounded-lg bg-[#eff4ff] border border-[#dce9ff] focus:border-[#004ac6] focus:outline-none focus:bg-white text-[14px] text-[#0b1c30] placeholder:text-[#737686]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[12px] font-semibold text-[#0b1c30] uppercase tracking-wider"
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
                className="w-full px-4 py-2.5 pr-12 rounded-lg bg-[#eff4ff] border border-[#dce9ff] focus:border-[#004ac6] focus:outline-none focus:bg-white text-[14px] text-[#0b1c30] placeholder:text-[#737686]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-md flex items-center justify-center text-[#565e74] hover:bg-[#dce9ff] transition-colors"
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#ffdad6]/40 border border-red-200 rounded-lg text-[12px] text-[#93000a] font-medium">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full mt-2 px-4 py-3 rounded-lg bg-[#004ac6] hover:bg-[#2563eb] text-white text-[14px] font-bold transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">login</span>
            <span>Đăng nhập</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;