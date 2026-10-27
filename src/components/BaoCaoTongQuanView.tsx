import React, { useEffect, useMemo, useState } from 'react';
import { Avatar } from './ui/Brand';
import { expectedProgress, isTierItemOverdue } from '../lib/transforms';
import { api, type WeeklyTeamMemberDto } from '../lib/apiClient';
import { weekStartOf } from './WeeklyReportView';
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
  /** Mở 1 mục trong Drawer (id composite '<tier>-<num>'). */
  onOpenItem?: (id: string) => void;
}

/** Chậm hơn kế hoạch từ ngưỡng này (điểm %) trở lên thì đưa vào "Cần chú ý". */
const BEHIND_THRESHOLD = 10;
/** Số dòng "Cần chú ý" hiện mặc định. */
const ATTENTION_LIMIT = 10;

type AttentionKind = 'blocked' | 'overdue' | 'behind';

const ATTENTION_TONE: Record<AttentionKind, string> = {
  blocked: 'bg-error-container text-on-error-container',
  overdue: 'bg-error-container text-on-error-container',
  behind: 'bg-warning-container text-on-warning-container',
};

/** Mức chậm so với kế hoạch (điểm %), chỉ cho mục chưa báo xong; undefined nếu không chậm. */
function behindBy(item: TierItem): number | undefined {
  if (item.status === 'Đã xong' || item.status === 'Chờ duyệt') return undefined;
  const plan = expectedProgress(item);
  if (plan === undefined) return undefined;
  const lag = plan - item.progress;
  return lag > 0 ? lag : undefined;
}

/** Thanh tải việc của 1 thành viên. */
const MemberLoad: React.FC<{ member: TeamMember; maxActive: number }> = ({ member, maxActive }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="font-semibold text-on-surface truncate">
        {member.name} ({member.role})
      </span>
      <span
        className={`font-semibold shrink-0 ${
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
        className={`h-full rounded-full ${member.needHelp ? 'bg-error' : 'bg-primary'}`}
        style={{ width: `${(member.activeTasks / maxActive) * 100}%` }}
      ></div>
    </div>
  </div>
);

/** 1 dòng tiến độ (dự án / giai đoạn) kèm mốc kế hoạch. */
const ProgressRow: React.FC<{ item: TierItem; strong?: boolean; onOpen?: (id: string) => void }> = ({ item, strong, onOpen }) => {
  const done = item.status === 'Đã xong';
  const plan = done ? undefined : expectedProgress(item);
  const lag = behindBy(item);
  const late = lag !== undefined && lag >= BEHIND_THRESHOLD;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(item.id)}
      className={`w-full text-left flex flex-col gap-1 rounded hover:bg-surface-container-low/40 transition-colors ${strong ? '' : 'pl-4'}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={`truncate ${strong ? 'text-sm font-bold text-on-surface' : 'font-semibold text-on-surface'}`}>
          <span className="font-mono text-secondary mr-1.5">{item.code}</span>
          {item.title}
        </span>
        <span className="shrink-0 flex items-center gap-2">
          {done ? (
            <span className="font-semibold text-tertiary">Đã xong</span>
          ) : (
            <>
              {plan !== undefined && <span className="text-secondary">kế hoạch {plan}%</span>}
              {late && <span className="font-semibold text-warning">chậm {lag}%</span>}
            </>
          )}
          <span className="font-mono font-bold text-on-surface w-10 text-right">{item.progress}%</span>
        </span>
      </div>
      <div className="relative w-full h-2 bg-surface-container-low rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${done ? 'bg-tertiary' : late ? 'bg-warning' : strong ? 'bg-gantt-t1' : 'bg-primary'}`}
          style={{ width: `${item.progress}%` }}
        />
        {plan !== undefined && (
          <div aria-hidden="true" className="absolute top-0 h-full w-0.5 bg-on-surface/60" style={{ left: `${plan}%` }} />
        )}
      </div>
    </button>
  );
};

export const BaoCaoTongQuanView: React.FC<BaoCaoTongQuanViewProps> = ({
  tierItems,
  teamMembers,
  teamTasks,
  dailyLogs = [],
  currentUser,
  onOpenItem,
}) => {
  // Vướng mắc = trạng thái nghẽn, hoặc NV đã báo vướng (blocker_note), hoặc cảnh báo giai đoạn.
  const hasBlocker = (i: TierItem) =>
    i.status !== 'Đã xong' && (i.status === 'Điểm nghẽn' || !!i.blockerNote?.trim() || !!i.blockerAlert);
  const blockedItems = tierItems.filter(hasBlocker);
  const blockerText = (i: TierItem) => i.blockerNote?.trim() || i.blockerAlert || i.managementNotes;

  const projects = useMemo(
    () => tierItems.filter((i) => i.tier === 1).sort((a, b) => a.code.localeCompare(b.code)),
    [tierItems],
  );
  const phasesOf = useMemo(() => {
    const m = new Map<string, TierItem[]>();
    for (const i of tierItems) {
      if (i.tier !== 2 || !i.parentId) continue;
      const arr = m.get(i.parentId) ?? [];
      arr.push(i);
      m.set(i.parentId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.code.localeCompare(b.code));
    return m;
  }, [tierItems]);

  // Mỗi mục lấy lý do nặng nhất: vướng mắc > quá hạn > chậm kế hoạch.
  const attention = useMemo(() => {
    const rows: { item: TierItem; kind: AttentionKind; label: string; detail?: string; weight: number }[] = [];
    for (const item of tierItems) {
      if (item.status === 'Đã xong') continue;
      if (hasBlocker(item)) {
        rows.push({ item, kind: 'blocked', label: 'Vướng mắc', detail: blockerText(item) || undefined, weight: 0 });
      } else if (isTierItemOverdue(item)) {
        const days = Math.abs(item.daysRemaining ?? 0);
        rows.push({ item, kind: 'overdue', label: `Quá hạn ${days} ngày`, weight: 1000 - days });
      } else {
        const lag = behindBy(item);
        if (lag !== undefined && lag >= BEHIND_THRESHOLD) {
          rows.push({ item, kind: 'behind', label: `Chậm ${lag}%`, weight: 2000 - lag });
        }
      }
    }
    return rows.sort((a, b) => a.weight - b.weight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierItems]);
  const [showAllAttention, setShowAllAttention] = useState(false);

  // ── Theo phòng ban (admin / BGĐ) ──
  const isManagerView = currentUser?.role === 'manager';
  const [weekly, setWeekly] = useState<WeeklyTeamMemberDto[]>([]);
  const [weeklyStatus, setWeeklyStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  useEffect(() => {
    if (isManagerView) return;
    let cancelled = false;
    setWeeklyStatus('loading');
    api.getWeeklyReportTeam(weekStartOf()).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setWeekly(r.data.items);
        setWeeklyStatus('ready');
      } else {
        setWeeklyStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [isManagerView]);

  const deptRows = useMemo(() => {
    const openTasks = tierItems.filter((t) => t.tier === 4 && t.status !== 'Đã xong');
    const codes = new Set<string>();
    for (const t of openTasks) if (t.department) codes.add(t.department);
    for (const m of teamMembers) if (m.department) codes.add(m.department);
    for (const w of weekly) for (const d of w.departments) codes.add(d);
    return Array.from(codes)
      .map((code) => {
        const tasks = openTasks.filter((t) => t.department === code);
        const employees = weekly.filter((w) => w.departments.includes(code));
        return {
          code,
          label: DEPARTMENT_LABEL[code as Department] ?? code,
          // "Đang mở" = chưa báo xong; việc chờ duyệt không tính (đã làm xong).
          open: tasks.filter((t) => t.status !== 'Chờ duyệt').length,
          overdue: tasks.filter((t) => isTierItemOverdue(t)).length,
          blocked: tasks.filter((t) => hasBlocker(t)).length,
          employees: employees.length,
          submitted: employees.filter((w) => w.submitted).length,
          notSubmitted: employees.filter((w) => !w.submitted).map((w) => w.fullname),
          members: teamMembers.filter((m) => m.department === code),
        };
      })
      .filter((d) => d.open > 0 || d.members.length > 0 || d.employees > 0)
      .sort((a, b) => b.overdue + b.blocked - (a.overdue + a.blocked) || a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierItems, teamMembers, weekly]);
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

  const [expandedDailyDept, setExpandedDailyDept] = useState<string | null>(null);

  // Người cần ghi nhật ký = người có việc đang mở; cộng thêm ai đã ghi dù không còn việc mở.
  const dailyByDept = useMemo(() => {
    const loggedBy = new Map(summariesByDepartment);
    const codes = new Set<string>(loggedBy.keys());
    for (const m of teamMembers) if (m.department && m.activeTasks > 0) codes.add(m.department);
    return Array.from(codes)
      .map((code) => {
        const logged = loggedBy.get(code as Department | 'Chưa rõ') ?? [];
        const loggedNames = new Set(logged.map((x) => x.username.toLowerCase()));
        const notLogged = teamMembers
          .filter((m) => m.department === code && m.activeTasks > 0 && !loggedNames.has((m.username ?? '').toLowerCase()))
          .map((m) => m.name);
        return {
          code,
          label: code === 'Chưa rõ' ? 'Chưa rõ phòng ban' : `${code} · ${DEPARTMENT_LABEL[code as Department] ?? code}`,
          logged,
          notLogged,
          expected: logged.length + notLogged.length,
          obstacles: logged.filter((x) => x.hasObstacle).length,
        };
      })
      .sort((a, b) => b.obstacles - a.obstacles || a.label.localeCompare(b.label));
  }, [summariesByDepartment, teamMembers]);

  /** Danh sách từng người + nhật ký hôm nay của họ (bấm để mở chi tiết). */
  const renderMemberList = (members: MemberDailySummary[]) => (
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
  );

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
                style={{ width: blockedCount > 0 ? `${Math.round((blockedCount / tierItems.length) * 100)}%` : '100%' }}
              ></div>
            </div>
            <span
              className={`text-xs font-semibold ${
                blockedCount > 0 ? 'text-error' : 'text-tertiary'
              }`}
            >
              {blockedCount > 0
                ? (firstBlocker ? blockerText(firstBlocker) || firstBlocker.title : 'Xem chi tiết bên dưới')
                : 'Không có điểm nghẽn'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tiến độ theo dự án: chỉ T1 → T2, số dòng không phình theo số đầu việc. */}
          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-on-surface">Tiến độ theo dự án</h3>
              <span className="text-xs text-secondary">
                {projects.filter((p) => p.status === 'Đã xong').length}/{projects.length} dự án đã xong
              </span>
            </div>
            {projects.length === 0 ? (
              <p className="text-sm text-secondary italic">Chưa có dự án nào trong phạm vi bạn được xem.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {projects.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1.5">
                    <ProgressRow item={p} strong onOpen={onOpenItem} />
                    {(phasesOf.get(p.id) ?? []).map((ph) => (
                      <ProgressRow key={ph.id} item={ph} onOpen={onOpenItem} />
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Cần chú ý: chỉ ngoại lệ, xếp theo mức nghiêm trọng. */}
          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-on-surface">Cần chú ý</h3>
              <span className={`text-xs font-semibold ${attention.length > 0 ? 'text-error' : 'text-tertiary'}`}>
                {attention.length} mục
              </span>
            </div>
            {attention.length === 0 ? (
              <p className="text-sm text-tertiary">
                Không có mục nào quá hạn, vướng mắc hoặc chậm hơn kế hoạch từ {BEHIND_THRESHOLD}% trở lên.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-surface-container-low">
                  {(showAllAttention ? attention : attention.slice(0, ATTENTION_LIMIT)).map((a) => (
                    <li key={a.item.id}>
                      <button
                        type="button"
                        onClick={() => onOpenItem?.(a.item.id)}
                        className="w-full text-left py-2.5 flex items-start gap-3 hover:bg-surface-container-low/40 rounded transition-colors"
                      >
                        <span
                          className={`shrink-0 w-32 text-xs font-semibold px-2 py-0.5 rounded text-center ${ATTENTION_TONE[a.kind]}`}
                        >
                          {a.label}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-on-surface truncate">{a.item.title}</span>
                          <span className="block text-xs text-secondary truncate">
                            <span className="font-mono">{a.item.code}</span> · {a.item.tierName.split(': ')[1] ?? a.item.tierName} ·{' '}
                            {a.item.owner.name}
                            {a.detail ? ` · “${a.detail}”` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {attention.length > ATTENTION_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllAttention((v) => !v)}
                    className="self-start text-xs font-semibold text-primary hover:underline"
                  >
                    {showAllAttention ? 'Thu gọn' : `Xem tất cả ${attention.length} mục`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Tải công việc: quản lý xem từng người trong phòng; admin/BGĐ xem theo phòng ban. */}
        {isManagerView ? (
          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
            <h3 className="text-base font-bold text-on-surface">Tải công việc đội ngũ</h3>
            {teamMembers.length === 0 ? (
              <p className="text-sm text-secondary italic">Chưa có thành viên nào trong phạm vi bạn được xem.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                {teamMembers.map((member) => (
                  <MemberLoad key={member.id} member={member} maxActive={maxActive} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-on-surface">Theo phòng ban</h3>
              <span className="text-xs text-secondary">Bấm vào một phòng để xem từng người</span>
            </div>
            {deptRows.length === 0 ? (
              <p className="text-sm text-secondary italic">Chưa có phòng ban nào có công việc hoặc nhân sự.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-surface-container text-secondary text-xs font-bold uppercase">
                      <th className="pb-2.5">Phòng ban</th>
                      <th className="pb-2.5 text-right">Đang mở</th>
                      <th className="pb-2.5 text-right">Quá hạn</th>
                      <th className="pb-2.5 text-right">Đang vướng</th>
                      <th className="pb-2.5 text-right">Nộp báo cáo tuần này</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptRows.map((d) => {
                      const expanded = expandedDept === d.code;
                      return (
                        <React.Fragment key={d.code}>
                          <tr
                            onClick={() => setExpandedDept(expanded ? null : d.code)}
                            className="border-b border-surface-container-low cursor-pointer hover:bg-surface-container-low/40 transition-colors"
                          >
                            <td className="py-2.5 pr-2">
                              <button
                                type="button"
                                aria-expanded={expanded}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedDept(expanded ? null : d.code);
                                }}
                                className="flex items-center gap-1.5 font-semibold text-on-surface text-left"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px] text-secondary">
                                  {expanded ? 'expand_more' : 'chevron_right'}
                                </span>
                                {d.label}
                              </button>
                            </td>
                            <td className="py-2.5 text-right font-mono">{d.open}</td>
                            <td className={`py-2.5 text-right font-mono ${d.overdue > 0 ? 'text-error font-bold' : ''}`}>{d.overdue}</td>
                            <td className={`py-2.5 text-right font-mono ${d.blocked > 0 ? 'text-error font-bold' : ''}`}>{d.blocked}</td>
                            <td className="py-2.5 text-right">
                              {weeklyStatus === 'loading' ? (
                                <span className="text-xs text-outline">Đang tải…</span>
                              ) : weeklyStatus === 'error' || d.employees === 0 ? (
                                <span className="text-xs text-outline">—</span>
                              ) : (
                                <span className={`font-mono ${d.submitted < d.employees ? 'text-warning font-semibold' : 'text-tertiary font-semibold'}`}>
                                  {d.submitted}/{d.employees} ({Math.round((d.submitted / d.employees) * 100)}%)
                                </span>
                              )}
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="border-b border-surface-container-low">
                              <td colSpan={5} className="py-3 px-2 bg-surface-container-low/30">
                                {d.members.length === 0 ? (
                                  <p className="text-xs text-secondary italic">Phòng chưa có nhân sự nhận việc.</p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                                    {d.members.map((member) => (
                                      <MemberLoad key={member.id} member={member} maxActive={maxActive} />
                                    ))}
                                  </div>
                                )}
                                {weeklyStatus === 'ready' && d.notSubmitted.length > 0 && (
                                  <p className="mt-3 text-xs text-warning">
                                    Chưa nộp báo cáo tuần này: {d.notSubmitted.join(', ')}
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Hoạt động hôm nay — quản lý xem từng người; admin/BGĐ xem theo phòng. */}
        {isManagerView ? (
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
                    {renderMemberList(members)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Admin / BGĐ: thu gọn theo phòng — bấm 1 phòng mới xem từng người. */
          <div className="bg-white p-5 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:20px] text-primary">
                  edit_calendar
                </span>
                <h3 className="text-base font-bold text-on-surface">Ghi nhật ký hôm nay</h3>
              </div>
              <span className="text-xs text-secondary">
                {todayStats.members} người · {todayStats.totalLogs} nhật ký
              </span>
            </div>
            {dailyByDept.length === 0 ? (
              <p className="text-sm text-secondary italic">
                Chưa có ai đang có việc mở hoặc đã ghi nhật ký hôm nay.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {dailyByDept.map((d) => {
                  const open = expandedDailyDept === d.code;
                  return (
                    <li key={d.code} className="rounded-lg border border-surface-container-low bg-surface overflow-hidden">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpandedDailyDept(open ? null : d.code)}
                        className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 hover:bg-white transition-colors"
                      >
                        <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px] text-secondary">
                          {open ? 'expand_more' : 'chevron_right'}
                        </span>
                        <span className="flex-1 min-w-0 text-sm font-semibold text-on-surface truncate">{d.label}</span>
                        <span
                          className={`text-xs font-semibold ${
                            d.logged.length < d.expected ? 'text-warning' : 'text-tertiary'
                          }`}
                        >
                          {d.logged.length}/{d.expected} người đã ghi
                        </span>
                        {d.obstacles > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-error text-xs font-bold">
                            <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px]">warning</span>
                            {d.obstacles} báo vướng
                          </span>
                        )}
                      </button>
                      {open && (
                        <div className="border-t border-surface-container-low">
                          {d.logged.length > 0 ? (
                            renderMemberList(d.logged)
                          ) : (
                            <p className="px-3.5 py-2.5 text-xs text-secondary italic">
                              Chưa ai trong phòng ghi nhật ký hôm nay.
                            </p>
                          )}
                          {d.notLogged.length > 0 && (
                            <p className="px-3.5 py-2.5 text-xs text-warning border-t border-surface-container-low">
                              Chưa ghi hôm nay: {d.notLogged.join(', ')}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
