import React, { useMemo, useState } from 'react';
import { DEPARTMENT_LABEL, ROLE_LABEL } from '../types';
import { useAuth } from '../auth/AuthContext';
import { DEMO_ACCOUNTS } from '../data/users';
import { BRAND_LOGO_URL } from '../data/initialData';

const LoginPage: React.FC = () => {
  const { login, loginAs } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const grouped = useMemo(() => {
    const byRole: Record<string, typeof DEMO_ACCOUNTS> = {
      admin: [],
      director: [],
      manager: [],
      employee: [],
    };
    DEMO_ACCOUNTS.forEach((acc) => byRole[acc.role].push(acc));
    return byRole;
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }
    const result = login(username, password);
    if (!result.ok) setError(result.reason);
  };

  const handleQuickLogin = (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    setUsername(acc.username);
    setPassword(acc.password);
    setError(null);
    // One-click: log them straight in.
    loginAs(acc.username);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#eef3ff] via-[#f8f9ff] to-[#e7f0ff] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ===== Left: form ===== */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#e5eeff] shadow-xl shadow-blue-900/5 p-7 sm:p-9 flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <img
              src={BRAND_LOGO_URL}
              alt="Brand"
              className="h-10 w-auto object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="flex flex-col leading-none">
              <span className="text-[16px] font-bold text-[#0b1c30]">Tiến độ 4 Tầng</span>
              <span className="text-[11px] uppercase tracking-wider text-[#565e74] mt-1 font-semibold">
                Enterprise MVP
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="text-[24px] sm:text-[28px] font-bold text-[#0b1c30] tracking-tight">
              Đăng nhập hệ thống
            </h1>
            <p className="text-[13px] text-[#434655] leading-relaxed">
              Sử dụng tài khoản được cấp để truy cập cây Gantt 4 tầng và phân công
              việc nhóm. Hệ thống tự động giới hạn quyền theo phòng ban &amp; vai trò.
            </p>
          </div>

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
                placeholder="vd: hung, hong, admin..."
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

          <div className="text-[11px] text-[#565e74] text-center leading-relaxed">
            MVP • Phiên đăng nhập lưu cục bộ trong trình duyệt.{' '}
            <span className="font-semibold text-[#004ac6]">
              Không cần backend.
            </span>
          </div>
        </div>

        {/* ===== Right: demo accounts ===== */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-[#e5eeff] shadow-xl shadow-blue-900/5 p-6 sm:p-8 flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#004ac6] text-white flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">key</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[15px] font-bold text-[#0b1c30]">
                Tài khoản demo có sẵn
              </span>
              <span className="text-[11px] text-[#565e74]">
                Bấm một tài khoản để đăng nhập nhanh &amp; xem phân quyền tương ứng
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-5">
              {(['admin', 'director', 'manager', 'employee'] as const).map((role) => (
                <div key={role} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-bold text-[#565e74] tracking-wider uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#004ac6]"></span>
                    <span>{ROLE_LABEL[role]}</span>
                    <span className="text-[#c3c6d7]">—</span>
                    <span className="text-[#737686] font-medium">
                      {grouped[role].length} tài khoản
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {grouped[role].map((acc) => (
                      <button
                        key={acc.username}
                        onClick={() => handleQuickLogin(acc)}
                        className="text-left p-3.5 rounded-xl bg-[#eff4ff]/50 hover:bg-[#eff4ff] border border-[#dce9ff] hover:border-[#004ac6]/40 transition-all flex flex-col gap-1.5 group"
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[13px] text-[#0b1c30] truncate">
                            {acc.fullname}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-[#004ac6] bg-white px-2 py-0.5 rounded border border-[#dce9ff]">
                            @{acc.username}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {acc.departments.map((d) => (
                            <span
                              key={d}
                              className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold bg-white border border-[#dce9ff] text-[#434655] rounded"
                            >
                              {d} · {DEPARTMENT_LABEL[d]}
                            </span>
                          ))}
                        </div>
                        <div className="text-[11px] text-[#565e74] flex items-center gap-1 mt-0.5">
                          <span className="material-symbols-outlined text-[13px]">
                            lock_open
                          </span>
                          <span>
                            Mật khẩu:{' '}
                            <span className="font-mono font-bold text-[#0b1c30]">
                              {acc.password}
                            </span>
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

          <div className="border-t border-[#e5eeff] pt-4 text-[12px] text-[#565e74] leading-relaxed">
            <span className="font-semibold text-[#0b1c30]">Mẹo:</span> tài khoản{' '}
            <span className="font-mono font-semibold text-[#004ac6]">admin / admin123</span>{' '}
            xem được tất cả phòng ban. Trưởng phòng{' '}
            <span className="font-mono font-semibold text-[#004ac6]">hung / 123456</span>{' '}
            chỉ thấy dữ liệu QLDA. Nhân viên{' '}
            <span className="font-mono font-semibold text-[#004ac6]">hong / 123456</span>{' '}
            chỉ thấy <em>Việc của tôi</em>.
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;