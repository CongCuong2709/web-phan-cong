import React, { useMemo, useState } from 'react';
import { ActiveAppTab, DEPARTMENT_LABEL, ROLE_LABEL, User } from '../types';
import { useAuth } from '../auth/AuthContext';
import { Avatar, BrandMark } from './ui/Brand';

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
      // Employee xem 'cay-gantt-4-tang' dạng read-only context chain (parent T4 của mình),
      // giống pattern Jira/Linear/Asana — chỉ thấy T1/T2/T3 cha của task mình.
      // 'bao-cao' = Báo cáo tuần (WeeklyReportView) — Ponytail: employee tự viết báo cáo.
      return ['viec-cua-toi', 'cay-gantt-4-tang', 'bao-cao'];
  }
}

const ROLE_BADGE_COLOR: Record<User['role'], string> = {
  admin: 'bg-error-container text-on-error-container',
  director: 'bg-on-surface text-white',
  manager: 'bg-surface-container-high text-primary',
  employee: 'bg-tertiary-fixed/40 text-tertiary',
};

const TAB_LABEL: Record<ActiveAppTab, string> = {
  'cay-gantt-4-tang': 'Cây công việc',
  'giao-viec-nhom': 'Giao việc Nhóm',
  'viec-cua-toi': 'Việc của tôi',
  'bao-cao': 'Báo cáo',
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
    <header className="fixed top-0 left-0 w-full z-50 bg-surface/90 backdrop-blur-xl border-b border-surface-container shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      {/* Điện thoại: tab điều hướng xuống hàng thứ hai thay vì bị đẩy khỏi màn hình */}
      <div className="w-full px-4 sm:px-6 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-4">
        <button
          type="button"
          onClick={() => setActiveTab(tabs[0] ?? 'viec-cua-toi')}
          className="h-14 flex items-center gap-3 shrink-0 min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Về trang đầu"
        >
          <BrandMark className="h-8 w-8 shrink-0" />
          <span className="hidden sm:inline font-semibold text-base text-on-surface tracking-tight whitespace-nowrap">
            Hệ thống công việc và báo cáo TAG
          </span>
        </button>

        <div className="order-last md:order-none w-full md:w-auto md:flex-1 flex md:justify-center overflow-x-auto pb-2 md:pb-0 md:py-1">
          <nav aria-label="Điều hướng chính" className="flex items-center gap-1 bg-surface-container-low p-1 rounded-full text-sm font-medium shrink-0">
            {tabs.map((tab) => (
              <button type="button"
                key={tab}
                onClick={() => setActiveTab(tab)}
                aria-current={activeTab === tab ? 'page' : undefined}
                className={`px-3 sm:px-4 py-1.5 rounded-full transition-all duration-150 whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === tab
                    ? 'bg-white text-primary shadow-[0_1px_4px_rgba(0,0,0,0.08)] font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span>{TAB_LABEL[tab]}</span>
                {tab === 'giao-viec-nhom' && unreadCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-error text-white text-xs flex items-center justify-center font-bold">
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Actions & User Profile */}
        <div className="h-14 flex items-center gap-2 sm:gap-3 shrink-0">
          {user && (
            <>
              {/* Department badge */}
              <div className="hidden md:flex flex-col items-end text-right leading-tight">
                <span className="text-xs uppercase tracking-wider font-bold text-secondary">
                  Phòng ban
                </span>
                <span className="text-xs font-semibold text-on-surface truncate max-w-[180px]">
                  {departmentLabel}
                </span>
              </div>

              {/* Notifications Button */}
              <button type="button"
                onClick={() => setActiveTab('giao-viec-nhom')}
                className="relative w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
                title="Thông báo điều hành"
                aria-label={unreadCount > 0 ? `Thông báo điều hành: ${unreadCount} việc cần hỗ trợ` : 'Thông báo điều hành'}
                disabled={!tabs.includes('giao-viec-nhom')}
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:19px]">notifications</span>
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-error animate-pulse"></span>
                )}
              </button>

              <div className="h-4 w-[1px] bg-surface-container-highest mx-1 hidden sm:block"></div>

              {/* User profile + menu */}
              <div className="relative">
                <button
                  type="button"
                  className="flex items-center gap-2 cursor-pointer p-1 rounded-lg hover:bg-surface-container-low transition-colors"
                  onClick={() => setMenuOpen((s) => !s)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label={`Tài khoản: ${user.fullname}`}
                >
                  <div className="relative">
                    <Avatar name={user.fullname} src={user.avatar} />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-tertiary ring-2 ring-white"></span>
                  </div>
                  <div className="hidden lg:flex flex-col text-left leading-tight">
                    <span className="text-xs font-semibold text-on-surface">
                      {user.fullname}
                    </span>
                    <span className="text-xs text-on-surface-variant mt-0.5">
                      {ROLE_LABEL[user.role]}
                    </span>
                  </div>
                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px] text-outline hidden sm:block">
                    expand_more
                  </span>
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 top-full mt-1 w-72 bg-white rounded-xl border border-surface-container shadow-xl z-50 overflow-hidden"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <div className="p-4 flex items-center gap-3 border-b border-surface-container">
                      <Avatar name={user.fullname} src={user.avatar} className="w-10 h-10 text-sm" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold text-sm text-on-surface truncate">
                          {user.fullname}
                        </span>
                        <span className="text-xs text-secondary font-mono truncate">
                          @{user.username}
                        </span>
                      </div>
                      <span
                        className={`ml-auto text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${ROLE_BADGE_COLOR[user.role]}`}
                      >
                        {ROLE_LABEL[user.role]}
                      </span>
                    </div>

                    <div className="p-3 flex flex-col gap-2 text-xs">
                      <div className="px-2 py-1.5 rounded-lg bg-surface-container-low/60">
                        <div className="text-xs uppercase tracking-wider font-bold text-secondary">
                          Phòng ban được phép truy cập
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {user.departments.map((d) => (
                            <span
                              key={d}
                              className="inline-flex items-center px-2 py-0.5 text-xs font-bold rounded bg-white border border-surface-container-high text-primary"
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
                        className="mt-1 w-full px-3 py-2 rounded-lg bg-error-container/40 hover:bg-error-container text-on-error-container text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                        type="button"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">logout</span>
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