import React, { useState, useMemo } from 'react';
import { EmployeeTask, DailyLog, ROLE_LABEL, User } from '../types';
import { todayIso } from '../lib/transforms';
import { canApproveTask } from '../auth/permissions';
import { useSessionState, useUnsavedChangesWarning } from '../lib/useSessionState';

/** Một entry để lưu nhật ký qua onSaveLogs. */
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
  /** Nhật ký đã tải ở App — panel lịch sử 7 ngày đọc từ đây, không fetch riêng. */
  dailyLogs: DailyLog[];
  /** Chuyển task sang bước kế tiếp (Chuẩn bị → Đang làm → Chờ duyệt). Resolve true khi server chấp nhận. */
  onAdvanceTask: (taskId: string) => Promise<boolean>;
  /** Lưu nhật ký; resolve danh sách taskId đã lưu thành công. */
  onSaveLogs: (entries: SaveLogEntry[]) => Promise<string[]>;
  onOpenNewPersonalTaskModal: () => void;
  /** Bộ lọc lưu trên URL (?loc=due); giá trị lạ coi như 'open'. */
  filter?: string;
  onFilterChange: (filter: Filter) => void;
}

interface LogDraft {
  desc: string;
  result: string;
  obstacle: string;
  progress: number;
}

/**
 * 3 nhóm chính chia hết danh sách: open (chưa báo xong) / awaiting (chờ duyệt) / done.
 * 'due' và 'blocked' là lối tắt — tập con của 'open'.
 * "Hôm nay" chỉ tính theo hạn chót; không có cờ tự đánh dấu.
 */
const FILTERS = ['open', 'awaiting', 'done', 'due', 'blocked'] as const;
type Filter = (typeof FILTERS)[number];

const HISTORY_LIMIT = 7;

function isOpen(t: EmployeeTask) {
  return t.status !== 'done' && t.status !== 'pending_approval';
}

const hasDeadline = (t: EmployeeTask) => /^\d{4}-\d{2}-\d{2}$/.test(t.deadline);

function isOverdue(t: EmployeeTask, today: string) {
  return isOpen(t) && hasDeadline(t) && t.deadline < today;
}

/** Quá hạn hoặc tới hạn đúng hôm nay, chưa báo xong. */
function isDue(t: EmployeeTask, today: string) {
  return isOpen(t) && hasDeadline(t) && t.deadline <= today;
}

/** Đang vướng: bị chặn, hoặc NV đã ghi vướng mắc (ghi vướng mắc không đổi trạng thái). */
function isBlocked(t: EmployeeTask) {
  return t.status === 'blocked' || !!t.blockerNote?.trim();
}

/** "2026-10-26" → "26/10"; giá trị không phải ngày ISO giữ nguyên. */
function formatDeadline(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso || '—';
}

export const ViecCuaToiView: React.FC<ViecCuaToiViewProps> = ({
  currentUser,
  tasks,
  dailyLogs,
  onAdvanceTask,
  onSaveLogs,
  onOpenNewPersonalTaskModal,
  filter: filterParam,
  onFilterChange: setFilter,
}) => {
  const today = todayIso();
  const filter: Filter = FILTERS.find((f) => f === filterParam) ?? 'open';
  /**
   * Nháp nhật ký theo taskId, giữ trong sessionStorage theo user + ngày:
   * đổi tab hay F5 không mất, sang ngày mới không bị lưu nhầm thành nhật ký hôm nay.
   */
  const [logDrafts, setLogDrafts] = useSessionState<Record<string, LogDraft>>(
    `log-drafts:${currentUser.id}:${today}`,
    {},
  );
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const matches: Record<Filter, (t: EmployeeTask) => boolean> = {
    open: isOpen,
    awaiting: (t) => t.status === 'pending_approval',
    done: (t) => t.status === 'done',
    due: (t) => isDue(t, today),
    blocked: (t) => isOpen(t) && isBlocked(t),
  };
  const filteredTasks = tasks.filter(matches[filter]);

  // Mọi nhóm: hạn chót gần nhất lên trước (việc quá hạn tự nằm trên cùng); việc không có hạn xuống cuối.
  const sortedTasks = useMemo(
    () =>
      [...filteredTasks].sort(
        (a, b) =>
          (hasDeadline(a) ? a.deadline : '9999').localeCompare(hasDeadline(b) ? b.deadline : '9999') ||
          a.code.localeCompare(b.code),
      ),
    [filteredTasks],
  );

  const count = (f: Filter) => tasks.filter(matches[f]).length;
  const openTasks = tasks.filter(isOpen);
  const doingCount = openTasks.filter((t) => t.status === 'doing').length;
  const pendingCount = openTasks.filter((t) => t.status === 'pending').length;
  const blockedCount = count('blocked');
  const overdueCount = tasks.filter((t) => isOverdue(t, today)).length;
  const dueTodayCount = count('due') - overdueCount;
  const awaitingCount = count('awaiting');
  const doneCount = count('done');

  const isManager = currentUser.role === 'manager' || currentUser.role === 'director';

  /** Nháp của 1 task; chưa gõ gì thì lấy baseline đã lưu hôm nay. */
  const getDraft = (task: EmployeeTask): LogDraft =>
    logDrafts[task.id] ?? {
      desc: task.description || '',
      result: task.currentDeliverable || '',
      obstacle: task.blockerNote || '',
      progress: task.progress ?? 0,
    };

  const patchDraft = (task: EmployeeTask, patch: Partial<LogDraft>) => {
    setLogDrafts((prev) => ({ ...prev, [task.id]: { ...getDraft(task), ...prev[task.id], ...patch } }));
  };

  /** True khi nháp khác dữ liệu đã lưu. */
  const isDraftDirty = (task: EmployeeTask): boolean => {
    const d = logDrafts[task.id];
    if (!d) return false;
    return (
      d.desc !== (task.description || '') ||
      d.result !== (task.currentDeliverable || '') ||
      d.obstacle !== (task.blockerNote || '') ||
      d.progress !== (task.progress ?? 0)
    );
  };

  type LogStatus = 'has_blocker' | 'drafting' | 'submitted' | 'not_submitted';
  const getLogStatus = (task: EmployeeTask): LogStatus => {
    if (isDraftDirty(task)) return 'drafting';
    if (task.blockerNote) return 'has_blocker';
    if (task.currentDeliverable) return 'submitted';
    return 'not_submitted';
  };

  const toggleRow = (taskId: string) => {
    setExpandedRows((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  /** taskNumId → nhật ký các ngày trước (không gồm hôm nay), chỉ của chính user đang xem. */
  const historyByTask = useMemo(() => {
    const out: Record<number, DailyLog[]> = {};
    for (const log of dailyLogs) {
      if (log.logDate === today) continue;
      if (log.username && log.username !== currentUser.username) continue;
      const numId = Number(log.taskId);
      if (!Number.isFinite(numId)) continue;
      const arr = out[numId] ?? (out[numId] = []);
      if (arr.length < HISTORY_LIMIT) arr.push(log);
    }
    return out;
  }, [dailyLogs, currentUser.username, today]);

  const dirtyTasks = tasks.filter((t) => isDraftDirty(t));
  const dirtyCount = dirtyTasks.length;
  useUnsavedChangesWarning(dirtyCount > 0);

  /** Backend bắt buộc có mô tả — nháp thiếu mô tả không gửi được. */
  const missingDescCount = dirtyTasks.filter((t) => !getDraft(t).desc.trim()).length;

  const saveAll = async () => {
    const entries: SaveLogEntry[] = dirtyTasks
      .map((t) => ({ t, d: getDraft(t) }))
      .filter(({ d }) => d.desc.trim())
      .map(({ t, d }) => ({
        taskId: t.id,
        desc: d.desc.trim(),
        result: d.result.trim(),
        obstacle: d.obstacle.trim(),
        progress: d.progress,
      }));
    if (entries.length === 0 || savingAll) return;
    setSavingAll(true);
    try {
      const saved = await onSaveLogs(entries);
      setLogDrafts((prev) => {
        const next = { ...prev };
        for (const id of saved) delete next[id];
        return next;
      });
    } finally {
      setSavingAll(false);
    }
  };

  const discardAll = () => {
    if (dirtyCount === 0) return;
    if (!window.confirm(`Bỏ ${dirtyCount} nhật ký chưa lưu? Thao tác này không hoàn tác được.`)) return;
    setLogDrafts({});
  };

  const advance = async (task: EmployeeTask) => {
    if (busyTaskId) return;
    setBusyTaskId(task.id);
    try {
      await onAdvanceTask(task.id);
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <div className="flex flex-col w-full">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Top Personalized Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-xl border border-surface-container shadow-sm">
          <div className="flex flex-col gap-1.5 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container text-on-secondary-fixed text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-tertiary"></span>
                {ROLE_LABEL[currentUser.role]}
              </span>
              <span className="font-mono text-xs text-secondary font-semibold">
                @{currentUser.username}
              </span>
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-lg font-bold text-primary">
                Xin chào {currentUser.fullname}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">
              Việc của tôi
            </h1>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center">
            <button
              onClick={onOpenNewPersonalTaskModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container-low hover:bg-surface-container-high text-on-surface text-sm font-semibold transition-colors shadow-sm"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px] text-primary">
                add_circle
              </span>
              <span>Tự tạo thêm việc cá nhân</span>
            </button>
            {/* Escalation qua tasks.blocker_note (NV ghi 1 dòng qua modal "Báo cáo vướng mắc" trên từng task). */}
            {isManager && (
              <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-low text-on-surface-variant text-xs">
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">info</span>
                <span>Bạn là cấp quản lý — hỗ trợ nhân viên ở tab "Giao việc nhóm".</span>
              </span>
            )}
          </div>
        </div>

        {/* 4 thẻ số liệu — cùng định nghĩa với bộ lọc bên dưới */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Cần làm"
            icon="assignment"
            tone="primary"
            value={openTasks.length}
            unit="việc"
            caption={`${doingCount} đang làm · ${pendingCount} chưa bắt đầu`}
          />
          <MetricCard
            label="Quá hạn & hôm nay"
            icon={overdueCount > 0 ? 'warning' : 'schedule'}
            tone={overdueCount > 0 ? 'error' : dueTodayCount > 0 ? 'warning' : 'success'}
            value={overdueCount + dueTodayCount}
            unit="việc"
            caption={
              overdueCount + dueTodayCount === 0
                ? 'Không có việc nào tới hạn hôm nay'
                : `${overdueCount} đã quá hạn · ${dueTodayCount} tới hạn hôm nay`
            }
          />
          <MetricCard
            label="Đang vướng"
            icon="block"
            tone={blockedCount > 0 ? 'error' : 'success'}
            value={blockedCount}
            unit="việc"
            caption={blockedCount > 0 ? 'Đang chờ Trưởng phòng gỡ vướng' : 'Không có vướng mắc nào'}
          />
          <MetricCard
            label="Đã báo xong"
            icon="task_alt"
            tone="success"
            value={awaitingCount + doneCount}
            unit="việc"
            caption={`${awaitingCount} chờ duyệt · ${doneCount} đã nghiệm thu`}
          />
        </div>

        {/* Task List Section */}
        <div className="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label="Lọc công việc"
            className="flex flex-wrap items-center gap-1.5 bg-white p-3 rounded-xl border border-surface-container shadow-sm"
          >
            {(
              [
                ['open', `Cần làm (${openTasks.length})`],
                ['awaiting', `Chờ duyệt (${awaitingCount})`],
                ['done', `Đã nghiệm thu (${doneCount})`],
                null,
                ['due', `Quá hạn & hôm nay (${overdueCount + dueTodayCount})`],
                ['blocked', `Đang vướng (${blockedCount})`],
              ] as const
            ).map((entry) =>
              entry === null ? (
                <span key="sep" aria-hidden="true" className="mx-1.5 h-5 w-px bg-surface-container-high" />
              ) : (
                <button
                  key={entry[0]}
                  type="button"
                  role="tab"
                  aria-selected={filter === entry[0]}
                  onClick={() => setFilter(entry[0])}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    filter === entry[0] ? 'bg-primary text-on-primary shadow-sm' : 'text-secondary hover:bg-surface-container-low'
                  }`}
                >
                  {entry[1]}
                </button>
              ),
            )}
          </div>

{/* Inline-edit Task Table (sheet-style, 1 row = 1 task) */}
          <div className="bg-white rounded-xl border border-surface-container shadow-sm overflow-x-auto">
            <div
              className="grid items-center gap-2 px-4 min-w-[1180px]"
              style={{
                gridTemplateColumns:
                  '28px 64px minmax(200px,1.2fr) 76px minmax(160px,1fr) minmax(160px,1fr) 140px 172px 112px',
              }}
            >
              {/* Header row */}
              <div className="contents">
                <div className="py-3"></div>
                <div className="py-3 text-xs font-bold text-secondary uppercase tracking-wider">Mã</div>
                <div className="py-3 text-xs font-bold text-secondary uppercase tracking-wider">Công việc · Gói</div>
                <div className="py-3 text-xs font-bold text-secondary uppercase tracking-wider">Hạn</div>
                <div className="py-3 text-xs font-bold text-secondary uppercase tracking-wider">Mô tả hôm nay</div>
                <div className="py-3 text-xs font-bold text-secondary uppercase tracking-wider">Kết quả</div>
                <div className="py-3 text-xs font-bold text-secondary uppercase tracking-wider">Vướng mắc</div>
                <div className="py-3 text-xs font-bold text-secondary uppercase tracking-wider">Tiến độ</div>
                <div className="py-3 text-xs font-bold text-secondary uppercase tracking-wider">Hành động</div>
              </div>

              {/* Rows */}
              {sortedTasks.map((task) => {
                const locked = task.status === 'done';
                const draft = getDraft(task);
                const isExpanded = !!expandedRows[task.id];
                const logCfg = LOG_STATUS[getLogStatus(task)];
                const flowCfg = FLOW_STATUS[task.status];
                const taskNumId = Number(task.id.replace(/^[^-]+-/, ''));
                const history = (Number.isFinite(taskNumId) && historyByTask[taskNumId]) || [];
                const overdue = isOverdue(task, today);
                const dueToday = isOpen(task) && task.deadline === today;
                const busy = busyTaskId === task.id;

                return (
                  <React.Fragment key={task.id}>
                    <div className="contents" data-testid={`task-row-${task.id}`}>
                      <button
                        onClick={() => toggleRow(task.id)}
                        className={`h-9 w-7 flex items-center justify-center rounded-md transition-colors ${
                          isExpanded ? 'bg-surface-container-high text-primary' : 'text-outline hover:bg-surface-container-low'
                        }`}
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Thu gọn' : 'Xem'} lịch sử ${HISTORY_LIMIT} ngày của ${task.title}`}
                      >
                        <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                          {isExpanded ? 'expand_more' : 'chevron_right'}
                        </span>
                      </button>

                      <div className={`font-mono text-xs font-extrabold ${locked ? 'line-through text-outline' : 'text-primary'}`}>
                        {task.code}
                      </div>

                      <div className="min-w-0">
                        <div className={`text-sm font-bold truncate ${locked ? 'line-through text-outline' : 'text-on-surface'}`}>
                          {task.title}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <StatusBadge {...flowCfg} />
                          {logCfg && <StatusBadge {...logCfg} />}
                        </div>
                        <div className="text-xs text-secondary truncate mt-0.5">{task.bundleName}</div>
                      </div>

                      <div className={`text-xs font-semibold ${overdue ? 'text-error' : dueToday ? 'text-warning' : 'text-on-surface'}`}>
                        {formatDeadline(task.deadline)}
                        {overdue ? (
                          <div className="font-bold">Quá hạn</div>
                        ) : dueToday ? (
                          <div className="font-bold">Hôm nay</div>
                        ) : null}
                      </div>

                      <textarea
                        value={draft.desc}
                        onChange={(e) => patchDraft(task, { desc: e.target.value })}
                        rows={1}
                        disabled={locked}
                        aria-label={`Mô tả hôm nay — ${task.title}`}
                        className={`${FIELD_CLS} ${isDraftDirty(task) && !draft.desc.trim() ? 'border-error' : 'border-surface-container'}`}
                        placeholder="Mô tả (bắt buộc)…"
                      />

                      <textarea
                        value={draft.result}
                        onChange={(e) => patchDraft(task, { result: e.target.value })}
                        rows={1}
                        disabled={locked}
                        aria-label={`Kết quả — ${task.title}`}
                        className={`${FIELD_CLS} border-surface-container`}
                        placeholder="Kết quả…"
                      />

                      <textarea
                        value={draft.obstacle}
                        onChange={(e) => patchDraft(task, { obstacle: e.target.value })}
                        rows={1}
                        disabled={locked}
                        aria-label={`Vướng mắc — ${task.title}`}
                        className={`${FIELD_CLS} ${draft.obstacle.trim() ? 'bg-error-container/40 border-error-fixed' : 'border-surface-container'}`}
                        placeholder="(không có)"
                      />

                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={draft.progress}
                            disabled={locked}
                            aria-label={`Tiến độ — ${task.title}`}
                            onChange={(e) => patchDraft(task, { progress: Number(e.target.value) })}
                            className="flex-1 accent-primary disabled:opacity-50"
                          />
                          <span className="text-xs font-extrabold text-primary tabular-nums w-9 text-right">
                            {draft.progress}%
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {PROGRESS_PRESETS.map((p) => (
                            <button
                              key={p}
                              type="button"
                              disabled={locked}
                              aria-label={`Đặt tiến độ ${p}%`}
                              aria-pressed={draft.progress === p}
                              onClick={() => patchDraft(task, { progress: p })}
                              className={`px-1.5 py-0.5 rounded text-xs font-bold transition-colors disabled:cursor-not-allowed ${
                                draft.progress === p
                                  ? 'bg-primary text-on-primary'
                                  : 'bg-surface-container-low text-primary hover:bg-surface-container-high disabled:bg-surface-container'
                              }`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <TaskAction
                          task={task}
                          selfClose={canApproveTask(currentUser, task)}
                          busy={busy}
                          disabled={busyTaskId !== null}
                          onAdvance={() => advance(task)}
                        />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="col-span-full -mx-4 px-4 py-4 bg-surface-container-low border-t border-surface-container">
                        <h4 className="text-xs font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5 mb-3">
                          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px] text-primary">history</span>
                          Lịch sử {HISTORY_LIMIT} ngày gần nhất
                        </h4>
                        {history.length === 0 ? (
                          <div className="text-xs text-outline italic py-3">
                            Chưa có nhật ký nào trước hôm nay cho việc này.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                            {history.map((log) => (
                              <div key={log.id} className="bg-white rounded-lg border border-surface-container p-3 flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-extrabold text-primary font-mono">{log.logDate}</span>
                                  <span className="px-1.5 py-0.5 rounded-full bg-surface-container-low text-primary text-xs font-bold">
                                    {log.progress}%
                                  </span>
                                </div>
                                {log.description && (
                                  <div className="text-xs text-on-surface">
                                    <span className="font-bold text-secondary mr-1">Mô tả:</span>
                                    {log.description}
                                  </div>
                                )}
                                {log.result && (
                                  <div className="text-xs text-on-surface">
                                    <span className="font-bold text-secondary mr-1">Kết quả:</span>
                                    {log.result}
                                  </div>
                                )}
                                {log.obstacle && (
                                  <div className="text-xs text-error">
                                    <span className="font-bold mr-1">Vướng mắc:</span>
                                    {log.obstacle}
                                  </div>
                                )}
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
                <div className="col-span-full px-4 py-12 text-center text-sm text-secondary bg-surface-container-low/40">
                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:40px] text-outline-variant block mb-2">
                    inbox
                  </span>
                  {tasks.length === 0
                    ? 'Bạn chưa được giao việc nào.'
                    : filter === 'open'
                      ? 'Bạn đã báo xong mọi việc.'
                      : 'Không có việc nào trong mục này.'}
                </div>
              )}
            </div>
          </div>

          {dirtyCount > 0 && (
            <div
              role="region"
              aria-label="Nhật ký chưa lưu"
              className="sticky bottom-4 z-30 bg-white border border-primary rounded-xl shadow-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-bold text-on-surface">
                  {dirtyCount} việc có nhật ký chưa lưu
                </span>
                <span className={`text-xs ${missingDescCount > 0 ? 'text-error font-semibold' : 'text-secondary'}`}>
                  {missingDescCount > 0
                    ? `${missingDescCount} việc còn thiếu mô tả — sẽ không được lưu cho tới khi bổ sung.`
                    : 'Nháp được giữ khi đổi tab hoặc tải lại trang, cho tới khi bạn lưu.'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={discardAll}
                  disabled={savingAll}
                  className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold transition-colors disabled:opacity-50"
                  type="button"
                >
                  Bỏ nháp
                </button>
                <button
                  onClick={saveAll}
                  disabled={savingAll || dirtyCount === missingDescCount}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-tertiary hover:bg-tertiary-container text-on-tertiary text-sm font-bold transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  type="button"
                >
                  <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                    {savingAll ? 'progress_activity' : 'save'}
                  </span>
                  <span>{savingAll ? 'Đang lưu…' : `Lưu ${dirtyCount - missingDescCount} nhật ký`}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PROGRESS_PRESETS = [0, 25, 50, 75, 100];

const FIELD_CLS =
  'text-xs px-2 py-1.5 bg-surface border rounded-md focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary resize-none disabled:bg-surface-container disabled:cursor-not-allowed min-h-[34px] text-on-surface';

interface BadgeCfg {
  cls: string;
  icon: string;
  label: string;
}

/** Trạng thái quy trình — đúng 5 trạng thái của state machine. */
const FLOW_STATUS: Record<EmployeeTask['status'], BadgeCfg> = {
  pending: { cls: 'bg-surface-container-low text-secondary border-surface-container-high', icon: 'radio_button_unchecked', label: 'Chưa bắt đầu' },
  doing: { cls: 'bg-primary-fixed text-on-primary-fixed-variant border-primary-fixed-dim', icon: 'play_circle', label: 'Đang làm' },
  pending_approval: { cls: 'bg-warning-container text-on-warning-container border-warning-fixed', icon: 'hourglass_top', label: 'Chờ duyệt' },
  blocked: { cls: 'bg-error-container text-on-error-container border-error-fixed', icon: 'block', label: 'Đang vướng' },
  done: { cls: 'bg-tertiary-fixed/40 text-tertiary border-tertiary/30', icon: 'verified', label: 'Đã nghiệm thu' },
};

/** Trạng thái nhật ký hôm nay. Không hiện gì khi chưa ghi để bảng đỡ rối. */
const LOG_STATUS: Record<'has_blocker' | 'drafting' | 'submitted' | 'not_submitted', BadgeCfg | null> = {
  has_blocker: { cls: 'bg-error-container text-on-error-container border-error-fixed', icon: 'priority_high', label: 'Đã báo vướng mắc' },
  drafting: { cls: 'bg-warning-container text-on-warning-container border-warning-fixed', icon: 'edit', label: 'Chưa lưu' },
  submitted: { cls: 'bg-tertiary-fixed/40 text-tertiary border-tertiary/30', icon: 'check', label: 'Đã ghi nhật ký' },
  not_submitted: null,
};

const StatusBadge: React.FC<BadgeCfg> = ({ cls, icon, label }) => (
  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${cls}`}>
    <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px]">{icon}</span>
    {label}
  </span>
);

/** Nút hành động theo trạng thái — chỉ hiện bước mà nhân viên thực sự được phép làm. */
const TaskAction: React.FC<{
  task: EmployeeTask;
  /** Người làm cũng là người duyệt (TP phòng đó / admin) → bấm là Đã xong luôn. */
  selfClose: boolean;
  busy: boolean;
  disabled: boolean;
  onAdvance: () => void;
}> = ({
  task,
  selfClose,
  busy,
  disabled,
  onAdvance,
}) => {
  const base = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed';
  if (task.status === 'pending' || task.status === 'doing') {
    const start = task.status === 'pending';
    return (
      <button
        type="button"
        onClick={onAdvance}
        disabled={disabled}
        className={`${base} ${start ? 'bg-primary hover:bg-primary-container text-on-primary' : 'bg-tertiary hover:bg-tertiary-container text-on-tertiary'}`}
        title={
          start ? 'Chuyển sang Đang làm' : selfClose ? 'Đánh dấu Đã xong (bạn là người duyệt)' : 'Báo xong và gửi Trưởng phòng duyệt'
        }
      >
        <span aria-hidden="true" className="material-symbols-outlined [--icon-size:14px]">
          {busy ? 'progress_activity' : start ? 'play_arrow' : 'check_circle'}
        </span>
        {busy ? 'Đang gửi…' : start ? 'Bắt đầu' : selfClose ? 'Hoàn thành' : 'Báo xong'}
      </button>
    );
  }
  const note =
    task.status === 'pending_approval' ? 'Chờ TP duyệt' : task.status === 'blocked' ? 'Chờ TP gỡ vướng' : 'Hoàn tất';
  return <span className="text-xs font-semibold text-secondary">{note}</span>;
};

type Tone = 'primary' | 'success' | 'warning' | 'error' | 'neutral';

const TONE: Record<Tone, { icon: string; value: string }> = {
  primary: { icon: 'bg-surface-container-low text-primary', value: 'text-on-surface' },
  success: { icon: 'bg-tertiary-fixed/40 text-tertiary', value: 'text-tertiary' },
  warning: { icon: 'bg-warning-container text-warning', value: 'text-warning' },
  error: { icon: 'bg-error-container text-error', value: 'text-error' },
  neutral: { icon: 'bg-surface-container-low text-secondary', value: 'text-on-surface' },
};

const MetricCard: React.FC<{ label: string; icon: string; tone: Tone; value: number; unit: string; caption: string }> = ({
  label,
  icon,
  tone,
  value,
  unit,
  caption,
}) => (
  <div className="bg-white p-4 sm:p-5 rounded-xl border border-surface-container shadow-sm flex flex-col justify-between">
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-secondary uppercase tracking-wider">{label}</span>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONE[tone].icon}`}>
        <span aria-hidden="true" className="material-symbols-outlined [--icon-size:19px]">{icon}</span>
      </div>
    </div>
    <div className="mt-3 flex items-baseline gap-1.5">
      <span className={`text-display leading-none font-bold tabular-nums ${TONE[tone].value}`}>{value}</span>
      <span className="text-sm text-secondary">{unit}</span>
    </div>
    <div className="mt-2 text-xs text-secondary truncate" title={caption}>{caption}</div>
  </div>
);
