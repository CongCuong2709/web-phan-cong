import React, { useMemo, useState } from 'react';
import { ActiveAppTab, DEPARTMENT_LABEL, ROLE_LABEL, User } from '../types';
import { useAuth } from '../auth/AuthContext';
import { BRAND_LOGO_URL } from '../data/initialData';

interface HeaderProps {
  activeTab: ActiveAppTab;
  setActiveTab: (tab: ActiveAppTab) => void;
  unreadCount?: number;
}

/** Visibility matrix for the 4 main tabs. */
function visibleTabsFor(user: User | null): ActiveAppTab[] {
  if (!user) return [];
  switch (user.role) {
    case 'admin':
      return ['cay-gantt-4-tang', 'giao-viec-nhom', 'viec-cua-toi', 'bao-cao'];
    case 'director':
      // BGĐ: chỉ cần executive overview (cây Gantt toàn hệ thống + báo cáo tổng hợp).
      // Không vào giao việc nhóm hay việc cá nhân.
      return ['cay-gantt-4-tang', 'bao-cao'];
    case 'manager':
      return ['cay-gantt-4-tang', 'giao-viec-nhom', 'viec-cua-toi', 'bao-cao'];
    case 'employee':
    default:
      return ['viec-cua-toi'];
  }
}

const ROLE_BADGE_COLOR: Record<User['role'], string> = {
  admin: 'bg-[#ffdad6] text-[#93000a]',
  director: 'bg-[#0b1c30] text-white',
  manager: 'bg-[#dce9ff] text-[#004ac6]',
  employee: 'bg-[#85f8c4]/40 text-[#006243]',
};

const TAB_LABEL: Record<ActiveAppTab, string> = {
  'cay-gantt-4-tang': 'Cây Gantt 4 Tầng',
  'giao-viec-nhom': 'Giao việc Nhóm',
  'viec-cua-toi': 'Việc của tôi',
  'bao-cao': 'Báo cáo & Tổng quan',
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  unreadCount = 0,
}) => {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = useMemo(() => visibleTabsFor(user), [user]);

  // Pick a sensible default tab if the current tab is no longer allowed.
  React.useEffect(() => {
    if (user && !tabs.includes(activeTab)) {
      setActiveTab(tabs[0] ?? 'viec-cua-toi');
    }
  }, [user, tabs, activeTab, setActiveTab]);

  const departmentLabel = user
    ? user.departments.map((d) => `${d} · ${DEPARTMENT_LABEL[d]}`).join(' • ')
    : '';

  return (
    <header className="fixed top-0 left-0 w-full z-50 bg-[#f8f9ff]/90 backdrop-blur-xl border-b border-[#e5eeff] shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="h-14 w-full px-4 sm:px-6 flex items-center justify-between gap-4">
        {/* Brand Zone */}
        <div className="flex items-center gap-3 shrink-0">
          <img
            alt="Brand logo"
            className="h-8 w-auto object-contain cursor-pointer transition-transform hover:scale-105"
            src={BRAND_LOGO_URL}
            onClick={() => setActiveTab(tabs[0] ?? 'viec-cua-toi')}
          />
          <div className="flex items-center gap-2">
            <span
              onClick={() => setActiveTab(tabs[0] ?? 'viec-cua-toi')}
              className="font-semibold text-[15px] sm:text-[16px] text-[#0b1c30] tracking-tight cursor-pointer hover:text-[#004ac6] transition-colors"
            >
              Tiến độ 4 Tầng
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#dae2fd] text-[#5c647a] uppercase tracking-wider hidden sm:inline-block">
              Enterprise
            </span>
          </div>
        </div>

        {/* Navigation Tabs Center */}
        <div className="flex-1 flex justify-center overflow-x-auto no-scrollbar py-1">
          <nav className="flex items-center gap-1 bg-[#eff4ff] p-1 rounded-full text-[13px] font-medium shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 sm:px-4 py-1.5 rounded-full transition-all duration-150 whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === tab
                    ? 'bg-white text-[#004ac6] shadow-[0_1px_4px_rgba(0,0,0,0.08)] font-semibold'
                    : 'text-[#434655] hover:text-[#0b1c30]'
                }`}
              >
                <span>{TAB_LABEL[tab]}</span>
                {tab === 'giao-viec-nhom' && unreadCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-[#ba1a1a] text-white text-[10px] flex items-center justify-center font-bold">
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Actions & User Profile */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {user && (
            <>
              {/* Department badge */}
              <div className="hidden md:flex flex-col items-end text-right leading-tight">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[#565e74]">
                  Phòng ban
                </span>
                <span className="text-[11px] font-semibold text-[#0b1c30] truncate max-w-[180px]">
                  {departmentLabel}
                </span>
              </div>

              {/* Notifications Button */}
              <button
                onClick={() => setActiveTab('giao-viec-nhom')}
                className="relative w-8 h-8 rounded-lg flex items-center justify-center text-[#434655] hover:text-[#0b1c30] hover:bg-[#eff4ff] transition-colors"
                title="Thông báo điều hành"
                disabled={!tabs.includes('giao-viec-nhom')}
              >
                <span className="material-symbols-outlined text-[19px]">notifications</span>
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#ba1a1a] animate-pulse"></span>
                )}
              </button>

              <div className="h-4 w-[1px] bg-[#d3e4fe] mx-1 hidden sm:block"></div>

              {/* User profile + menu */}
              <div className="relative">
                <div
                  className="flex items-center gap-2 cursor-pointer p-1 rounded-lg hover:bg-[#eff4ff] transition-colors"
                  onClick={() => setMenuOpen((s) => !s)}
                  title={user.fullname}
                >
                  <div className="relative">
                    <img
                      alt={user.fullname}
                      className="w-8 h-8 rounded-full object-cover ring-1 ring-[#c3c6d7] bg-[#dce9ff]"
                      src={user.avatar}
                    />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#006243] ring-2 ring-white"></span>
                  </div>
                  <div className="hidden lg:flex flex-col text-left leading-tight">
                    <span className="text-[12px] font-semibold text-[#0b1c30]">
                      {user.fullname}
                    </span>
                    <span className="text-[10px] text-[#434655] mt-0.5">
                      {ROLE_LABEL[user.role]}
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-[16px] text-[#737686] hidden sm:block">
                    expand_more
                  </span>
                </div>

                {menuOpen && (
                  <div
                    className="absolute right-0 top-full mt-1 w-72 bg-white rounded-xl border border-[#e5eeff] shadow-xl shadow-blue-900/10 z-50 overflow-hidden"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <div className="p-4 flex items-center gap-3 border-b border-[#e5eeff]">
                      <img
                        alt={user.fullname}
                        className="w-10 h-10 rounded-full ring-1 ring-[#c3c6d7] bg-[#dce9ff] object-cover"
                        src={user.avatar}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold text-[13px] text-[#0b1c30] truncate">
                          {user.fullname}
                        </span>
                        <span className="text-[11px] text-[#565e74] font-mono truncate">
                          @{user.username}
                        </span>
                      </div>
                      <span
                        className={`ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${ROLE_BADGE_COLOR[user.role]}`}
                      >
                        {ROLE_LABEL[user.role]}
                      </span>
                    </div>

                    <div className="p-3 flex flex-col gap-2 text-[12px]">
                      <div className="px-2 py-1.5 rounded-lg bg-[#eff4ff]/60">
                        <div className="text-[10px] uppercase tracking-wider font-bold text-[#565e74]">
                          Phòng ban được phép truy cập
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {user.departments.map((d) => (
                            <span
                              key={d}
                              className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded bg-white border border-[#dce9ff] text-[#004ac6]"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          logout();
                        }}
                        className="mt-1 w-full px-3 py-2 rounded-lg bg-[#ffdad6]/40 hover:bg-[#ffdad6] text-[#93000a] text-[12px] font-bold flex items-center justify-center gap-2 transition-colors"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[16px]">logout</span>
                        Đăng xuất
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};