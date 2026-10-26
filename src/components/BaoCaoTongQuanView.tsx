import React, { useMemo, useState } from 'react';
import { Avatar } from './ui/Brand';
import { isTierItemOverdue } from '../lib/transforms';
import {
  TierItem,
  TeamMember,
  TeamLeadTask,
  DailyLog,
  DEPARTMENT_LABEL,
  Department,
  User,
} from '../types';

interface BaoCaoTongQuanViewProps {
  tierItems: TierItem[];
  teamMembers: TeamMember[];
  teamTasks: TeamLeadTask[];
  /** Nhật ký công việc (DailyLog) — dùng để tóm tắt hoạt động nhân viên trong ngày. */
  dailyLogs?: DailyLog[];
  /** User đang đăng nhập — dùng để filter báo cáo theo phòng ban khi là manager. */
  currentUser?: User | null;
}

export const BaoCaoTongQuanView: React.FC<BaoCaoTongQuanViewProps> = ({
  tierItems,
  teamMembers,
  teamTasks,
  dailyLogs = [],
  currentUser,
}) => {
  const completedTierItems = tierItems.filter((i) => i.progress === 100).length;
  const inProgressTierItems = tierItems.filter((i) => i.progress > 0 && i.progress < 100).length;
  const blockedItems = tierItems.filter((i) => i.status === 'Điểm nghẽn');
  // Thanh phân bổ: so với người đang có nhiều việc mở nhất.
  const maxActive = Math.max(1, ...teamMembers.map((m) => m.activeTasks));

  // --- Dynamic KPI calculations (replacing all hardcoded values) ---
  const tier1Items = tierItems.filter((i) => i.tier === 1);
  const tier2Items = tierItems.filter((i) => i.tier === 2);
  const tier3Items = tierItems.filter((i) => i.tier === 3);

  // Header phụ thuộc ngày thực + số thành viên thực (không hardcode).
  const now = new Date();

  const avgProgress = (items: typeof tierItems) =>
    items.length === 0 ? 0 : Math.round(items.reduce((s, i) => s + i.progress, 0) / items.length);

  const kpiT1 = avgProgress(tier1Items);
  const kpiT2 = avgProgress(tier2Items);
  const kpiT3 = avgProgress(tier3Items);

  // Tier-2 sub-labels: list each phase's progress
  const tier2SubLabel = tier2Items
    .map((i) => `${i.code}: ${i.progress}%`)
    .join(' • ') || 'Chưa có giai đoạn';

  const tier3OnTime = tier3Items.filter((i) => !isTierItemOverdue(i)).length;
  const tier3OnTimePct = tier3Items.length === 0 ? 0 : Math.round((tier3OnTime / tier3Items.length) * 100);

  // Bottleneck summary
  const blockedCount = blockedItems.length;
  const firstBlocker = blockedItems[0];

  // === Hoạt động nhân viên hôm nay (Daily Logs) ===
  // Lọc logs theo ngày hiện tại (local date, không UTC), filter theo phòng ban
  // của currentUser nếu là manager, group theo phòng ban, tóm tắt per nhân viên.
  //
  // Dùng local date (formatLocalDate) thay vì `toISOString().slice(0, 10)` (UTC).
  // Với user GMT+7, trước 7h sáng local, `today` theo UTC là NGÀY HÔM QUA → bỏ sót
  // log hôm nay / hiển thị nhầm log hôm qua.
  const today = (() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();

  // Manager: chỉ thấy log của phòng mình quản lý (departments của user).
  // Admin / director: thấy tất cả.
  const scopeDepts: Department[] | null = useMemo(() => {
    if (!currentUser) return null;
    if (currentUser.role === 'manager') {
      return currentUser.departments ?? [];
    }
    return null; // admin/director xem toàn công ty
  }, [currentUser]);

  const logsToday = useMemo(
    () => dailyLogs.filter((l) => l.logDate === today),
    [dailyLogs, today],
  );

  const memberByUsername = useMemo(() => {
    const m = new Map<string, TeamMember>();
    for (const tm of teamMembers) {
      if (tm.username) m.set(tm.username.toLowerCase(), tm);
    }
    return m;
  }, [teamMembers]);

  type MemberDailySummary = {
    username: string;
    userName: string;
    role?: string;
    avatar?: string;
    department: Department | 'Chưa rõ';
    logCount: number;
    avgProgress: number;
    hasObstacle: boolean;
    logs: DailyLog[];
  };

  const todaySummaries = useMemo<MemberDailySummary[]>(() => {
    const acc = new Map<string, MemberDailySummary>();
    for (const log of logsToday) {
      const key = log.username.toLowerCase();
      const tm = memberByUsername.get(key);
      const dept: Department | 'Chưa rõ' = tm?.department ?? 'Chưa rõ';
      // Filter theo phòng ban nếu là manager: bỏ log không thuộc dept quản lý.
      if (scopeDepts && dept !== 'Chưa rõ' && !scopeDepts.includes(dept)) {
        continue;
      }
      const existing = acc.get(key);
      if (existing) {
        const prevTotal = existing.avgProgress * (existing.logCount - 1);
        existing.avgProgress = Math.round((prevTotal + log.progress) / existing.logCount);
        existing.logCount += 1;
        existing.logs.push(log);
        if (log.obstacle && log.obstacle.trim()) existing.hasObstacle = true;
      } else {
        // Fallback avatar: backend /api/daily-logs không JOIN users.avatar_url
        // nên `log.userAvatar` thường rỗng. Lấy từ teamMembers (đã fetch từ
        // /api/users) — avatar của user tương ứng theo username.
        const avatarFallback = tm?.avatar || log.userAvatar || '';
        acc.set(key, {
          username: log.username,
          userName: log.userName,
          role: log.userRole,
          avatar: avatarFallback,
          department: dept,
          logCount: 1,
          avgProgress: log.progress,
          hasObstacle: !!(log.obstacle && log.obstacle.trim()),
          logs: [log],
        });
      }
    }
    // Ưu tiên người có vướng mắc lên trước; thứ cấp theo số log giảm dần.
    return Array.from(acc.values()).sort((a, b) => {
      if (a.hasObstacle !== b.hasObstacle) return a.hasObstacle ? -1 : 1;
      return b.logCount - a.logCount;
    });
  }, [logsToday, memberByUsername, scopeDepts]);

  const summariesByDepartment = useMemo(() => {
    const groups = new Map<Department | 'Chưa rõ', MemberDailySummary[]>();
    for (const s of todaySummaries) {
      const arr = groups.get(s.department) ?? [];
      arr.push(s);
      groups.set(s.department, arr);
    }
    return Array.from(groups.entries());
  }, [todaySummaries]);

  const todayStats = useMemo(
    () => ({
      members: todaySummaries.length,
      totalLogs: logsToday.length,
      obstacleMembers: todaySummaries.filter((s) => s.hasObstacle).length,
    }),
    [logsToday, todaySummaries],
  );

  // Click-to-expand một nhân viên để xem chi tiết các log hôm nay.
  // (UI trước đây chỉ hiển thị số liệu tóm tắt — user phải mở từng task mới biết NV ghi gì.)
  const [expandedUsername, setExpandedUsername] = useState<string | null>(null);

  return (
    <div className="flex flex-col w-full">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Sub Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-xl border border-surface-container shadow-sm">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">
              Báo cáo tổng quan
            </h1>
            <p className="text-sm text-secondary mt-1">
              Số liệu tại thời điểm {now.toLocaleDateString('vi-VN')} {now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} — toàn bộ dự án bạn được xem.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 bg-surface-container-low hover:bg-surface-container-high text-on-surface text-sm font-semibold rounded-lg flex items-center gap-1.5 border border-surface-container-high shadow-sm"
            >
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">print</span>
              <span>In báo cáo</span>
            </button>
          </div>
        </div>

        {/* Executive Rollup 4-Tier Matrix — tính động từ tierItems */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm">
            <span className="text-xs font-bold text-secondary uppercase tracking-wider block mb-1">
              Tầng 1: Dự án chiến lược
            </span>
            <div className="text-3xl font-bold text-on-surface tabular-nums">
              {kpiT1}%
            </div>
            <div className="w-full h-2 bg-surface-container-low rounded-full overflow-hidden my-2">
              <div className="h-full bg-gantt-t1 rounded-full" style={{ width: `${kpiT1}%` }}></div>
            </div>
            <span className="text-xs text-secondary">
              {tier1Items.length} dự án
            </span>
          </div>

          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm">
            <span className="text-xs font-bold text-secondary uppercase tracking-wider block mb-1">
              Giai đoạn
            </span>
            <div className="text-3xl font-bold text-primary tabular-nums">
              {kpiT2}%
            </div>
            <div className="w-full h-2 bg-surface-container-low rounded-full overflow-hidden my-2">
              <div className="h-full bg-primary rounded-full" style={{ width: `${kpiT2}%` }}></div>
            </div>
            <span className="text-xs text-secondary">
              {tier2SubLabel}
            </span>
          </div>

          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm">
            <span className="text-xs font-bold text-secondary uppercase tracking-wider block mb-1">
              Hạng mục
            </span>
            <div className="text-3xl font-bold text-tertiary tabular-nums">
              {kpiT3}%
            </div>
            <div className="w-full h-2 bg-surface-container-low rounded-full overflow-hidden my-2">
              <div className="h-full bg-tertiary rounded-full" style={{ width: `${kpiT3}%` }}></div>
            </div>
            <span className="text-xs text-secondary">
              {tier3OnTime}/{tier3Items.length} hạng mục đúng hạn ({tier3OnTimePct}%)
            </span>
          </div>

          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm">
            <span
              className={`text-xs font-bold uppercase tracking-wider block mb-1 ${
                blockedCount > 0 ? 'text-error' : 'text-tertiary'
              }`}
            >
              Điểm nghẽn
            </span>
            <div
              className={`text-3xl font-bold tabular-nums ${
                blockedCount > 0 ? 'text-error' : 'text-tertiary'
              }`}
            >
              {blockedCount > 0 ? `${blockedCount} Điểm` : 'Thông suốt'}
            </div>
            <div className="w-full h-2 bg-surface-container-low rounded-full overflow-hidden my-2">
              <div
                className={`h-full rounded-full ${
                  blockedCount > 0 ? 'bg-error' : 'bg-tertiary'
                }`}
                style={{ width: blockedCount > 0 ? `${Math.min(blockedCount * 25, 100)}%` : '100%' }}
              ></div>
            </div>
            <span
              className={`text-xs font-semibold ${
                blockedCount > 0 ? 'text-error' : 'text-tertiary'
              }`}
            >
              {blockedCount > 0
                ? (firstBlocker?.blockerAlert || firstBlocker?.title || 'Xem chi tiết bên dưới')
                : 'Không có điểm nghẽn'}
            </span>
          </div>
        </div>

        {/* Detailed Breakdown Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Table: 4-Tier Items Progress Overview */}
          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-on-surface">
                Tiến độ chi tiết
              </h3>
              <span className="text-xs text-secondary">
                {completedTierItems}/{tierItems.length} hoàn tất
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-surface-container text-secondary text-xs font-bold uppercase">
                    <th className="pb-2.5">Mã & Hạng mục</th>
                    <th className="pb-2.5">Người làm</th>
                    <th className="pb-2.5 text-center">Tiến độ</th>
                    <th className="pb-2.5 text-right">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {tierItems.map((item) => (
                    <tr key={item.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="py-2.5 pr-2">
                        <div className="font-semibold text-on-surface truncate max-w-[200px]">
                          {item.title}
                        </div>
                        <span className="text-xs text-secondary font-mono">
                          {item.code} · {item.tierName}
                        </span>
                      </td>
                      <td className="py-2.5 text-on-surface">
                        {item.owner.name}
                      </td>
                      <td className="py-2.5 text-center font-mono font-bold">
                        <span
                          className={
                            item.progress === 100
                              ? 'text-tertiary'
                              : item.blockerAlert
                              ? 'text-warning'
                              : 'text-primary'
                          }
                        >
                          {item.progress}%
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            item.progress === 100
                              ? 'bg-tertiary-fixed/40 text-tertiary'
                              : item.blockerAlert
                              ? 'bg-warning-container text-on-warning-container'
                              : 'bg-surface-container-low text-primary'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Section: Team Workload & Bottleneck Resolution */}
          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
            <h3 className="text-base font-bold text-on-surface">
              Tải công việc & Điểm nghẽn cần tháo gỡ
            </h3>

            {/* Blocked Items Card */}
            {blockedItems.length > 0 && (
              <div className="p-4 rounded-lg bg-error-container/40 border border-error-fixed">
                <div className="flex items-center gap-2 text-error font-bold text-sm mb-1">
                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                    error
                  </span>
                  <span>Cần hành động ngay: {blockedItems.length} hạng mục bị nghẽn</span>
                </div>
                {blockedItems.map((b) => (
                  <p key={b.id} className="text-xs text-on-error-container leading-relaxed mt-1">
                    • <strong>{b.title}</strong>: {b.managementNotes}
                  </p>
                ))}
              </div>
            )}

            {/* Member load bars */}
            <div className="space-y-3 pt-2">
              <div className="text-xs font-bold text-secondary uppercase tracking-wider">
                Phân bổ nguồn lực đội ngũ:
              </div>
              {teamMembers.map((member) => (
                <div key={member.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-on-surface">
                      {member.name} ({member.role})
                    </span>
                    <span
                      className={`font-semibold ${
                        member.overdueTasks > 0 || member.needHelp ? 'text-error' : 'text-tertiary'
                      }`}
                    >
                      {member.activeTasks} việc đang mở
                      {member.overdueTasks > 0 && ` · ${member.overdueTasks} quá hạn`}
                      {member.blockedTasks > 0 && ` · ${member.blockedTasks} đang vướng`}
                    </span>
                  </div>
                  <div className="w-full bg-surface-container-low rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        member.needHelp ? 'bg-error' : 'bg-primary'
                      }`}
                      style={{ width: `${(member.activeTasks / maxActive) * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Hoạt động nhân viên hôm nay — Daily Logs theo phòng ban */}
        <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:20px] text-primary">
                edit_calendar
              </span>
              <h3 className="text-base font-bold text-on-surface">
                Hoạt động nhân viên hôm nay
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-low text-primary font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                {todayStats.members} nhân viên đã ghi
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-low text-primary font-semibold">
                {todayStats.totalLogs} nhật ký
              </span>
              {todayStats.obstacleMembers > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-error font-semibold">
                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px]">warning</span>
                  {todayStats.obstacleMembers} có vướng mắc
                </span>
              )}
            </div>
          </div>

          {todayStats.totalLogs === 0 ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-surface-container-low/40 border border-dashed border-outline-variant">
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:22px] text-secondary">
                inbox
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-on-surface-variant">
                  Chưa có nhân viên nào ghi nhật ký hôm nay ({today}).
                </p>
                <p className="text-xs text-secondary mt-0.5">
                  Nhân viên ghi nhật ký ở tab <span className="font-semibold">Việc của tôi</span>, hoặc
                  trong mục "Nhật ký công việc" khi mở chi tiết một đầu việc. Nhật ký theo ngày
                  dùng để đối chiếu tiến độ khi xem báo cáo.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {summariesByDepartment.map(([dept, members]) => (
                <div
                  key={dept}
                  className="rounded-lg border border-surface-container-low bg-surface overflow-hidden"
                >
                  <div className="flex items-center justify-between px-3.5 py-2 bg-white border-b border-surface-container-low">
                    <span className="text-xs font-bold text-on-surface tracking-tight">
                      {dept === 'Chưa rõ' ? dept : `${dept} · ${DEPARTMENT_LABEL[dept as Department]}`}
                    </span>
                    <span className="text-xs text-secondary font-mono">
                      {members.length} người
                    </span>
                  </div>
                  <ul className="divide-y divide-surface-container-low">
                    {members.map((m) => {
                      const isOpen = expandedUsername === m.username;
                      // Sắp xếp log mới nhất trước cho dễ đọc
                      const logsAsc = [...m.logs].sort((a, b) =>
                        (b.createdAt || '').localeCompare(a.createdAt || ''),
                      );
                      return (
                        <li key={m.username} className="hover:bg-white transition-colors">
                          {/* Click vào header để expand/collapse danh sách log */}
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedUsername(isOpen ? null : m.username)
                            }
                            className="w-full text-left flex items-start gap-3 px-3.5 py-2.5"
                            aria-expanded={isOpen}
                          >
                            <Avatar name={m.userName} src={m.avatar} className="w-9 h-9 text-sm shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-on-surface truncate">
                                  {m.userName}
                                </span>
                                <span className="font-mono text-xs text-secondary">
                                  @{m.username}
                                </span>
                                {m.hasObstacle && (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-error-container text-error text-xs font-bold"
                                    title="Có vướng mắc được ghi nhận hôm nay"
                                  >
                                    <span aria-hidden="true" className="material-symbols-outlined [--icon-size:11px]">
                                      warning
                                    </span>
                                    Vướng mắc
                                  </span>
                                )}
                              </div>
                              {m.role && (
                                <p className="text-xs text-secondary truncate mt-0.5">
                                  {m.role}
                                </p>
                              )}
                              <div className="flex items-center gap-3 mt-1 text-xs text-on-surface-variant">
                                <span className="inline-flex items-center gap-1">
                                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:12px] text-primary">
                                    description
                                  </span>
                                  <span className="font-semibold">{m.logCount}</span>
                                  <span className="text-secondary">nhật ký</span>
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:12px] text-tertiary">
                                    trending_up
                                  </span>
                                  <span className="font-semibold">TB</span>
                                  <span className="font-mono font-bold text-tertiary">
                                    {m.avgProgress}%
                                  </span>
                                </span>
                              </div>
                            </div>
                            <span
                              className={`material-symbols-outlined [--icon-size:18px] text-secondary shrink-0 mt-2 transition-transform ${
                                isOpen ? 'rotate-180' : ''
                              }`}
                              aria-hidden="true"
                            >
                              expand_more
                            </span>
                          </button>

                          {/* Expanded: danh sách log chi tiết trong ngày */}
                          {isOpen && (
                            <div className="px-3.5 pb-3 pt-1 space-y-2 bg-surface/60">
                              {logsAsc.length === 0 ? (
                                <p className="text-xs text-secondary italic">
                                  Không có nhật ký chi tiết.
                                </p>
                              ) : (
                                logsAsc.map((log) => (
                                  <div
                                    key={log.id}
                                    className="border-l-2 border-outline-variant pl-2.5 py-1.5 bg-white rounded-r"
                                  >
                                    <div className="flex items-center gap-2 text-xs text-secondary mb-1">
                                      <span className="font-mono">#{log.id}</span>
                                      <span>·</span>
                                      <span>
                                        tiến độ{' '}
                                        <span className="font-bold text-tertiary">
                                          {log.progress}%
                                        </span>
                                      </span>
                                      {log.obstacle && log.obstacle.trim() && (
                                        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-error-container text-error font-bold">
                                          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:10px]">
                                            warning
                                          </span>
                                          vướng mắc
                                        </span>
                                      )}
                                    </div>
                                    {log.description && (
                                      <p className="text-xs text-on-surface leading-relaxed">
                                        <span className="text-secondary font-semibold">
                                          Việc đã làm:
                                        </span>{' '}
                                        {log.description}
                                      </p>
                                    )}
                                    {log.result && (
                                      <p className="text-xs text-on-surface leading-relaxed mt-0.5">
                                        <span className="text-secondary font-semibold">
                                          Kết quả:
                                        </span>{' '}
                                        {log.result}
                                      </p>
                                    )}
                                    {log.obstacle && log.obstacle.trim() && (
                                      <p className="text-xs text-error leading-relaxed mt-0.5">
                                        <span className="font-semibold">Vướng mắc:</span>{' '}
                                        {log.obstacle}
                                      </p>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
