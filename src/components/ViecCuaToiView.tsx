import React, { useState, useMemo } from 'react';
import { EmployeeTask, DailyLog, ROLE_LABEL, User } from '../types';

/** Một entry để batch save qua onSaveAllLogs. */
export interface SaveLogEntry {
  taskId: string;
  desc: string;
  result: string;
  obstacle: string;
  progress: number;
}

interface ViecCuaToiViewProps {
  currentUser: User;
  tasks: EmployeeTask[];
  /**
   * Lịch sử daily_log đã fetch về từ App.tsx — dùng để hiển thị panel lịch sử
   * 7 ngày khi user bung chevron. Không cần fetch riêng.
   */
  dailyLogs: DailyLog[];
  onToggleDone: (taskId: string) => void;
  onStartTask: (taskId: string) => void;
  /** Phase F: callback ghi daily_log 4 cột cho 1 task (per-row, ít dùng hơn Save All). */
  onAddDailyLog: (taskId: string, description: string, result: string, obstacle: string, progress: number) => void;
  /** Save All — App.tsx batch xử lý N entries, gom toast thành summary 1 cái. */
  onSaveAllLogs: (entries: SaveLogEntry[]) => void;
  onOpenNewPersonalTaskModal: () => void;
}

export const ViecCuaToiView: React.FC<ViecCuaToiViewProps> = ({
  currentUser,
  tasks,
  dailyLogs,
  onToggleDone,
  onStartTask,
  onAddDailyLog,
  onSaveAllLogs,
  onOpenNewPersonalTaskModal,
}) => {
  const [filter, setFilter] = useState<'all' | 'today' | 'doing' | 'done'>('all');
  /**
   * Draft nhật ký theo taskId. User điền nhiều row cùng lúc, 1 click Save All.
   * Fallback về task.description / currentDeliverable / blockerNote khi user
   * chưa gõ (baseline từ daily_log hôm nay đã merge ở App.tsx).
   */
  interface LogDraft {
    desc: string;
    result: string;
    obstacle: string;
    progress: number;
  }
  const [logDrafts, setLogDrafts] = useState<Record<string, LogDraft>>({});
  /**
   * Row đang bung để xem lịch sử 7 ngày. Mặc định đóng hết — bảng gọn,
   * user click chevron mới bung từng row.
   */
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'today') return t.isToday;
    if (filter === 'doing') return t.status === 'doing';
    if (filter === 'done') return t.status === 'done';
    return true;
  });

  const doingCount = tasks.filter((t) => t.status === 'doing').length;
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const todoCount = pendingCount + doingCount; // Tổng việc CHƯA xong (Fix UI-01)
  const todayCount = tasks.filter((t) => t.isToday).length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const overdueCount = tasks.filter((t) => t.isToday && t.status !== 'done').length;

  // Dynamic metric 2 sub-text: first urgent task
  const firstTodayPending = tasks.find((t) => t.isToday && t.status !== 'done');

  const isManager = currentUser.role === 'manager' || currentUser.role === 'director';

  // Use the manager of the first task as the recipient label
  const managerLabel = isManager ? 'Ban Điều hành' : (tasks[0]?.manager?.name ?? 'Trưởng phòng phụ trách');

  /** Lấy draft cho 1 task. Fallback về dữ liệu baseline từ task
   *  (description / currentDeliverable / blockerNote) khi user chưa gõ. */
  const getDraft = (task: EmployeeTask): LogDraft => {
    const cached = logDrafts[task.id];
    if (cached) return cached;
    return {
      desc: task.description || '',
      result: task.currentDeliverable || '',
      obstacle: task.blockerNote || '',
      progress: 0,
    };
  };

  const patchDraft = (taskId: string, patch: Partial<LogDraft>) => {
    setLogDrafts((prev) => {
      const cur = prev[taskId] ?? { desc: '', result: '', obstacle: '', progress: 0 };
      return { ...prev, [taskId]: { ...cur, ...patch } };
    });
  };

  const submitLogInline = (task: EmployeeTask) => {
    const draft = getDraft(task);
    if (!draft.desc.trim() && !draft.result.trim()) return;
    onAddDailyLog(
      task.id,
      draft.desc.trim(),
      draft.result.trim(),
      draft.obstacle.trim(),
      draft.progress,
    );
    // Clear draft để lần render kế tiếp đọc lại currentDeliverable / blockerNote mới từ task.
    setLogDrafts((prev) => {
      if (!(task.id in prev)) return prev;
      const next = { ...prev };
      delete next[task.id];
      return next;
    });
  };

  /** True khi draft khác baseline → user đang soạn chưa lưu. */
  const isDraftDirty = (task: EmployeeTask): boolean => {
    const d = getDraft(task);
    return (
      d.desc !== (task.description || '') ||
      d.result !== (task.currentDeliverable || '') ||
      d.obstacle !== (task.blockerNote || '') ||
      d.progress !== 0
    );
  };

  /** Trạng thái real-time hiển thị trên row. */
  type LogStatus = 'has_blocker' | 'drafting' | 'submitted' | 'not_submitted';
  const getLogStatus = (task: EmployeeTask): LogStatus => {
    if (task.blockerNote) return 'has_blocker';
    if (isDraftDirty(task)) return 'drafting';
    if (task.currentDeliverable) return 'submitted';
    return 'not_submitted';
  };

  /** Toggle row mở/đóng để xem lịch sử. */
  const toggleRow = (taskId: string) => {
    setExpandedRows((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  /** Build map taskNumId → lịch sử daily_log N ngày gần nhất (mặc định 7),
   *  đã loại log hôm nay (vì hôm nay đã có draft inline). Memoize theo dailyLogs. */
  const HISTORY_LIMIT = 7;
  const historyByTask = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const out: Record<number, DailyLog[]> = {};
    for (const log of dailyLogs) {
      if (log.logDate === today) continue;
      const numId = Number(log.taskId);
      if (!Number.isFinite(numId)) continue;
      const arr = out[numId] ?? (out[numId] = []);
      if (arr.length >= HISTORY_LIMIT) continue;
      arr.push(log);
    }
    return out;
  }, [dailyLogs]);

  /** Save All — quét tất cả row có draft khác baseline, gom thành entries
   *  gửi 1 phát qua onSaveAllLogs. App.tsx xử lý batch (network + audit + toast). */
  const dirtyTasks = filteredTasks.filter((t) => isDraftDirty(t));
  const dirtyCount = dirtyTasks.length;

  const saveAll = () => {
    if (dirtyCount === 0) return;
    const entries: SaveLogEntry[] = [];
    for (const t of dirtyTasks) {
      const d = getDraft(t);
      if (!d.desc.trim() && !d.result.trim()) continue;
      entries.push({
        taskId: t.id,
        desc: d.desc.trim(),
        result: d.result.trim(),
        obstacle: d.obstacle.trim(),
        progress: d.progress,
      });
    }
    if (entries.length === 0) return;
    onSaveAllLogs(entries);
    // Clear draft cho các task đã save → render kế tiếp đọc lại currentDeliverable mới.
    setLogDrafts((prev) => {
      const next = { ...prev };
      for (const e of entries) delete next[e.taskId];
      return next;
    });
  };

  /** Hủy tất cả draft chưa lưu, quay về baseline. */
  const discardAll = () => {
    if (dirtyCount === 0) return;
    setLogDrafts({});
  };

  return (
    <div className="flex flex-col w-full">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Top Personalized Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-xl border border-[#e5eeff] shadow-sm">
          <div className="flex flex-col gap-1.5 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#dae2fd] text-[#131b2e] text-[12px] font-semibold">
                <span className="w-2 h-2 rounded-full bg-[#006243]"></span>
                {ROLE_LABEL[currentUser.role]}
              </span>
              <span className="font-mono text-[12px] text-[#565e74] font-semibold">
                @{currentUser.username}
              </span>
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[17px] font-bold text-[#004ac6]">
                Xin chào {currentUser.fullname} 👋
              </span>
            </div>
            <h1 className="text-[22px] sm:text-[26px] font-bold text-[#0b1c30] tracking-tight">
              Việc của tôi
            </h1>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center">
            <button
              onClick={onOpenNewPersonalTaskModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#eff4ff] hover:bg-[#dce9ff] text-[#0b1c30] text-[13px] font-semibold transition-colors shadow-sm"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-[#004ac6]">
                add_circle
              </span>
              <span>+ Tự tạo thêm việc cá nhân</span>
            </button>
            {/* Phase F: bỏ nút "Báo cáo nhanh cho Trưởng phòng" + hỗ trợ
                nhân viên. Escalation giờ là tasks.blocker_note (NV ghi 1 dòng
                qua modal "Báo cáo vướng mắc" trên từng task). */}
            {isManager && (
              <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#eff4ff] text-[#434655] text-[12px]">
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span>Bạn là cấp quản lý — hỗ trợ nhân viên ở tab "Giao việc nhóm".</span>
              </span>
            )}
          </div>
        </div>

        {/* 4 Friendly Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Metric 1 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                Việc cần làm
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#eff4ff] flex items-center justify-center text-[#004ac6]">
                <span className="material-symbols-outlined text-[19px]">
                  assignment
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-[32px] font-bold text-[#0b1c30] tabular-nums">
                {/* Fix UI-01: tổng việc CHƯA xong (pending + doing) thay vì biểu thức `? 0 : 0` rỗng */}
                {todoCount}
              </span>
              <span className="text-[13px] text-[#565e74]">việc</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[#565e74] text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-[#004ac6]">
                flag
              </span>
              <span>Cần ưu tiên trong tuần này</span>
            </div>
          </div>

          {/* Metric 2 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col justify-between relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                Hôm nay cần xong
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#ffdad6] flex items-center justify-center text-[#ba1a1a]">
                <span className="material-symbols-outlined text-[19px]">
                  schedule
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-[32px] font-bold text-[#ba1a1a] tabular-nums">
                {todayCount}
              </span>
              <span className="text-[13px] text-[#565e74]">đầu việc chốt</span>
            </div>
            <div className="mt-1 text-[11px] text-[#0b1c30] font-medium truncate">
              {/* Fix UI-02: dùng firstTodayPending?.title thay vì hardcode "Thuê mặt bằng & ký hợp đồng" */}
              {firstTodayPending?.title ?? 'Không có việc gấp hôm nay'}
            </div>
          </div>

          {/* Metric 3 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                Đã hoàn thành
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#85f8c4]/40 flex items-center justify-center text-[#006243]">
                <span className="material-symbols-outlined text-[19px]">
                  task_alt
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-[32px] font-bold text-[#006243] tabular-nums">
                {doneCount}
              </span>
              <span className="text-[13px] text-[#565e74]">việc hoàn tất</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[#006243] text-[11px] font-semibold">
              <span className="material-symbols-outlined text-[14px]">
                verified
              </span>
              <span>Được Trưởng phòng duyệt đạt</span>
            </div>
          </div>

          {/* Metric 4 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                Trạng thái
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#eff4ff] flex items-center justify-center text-[#004ac6]">
                <span className="material-symbols-outlined text-[19px]">
                  sentiment_satisfied
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${overdueCount > 0 ? 'bg-[#ba1a1a]' : 'bg-[#006243]'}`}></span>
              <span className={`text-[16px] font-bold ${overdueCount > 0 ? 'text-[#ba1a1a]' : 'text-[#006243]'}`}>
                {overdueCount > 0 ? `${overdueCount} việc gấp` : 'Đang thuận lợi'}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px]">
              <span className={`material-symbols-outlined text-[14px] ${overdueCount > 0 ? 'text-[#ba1a1a]' : 'text-[#006243]'}`}>
                {overdueCount > 0 ? 'warning' : 'check_circle'}
              </span>
              <span className={overdueCount > 0 ? 'text-[#ba1a1a] font-semibold' : 'text-[#565e74]'}>
                {overdueCount > 0 ? `${overdueCount} việc cần xử lý hôm nay` : 'Không có việc nào bị trễ hạn'}
              </span>
            </div>
          </div>
        </div>

        {/* Task List Section */}
        <div className="flex flex-col gap-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-[#e5eeff] shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFilter('all')}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  filter === 'all'
                    ? 'bg-[#004ac6] text-white shadow-sm'
                    : 'text-[#565e74] hover:bg-[#eff4ff]'
                }`}
                type="button"
              >
                Tất cả việc của tôi ({tasks.length})
              </button>
              <button
                onClick={() => setFilter('today')}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  filter === 'today'
                    ? 'bg-[#004ac6] text-white shadow-sm'
                    : 'text-[#565e74] hover:bg-[#eff4ff]'
                }`}
                type="button"
              >
                Cần làm hôm nay ({todayCount})
              </button>
              <button
                onClick={() => setFilter('doing')}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  filter === 'doing'
                    ? 'bg-[#004ac6] text-white shadow-sm'
                    : 'text-[#565e74] hover:bg-[#eff4ff]'
                }`}
                type="button"
              >
                Đang làm ({doingCount})
              </button>
              <button
                onClick={() => setFilter('done')}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  filter === 'done'
                    ? 'bg-[#006243] text-white shadow-sm'
                    : 'text-[#565e74] hover:bg-[#eff4ff]'
                }`}
                type="button"
              >
                Đã làm xong ({doneCount})
              </button>
            </div>
          </div>

          {/* Inline-edit Task Table (sheet-style, 1 row = 1 task) */}
          <div className="bg-white rounded-xl border border-[#e5eeff] shadow-sm overflow-x-auto">
            <div
              className="grid items-center gap-2 px-4 min-w-[1066px]"
              style={{
                gridTemplateColumns:
                  '28px 72px 180px 76px minmax(180px,1fr) minmax(180px,1fr) 140px 130px 96px',
              }}
            >
              {/* Header row */}
              <div className="contents">
                <div className="py-3"></div>
                <div className="py-3 text-[11px] font-bold text-[#565e74] uppercase tracking-wider">Mã</div>
                <div className="py-3 text-[11px] font-bold text-[#565e74] uppercase tracking-wider">Công việc · Gói</div>
                <div className="py-3 text-[11px] font-bold text-[#565e74] uppercase tracking-wider">Hạn</div>
                <div className="py-3 text-[11px] font-bold text-[#565e74] uppercase tracking-wider">Mô tả hôm nay</div>
                <div className="py-3 text-[11px] font-bold text-[#565e74] uppercase tracking-wider">Kết quả</div>
                <div className="py-3 text-[11px] font-bold text-[#565e74] uppercase tracking-wider">Vướng mắc</div>
                <div className="py-3 text-[11px] font-bold text-[#565e74] uppercase tracking-wider">Tiến độ</div>
                <div className="py-3 text-[11px] font-bold text-[#565e74] uppercase tracking-wider">Hành động</div>
              </div>

              {/* Rows */}
              {filteredTasks.map((task) => {
                const isDone = task.status === 'done';
                const isDoing = task.status === 'doing';
                const isPending = task.status === 'pending';
                const draft = getDraft(task);
                const draftKey = task.id;
                const isExpanded = !!expandedRows[task.id];
                const status_ = getLogStatus(task);
                const taskNumId = Number(task.id.replace(/^[^-]+-/, ''));
                const history =
                  (Number.isFinite(taskNumId) && historyByTask[taskNumId]) || [];
                const presets = [0, 25, 50, 75, 100];

                const statusConfig: Record<
                  LogStatus,
                  { cls: string; icon: string; label: string }
                > = {
                  has_blocker: {
                    cls: 'bg-[#ffdad6] text-[#ba1a1a] border-[#ffb4ab]',
                    icon: 'priority_high',
                    label: 'Có vướng mắc',
                  },
                  drafting: {
                    cls: 'bg-[#fff3cd] text-[#856404] border-[#ffe69c]',
                    icon: 'edit',
                    label: 'Đang soạn',
                  },
                  submitted: {
                    cls: 'bg-[#85f8c4]/40 text-[#006243] border-[#006243]/30',
                    icon: 'check_circle',
                    label: 'Đã cập nhật',
                  },
                  not_submitted: {
                    cls: 'bg-[#eff4ff] text-[#565e74] border-[#dce9ff]',
                    icon: 'radio_button_unchecked',
                    label: 'Chưa nộp',
                  },
                };
                const statusCfg = statusConfig[status_];

                return (
                  <React.Fragment key={task.id}>
                    {/* Main row */}
                    <div className="contents" data-testid={`task-row-${task.id}`}>
                      {/* Chevron */}
                      <button
                        onClick={() => toggleRow(task.id)}
                        className={`h-9 w-7 flex items-center justify-center rounded-md transition-colors ${
                          isExpanded
                            ? 'bg-[#dce9ff] text-[#004ac6]'
                            : 'text-[#737686] hover:bg-[#eff4ff]'
                        }`}
                        type="button"
                        title={isExpanded ? 'Thu lịch sử' : 'Xem lịch sử 7 ngày'}
                        aria-expanded={isExpanded}
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {isExpanded ? 'expand_more' : 'chevron_right'}
                        </span>
                      </button>

                      {/* Code */}
                      <div
                        className={`font-mono text-[12px] font-extrabold ${
                          isDone ? 'line-through text-[#737686]' : 'text-[#004ac6]'
                        }`}
                      >
                        {task.code}
                      </div>

                      {/* Title + bundle + status badge */}
                      <div className="min-w-0">
                        <div
                          className={`text-[13px] font-bold truncate ${
                            isDone ? 'line-through text-[#737686]' : 'text-[#0b1c30]'
                          }`}
                        >
                          {task.title}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-[#565e74] truncate">
                            {task.bundleName}
                          </span>
                          <span
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${statusCfg.cls}`}
                            title={statusCfg.label}
                          >
                            <span className="material-symbols-outlined text-[11px]">
                              {statusCfg.icon}
                            </span>
                            <span className="hidden xl:inline">{statusCfg.label}</span>
                          </span>
                        </div>
                      </div>

                      {/* Deadline */}
                      <div
                        className={`text-[12px] font-semibold ${
                          task.isToday ? 'text-[#ba1a1a]' : 'text-[#0b1c30]'
                        }`}
                      >
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle ${
                            task.isToday
                              ? 'bg-[#ba1a1a] animate-pulse'
                              : 'bg-[#737686]'
                          }`}
                        ></span>
                        {task.deadline}
                      </div>

                      {/* Mô tả (inline edit) */}
                      <textarea
                        value={draft.desc}
                        onChange={(e) =>
                          patchDraft(draftKey, { desc: e.target.value })
                        }
                        rows={1}
                        disabled={isDone}
                        className="text-[12px] px-2 py-1.5 bg-[#f6f8ff] border border-[#e5eeff] rounded-md focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6] resize-none disabled:bg-[#e8eaf3] disabled:cursor-not-allowed min-h-[34px]"
                        placeholder="Mô tả…"
                      />

                      {/* Kết quả (inline edit) */}
                      <textarea
                        value={draft.result}
                        onChange={(e) =>
                          patchDraft(draftKey, { result: e.target.value })
                        }
                        rows={1}
                        disabled={isDone}
                        className="text-[12px] px-2 py-1.5 bg-[#f6f8ff] border border-[#e5eeff] rounded-md focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6] resize-none disabled:bg-[#e8eaf3] disabled:cursor-not-allowed min-h-[34px]"
                        placeholder="Kết quả…"
                      />

                      {/* Vướng mắc (inline edit) */}
                      <textarea
                        value={draft.obstacle}
                        onChange={(e) =>
                          patchDraft(draftKey, { obstacle: e.target.value })
                        }
                        rows={1}
                        disabled={isDone}
                        className={`text-[12px] px-2 py-1.5 border rounded-md focus:outline-none focus:bg-white focus:ring-2 resize-none disabled:bg-[#e8eaf3] disabled:cursor-not-allowed min-h-[34px] ${
                          draft.obstacle.trim()
                            ? 'bg-[#fff3f3] border-[#ffb4ab] focus:ring-[#ba1a1a] text-[#0b1c30]'
                            : 'bg-[#f6f8ff] border-[#e5eeff] focus:ring-[#ba1a1a] text-[#737686]'
                        }`}
                        placeholder="(không có)"
                      />

                      {/* Progress — slider + presets */}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={draft.progress}
                            disabled={isDone}
                            onChange={(e) =>
                              patchDraft(draftKey, {
                                progress: Number(e.target.value),
                              })
                            }
                            className="flex-1 accent-[#004ac6] disabled:opacity-50"
                          />
                          <span className="text-[11px] font-extrabold text-[#004ac6] tabular-nums w-8 text-right">
                            {draft.progress}%
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {presets.map((p) => {
                            const active = draft.progress === p;
                            return (
                              <button
                                key={p}
                                type="button"
                                disabled={isDone}
                                onClick={() => patchDraft(draftKey, { progress: p })}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors disabled:cursor-not-allowed ${
                                  active
                                    ? 'bg-[#004ac6] text-white'
                                    : 'bg-[#eff4ff] text-[#004ac6] hover:bg-[#dce9ff] disabled:bg-[#e8eaf3]'
                                }`}
                              >
                                {p}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Actions */}
                      <div>
                        {isPending ? (
                          <button
                            onClick={() => onStartTask(task.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#004ac6] hover:bg-[#2563eb] text-white text-[11px] font-bold transition-all shadow-sm"
                            type="button"
                            title="Chuyển sang Đang làm"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              play_arrow
                            </span>
                            <span>Bắt đầu</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => onToggleDone(task.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all shadow-sm ${
                              isDone
                                ? 'bg-[#85f8c4] text-[#002114] hover:bg-emerald-300'
                                : 'bg-[#006243] hover:bg-[#007d57] text-white'
                            }`}
                            type="button"
                            title={isDone ? 'Đánh dấu chưa xong' : 'Báo đã xong'}
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              check_circle
                            </span>
                            <span>{isDone ? 'Đã xong' : 'Báo xong'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expand panel — lịch sử 7 ngày */}
                    {isExpanded && (
                      <div className="col-span-full -mx-4 px-4 py-4 bg-[#f6f8ff] border-t border-[#e5eeff]">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-[12px] font-bold text-[#565e74] uppercase tracking-wider flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[16px] text-[#004ac6]">
                              history
                            </span>
                            Lịch sử {HISTORY_LIMIT} ngày gần nhất
                          </h4>
                          <span className="text-[11px] text-[#737686]">
                            Click chevron để thu lại.
                          </span>
                        </div>
                        {history.length === 0 ? (
                          <div className="text-[12px] text-[#737686] italic py-3">
                            Chưa có nhật ký nào trước đây — đây là lần đầu bạn ghi log cho task này.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                            {history.map((log) => (
                              <div
                                key={log.id}
                                className="bg-white rounded-lg border border-[#e5eeff] p-3 flex flex-col gap-1.5"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-extrabold text-[#004ac6] font-mono">
                                    {log.logDate}
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#eff4ff] text-[#004ac6] text-[10px] font-bold">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#004ac6]"></span>
                                    {log.progress}%
                                  </span>
                                </div>
                                {log.description && (
                                  <div className="text-[12px] text-[#0b1c30]">
                                    <span className="text-[10px] font-bold text-[#565e74] uppercase mr-1">Mô tả:</span>
                                    {log.description}
                                  </div>
                                )}
                                {log.result && (
                                  <div className="text-[12px] text-[#0b1c30]">
                                    <span className="text-[10px] font-bold text-[#565e74] uppercase mr-1">Kết quả:</span>
                                    {log.result}
                                  </div>
                                )}
                                {log.obstacle && (
                                  <div className="text-[12px] text-[#ba1a1a] flex items-start">
                                    <span className="material-symbols-outlined text-[14px] mr-1 mt-0.5 shrink-0">
                                      priority_high
                                    </span>
                                    <span>{log.obstacle}</span>
                                  </div>
                                )}
                                <div className="text-[10px] text-[#737686] mt-1">
                                  {log.userName}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}

              {filteredTasks.length === 0 && (
                <div className="col-span-full px-4 py-12 text-center text-[#565e74] bg-[#eff4ff]/40">
                  <span className="material-symbols-outlined text-[40px] text-[#c3c6d7] block mb-2">
                    inbox
                  </span>
                  Không có task nào trong bộ lọc này.
                </div>
              )}
            </div>
          </div>

          {/* Save All Bar — sticky bottom, chỉ hiện khi có draft */}
          {dirtyCount > 0 && (
            <div className="sticky bottom-4 z-30 bg-white border border-[#004ac6] rounded-xl shadow-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#fff3cd] text-[#856404] text-[12px] font-extrabold">
                  {dirtyCount}
                </span>
                <div className="flex flex-col">
                  <span className="text-[13px] font-bold text-[#0b1c30]">
                    {dirtyCount} task đang có thay đổi chưa lưu
                  </span>
                  <span className="text-[11px] text-[#565e74]">
                    1 cú click lưu tất cả nhật ký hôm nay
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={discardAll}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-[#0b1c30] text-[12px] font-semibold transition-colors"
                  type="button"
                >
                  Hủy thay đổi
                </button>
                <button
                  onClick={saveAll}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#006243] hover:bg-[#007d57] text-white text-[13px] font-bold transition-all shadow-sm"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    save
                  </span>
                  <span>
                    Lưu tất cả nhật ký hôm nay ({dirtyCount})
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
