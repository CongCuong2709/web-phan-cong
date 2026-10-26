import React, { useMemo, useState } from 'react';
import { Avatar } from './ui/Brand';
import {
  Dialog,
  compactInputCls,
  ghostButtonCls,
  inputCls,
  labelCls,
  primaryButtonCls,
  smallOutlineButtonCls,
  smallPrimaryButtonCls,
  textareaCls,
} from './ui/Dialog';
import { TeamMember, TeamLeadTask } from '../types';
import { todayIso } from '../lib/transforms';

export interface Assignee {
  id: string;
  username: string;
  fullname: string;
}

interface GiaoViecNhomViewProps {
  teamMembers: TeamMember[];
  tasks: TeamLeadTask[];
  /** Người có thể nhận việc (dùng khi đổi người làm). */
  assignees: Assignee[];
  /** Các thao tác resolve true khi server đã lưu. */
  onApproveTask: (taskId: string) => Promise<boolean>;
  onReturnTask: (taskId: string, reason: string) => Promise<boolean>;
  onUnblockTask: (taskId: string, note: string) => Promise<boolean>;
  onAdjustTask: (taskId: string, changes: { ownerUserId?: string; endDate?: string }) => Promise<boolean>;
  onOpenTask: (taskId: string) => void;
  onAssignTask: () => void;
  /** Bộ lọc trạng thái + người làm lưu trên URL (?loc=open&nv=hong). */
  filter?: string;
  onFilterChange: (filter: StatusFilter) => void;
  memberFilter: string | null;
  onMemberFilterChange: (username: string | null) => void;
}

const STATUS_FILTERS = [
  ['open', 'Đang mở'],
  ['all', 'Tất cả'],
  ['not_started', 'Chưa bắt đầu'],
  ['in_progress', 'Đang làm'],
  ['need_help', 'Có vướng mắc'],
  ['pending_approval', 'Chờ duyệt'],
  ['done', 'Đã nghiệm thu'],
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number][0];

const STATUS_META: Record<TeamLeadTask['status'], { label: string; dot: string }> = {
  not_started: { label: 'Chưa bắt đầu', dot: 'bg-outline' },
  in_progress: { label: 'Đang làm', dot: 'bg-primary' },
  need_help: { label: 'Đang vướng', dot: 'bg-error' },
  pending_approval: { label: 'Chờ duyệt', dot: 'bg-warning-fixed' },
  done: { label: 'Đã nghiệm thu', dot: 'bg-tertiary' },
};

/** Thứ tự khi sắp xếp theo trạng thái: việc cần chú ý lên trước. */
const STATUS_ORDER: Record<TeamLeadTask['status'], number> = {
  need_help: 0, pending_approval: 1, in_progress: 2, not_started: 3, done: 4,
};

type SortKey = 'deadline' | 'owner' | 'status' | 'progress';

/** "2026-10-25" hoặc "2026-10-25 08:32:56" → "25/10". */
function ddmm(s?: string): string {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  return m ? `${m[3]}/${m[2]}` : '—';
}

function daysBetween(fromIso: string, toIso: string): number {
  const [a, b] = [fromIso, toIso].map((s) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86400000);
}

const isOpen = (t: TeamLeadTask) => t.status !== 'done' && t.status !== 'pending_approval';

type Action = { kind: 'return' | 'unblock' | 'adjust'; task: TeamLeadTask };

export const GiaoViecNhomView: React.FC<GiaoViecNhomViewProps> = ({
  teamMembers,
  tasks,
  assignees,
  onApproveTask,
  onReturnTask,
  onUnblockTask,
  onAdjustTask,
  onOpenTask,
  onAssignTask,
  filter: filterParam,
  onFilterChange,
  memberFilter,
  onMemberFilterChange,
}) => {
  const today = todayIso();
  const statusFilter: StatusFilter = STATUS_FILTERS.find(([k]) => k === filterParam)?.[0] ?? 'open';
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'deadline', dir: 1 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);

  const isOverdue = (t: TeamLeadTask) => isOpen(t) && !!t.deadline && t.deadline < today;

  /** Việc cần trưởng phòng ra quyết định — mỗi việc chỉ xuất hiện 1 lần, theo lý do quan trọng nhất. */
  const inbox = useMemo(() => {
    const rows: { task: TeamLeadTask; reason: 'help' | 'approve' | 'overdue' }[] = [];
    for (const t of tasks) {
      if (t.status === 'done') continue;
      if (t.needsHelp) rows.push({ task: t, reason: 'help' });
      else if (t.status === 'pending_approval') rows.push({ task: t, reason: 'approve' });
      else if (isOverdue(t)) rows.push({ task: t, reason: 'overdue' });
    }
    const rank = { help: 0, approve: 1, overdue: 2 };
    return rows.sort((a, b) => rank[a.reason] - rank[b.reason] || (a.task.deadline ?? '').localeCompare(b.task.deadline ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, today]);

  const counts = {
    open: tasks.filter(isOpen).length,
    overdue: tasks.filter(isOverdue).length,
    approve: tasks.filter((t) => t.status === 'pending_approval').length,
    help: tasks.filter((t) => t.needsHelp).length,
  };

  const memberOptions = useMemo(
    () =>
      teamMembers
        .filter((m) => m.username)
        .map((m) => ({
          username: m.username!,
          name: m.name,
          open: tasks.filter((t) => t.ownerUsername === m.username && isOpen(t)).length,
          overdue: tasks.filter((t) => t.ownerUsername === m.username && isOverdue(t)).length,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamMembers, tasks, today],
  );

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = tasks.filter((t) => {
      if (memberFilter && t.ownerUsername !== memberFilter) return false;
      if (q && !`${t.code} ${t.title} ${t.category} ${t.ownerName}`.toLowerCase().includes(q)) return false;
      switch (statusFilter) {
        case 'open': return isOpen(t);
        case 'all': return true;
        case 'need_help': return t.needsHelp;
        default: return t.status === statusFilter;
      }
    });
    const val = (t: TeamLeadTask): string | number =>
      sort.key === 'deadline' ? t.deadline ?? '9999'
        : sort.key === 'owner' ? t.ownerName
          : sort.key === 'status' ? STATUS_ORDER[t.status]
            : t.progress;
    return rows.sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.code.localeCompare(b.code);
    });
  }, [tasks, memberFilter, search, statusFilter, sort]);

  const run = async (taskId: string, fn: () => Promise<boolean>) => {
    if (busyId) return false;
    setBusyId(taskId);
    try {
      return await fn();
    } finally {
      setBusyId(null);
    }
  };

  const sortHeader = (key: SortKey, label: string, className = '') => (
    <th
      scope="col"
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-2 font-semibold ${className}`}
    >
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
        className="inline-flex items-center gap-0.5 hover:text-on-surface"
      >
        {label}
        <span aria-hidden="true" className="material-symbols-outlined [--icon-size:14px]">
          {sort.key !== key ? 'unfold_more' : sort.dir === 1 ? 'arrow_upward' : 'arrow_downward'}
        </span>
      </button>
    </th>
  );

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Giao việc nhóm</h1>
          <p className="text-sm text-secondary mt-1">
            {counts.open} việc đang mở
            <span className={counts.overdue ? 'text-error font-semibold' : ''}> · {counts.overdue} quá hạn</span>
            {' · '}{counts.approve} chờ duyệt
            <span className={counts.help ? 'text-error font-semibold' : ''}> · {counts.help} có vướng mắc</span>
          </p>
        </div>
        <button type="button" onClick={onAssignTask} className={primaryButtonCls}>
          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">add</span>
          Giao việc
        </button>
      </div>

      {/* Hộp việc cần xử lý */}
      <section aria-labelledby="inbox-title" className="bg-white rounded-xl border border-surface-container">
        <h2 id="inbox-title" className="px-4 py-3 text-base font-semibold text-on-surface border-b border-surface-container">
          Cần bạn xử lý <span className="text-secondary font-normal">({inbox.length})</span>
        </h2>
        {inbox.length === 0 ? (
          <p className="px-4 py-6 text-sm text-secondary">Không có việc nào cần bạn duyệt, gỡ vướng hay xử lý quá hạn.</p>
        ) : (
          <ul className="divide-y divide-surface-container">
            {inbox.map(({ task, reason }) => {
              const busy = busyId === task.id;
              return (
                <li key={task.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
                  <span
                    className={`shrink-0 w-24 text-xs font-semibold ${reason === 'approve' ? 'text-warning' : 'text-error'}`}
                  >
                    {reason === 'help' ? 'Vướng mắc' : reason === 'approve' ? 'Chờ duyệt' : 'Quá hạn'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpenTask(task.id)}
                      className="text-sm font-semibold text-on-surface hover:text-primary hover:underline text-left"
                    >
                      <span className="font-mono text-xs text-secondary mr-2">{task.code}</span>
                      {task.title}
                    </button>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-secondary flex-wrap">
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar name={task.ownerName} src={task.ownerAvatar} className="w-5 h-5 text-xs" />
                        {task.ownerName}
                      </span>
                      <span aria-hidden="true">·</span>
                      {reason === 'help' ? (
                        <span className="text-on-surface">“{task.blockerNote || 'Đang bị chặn, chưa ghi lý do'}”</span>
                      ) : reason === 'approve' ? (
                        <span>Báo xong {ddmm(task.updatedAt)} · hạn {ddmm(task.deadline)}</span>
                      ) : (
                        <span className="text-error">
                          Hạn {ddmm(task.deadline)} · trễ {daysBetween(task.deadline!, today)} ngày · tiến độ {task.progress}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {reason === 'approve' && (
                      <>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => setAction({ kind: 'return', task })}
                          className={smallOutlineButtonCls}
                        >
                          Trả về
                        </button>
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => run(task.id, () => onApproveTask(task.id))}
                          className={smallPrimaryButtonCls}
                        >
                          {busy ? 'Đang duyệt…' : 'Duyệt'}
                        </button>
                      </>
                    )}
                    {reason === 'help' && (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => setAction({ kind: 'unblock', task })}
                        className={smallPrimaryButtonCls}
                      >
                        Gỡ vướng
                      </button>
                    )}
                    {reason === 'overdue' && (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => setAction({ kind: 'adjust', task })}
                        className={smallPrimaryButtonCls}
                      >
                        Dời hạn / Đổi người
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Bảng toàn bộ việc nhóm */}
      <section aria-labelledby="all-title" className="bg-white rounded-xl border border-surface-container">
        <div className="px-4 py-3 border-b border-surface-container flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <h2 id="all-title" className="text-base font-semibold text-on-surface">
            Việc của nhóm <span className="text-secondary font-normal">({tableRows.length})</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã, tên việc, người làm…"
              aria-label="Tìm việc"
              className={`${compactInputCls} w-56`}
            />
            <select
              value={memberFilter ?? ''}
              onChange={(e) => onMemberFilterChange(e.target.value || null)}
              aria-label="Lọc theo người làm"
              className={compactInputCls}
            >
              <option value="">Mọi người</option>
              {memberOptions.map((m) => (
                <option key={m.username} value={m.username}>
                  {m.name} — {m.open} mở{m.overdue ? `, ${m.overdue} quá hạn` : ''}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => onFilterChange(e.target.value as StatusFilter)}
              aria-label="Lọc theo trạng thái"
              className={compactInputCls}
            >
              {STATUS_FILTERS.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-xs text-secondary text-left bg-surface">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold w-24">Mã</th>
                <th scope="col" className="px-3 py-2 font-semibold">Công việc</th>
                {sortHeader('owner', 'Người làm', 'w-48')}
                {sortHeader('deadline', 'Hạn', 'w-32')}
                {sortHeader('status', 'Trạng thái', 'w-40')}
                {sortHeader('progress', 'Tiến độ', 'w-32')}
                <th scope="col" className="px-3 py-2 w-12"><span className="sr-only">Thao tác</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-secondary">
                    {tasks.length === 0 ? 'Nhóm chưa có việc nào.' : 'Không có việc nào khớp bộ lọc.'}
                  </td>
                </tr>
              ) : (
                tableRows.map((t) => {
                  const overdue = isOverdue(t);
                  const meta = STATUS_META[t.status];
                  return (
                    <tr
                      key={t.id}
                      tabIndex={0}
                      onClick={() => onOpenTask(t.id)}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onOpenTask(t.id);
                        }
                      }}
                      aria-label={`${t.code} ${t.title}, ${t.ownerName}. Nhấn Enter để xem chi tiết`}
                      className="hover:bg-surface cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-secondary">{t.code}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-on-surface">{t.title}</div>
                        {t.category && <div className="text-xs text-secondary">{t.category}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={t.ownerName} src={t.ownerAvatar} className="w-6 h-6 text-xs" />
                          <span className="truncate">{t.ownerName}</span>
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 tabular-nums ${overdue ? 'text-error font-semibold' : 'text-on-surface'}`}>
                        {ddmm(t.deadline)}
                        {overdue && <span className="block text-xs font-normal">trễ {daysBetween(t.deadline!, today)} ngày</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden="true" className={`w-2 h-2 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                        {t.needsHelp && t.status !== 'need_help' && (
                          <span className="block text-xs text-error">Có vướng mắc</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="flex-1 h-1.5 rounded-full bg-surface-container overflow-hidden">
                            <span className="block h-full bg-primary" style={{ width: `${t.progress}%` }} />
                          </span>
                          <span className="text-xs tabular-nums w-9 text-right">{t.progress}%</span>
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {t.status !== 'done' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAction({ kind: 'adjust', task: t });
                            }}
                            aria-label={`Dời hạn hoặc đổi người làm: ${t.title}`}
                            title="Dời hạn / Đổi người làm"
                            className="w-8 h-8 rounded-md inline-flex items-center justify-center text-secondary hover:bg-surface-container-low hover:text-on-surface"
                          >
                            <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">edit_calendar</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ActionDialog
        action={action}
        assignees={assignees}
        onClose={() => setAction(null)}
        onSubmit={async (a, input) => {
          const ok = await run(a.task.id, () =>
            a.kind === 'return'
              ? onReturnTask(a.task.id, input.text)
              : a.kind === 'unblock'
                ? onUnblockTask(a.task.id, input.text)
                : onAdjustTask(a.task.id, { ownerUserId: input.ownerUserId, endDate: input.endDate }),
          );
          if (ok) setAction(null);
        }}
        busy={busyId !== null}
      />
    </div>
  );
};

interface ActionInput {
  text: string;
  ownerUserId?: string;
  endDate?: string;
}

/** Hộp thoại cho Trả về / Gỡ vướng / Dời hạn – đổi người. Mở lại với việc khác thì form bắt đầu mới. */
const ActionDialog: React.FC<{
  action: Action | null;
  assignees: Assignee[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (action: Action, input: ActionInput) => void;
}> = ({ action, assignees, busy, onClose, onSubmit }) => {
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('');
  const [endDate, setEndDate] = useState('');
  const key = action ? `${action.kind}:${action.task.id}` : '';
  const [lastKey, setLastKey] = useState('');
  if (key !== lastKey) {
    setLastKey(key);
    setText('');
    setOwner(assignees.find((a) => a.username === action?.task.ownerUsername)?.id ?? '');
    setEndDate(action?.task.deadline?.slice(0, 10) ?? '');
  }
  if (!action) return null;
  const { kind, task } = action;
  const title = kind === 'return' ? 'Trả về để làm lại' : kind === 'unblock' ? 'Gỡ vướng mắc' : 'Dời hạn / Đổi người làm';
  const currentOwnerId = assignees.find((a) => a.username === task.ownerUsername)?.id ?? '';
  const unchanged = kind === 'adjust' && owner === currentOwnerId && endDate === (task.deadline?.slice(0, 10) ?? '');

  return (
    <Dialog isOpen onClose={onClose} title={title} dismissible={!busy}>
      <form
        className="p-5 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (unchanged) return;
          onSubmit(action, {
            text: text.trim(),
            ownerUserId: kind === 'adjust' && owner !== currentOwnerId ? owner : undefined,
            endDate: kind === 'adjust' && endDate !== task.deadline?.slice(0, 10) ? endDate : undefined,
          });
        }}
      >
        <div className="text-sm">
          <span className="font-mono text-xs text-secondary mr-2">{task.code}</span>
          <span className="font-semibold text-on-surface">{task.title}</span>
          <div className="text-xs text-secondary mt-0.5">Người làm: {task.ownerName}</div>
        </div>

        {kind === 'unblock' && (
          <blockquote className="text-sm border-l-2 border-error pl-3 text-on-surface">
            {task.blockerNote || 'Nhân viên chưa ghi nội dung vướng mắc.'}
          </blockquote>
        )}

        {kind === 'adjust' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Người làm</span>
              <select data-autofocus value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls}>
                {!currentOwnerId && <option value="">{task.ownerName}</option>}
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>{a.fullname}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Hạn chót</span>
              <input type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
            </label>
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>
              {kind === 'return' ? 'Lý do / cần sửa gì (không bắt buộc)' : 'Hướng xử lý (không bắt buộc)'}
            </span>
            <textarea
              data-autofocus
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'return' ? 'Ví dụ: Bổ sung bảng khối lượng trước khi nộp lại' : 'Ví dụ: Đã liên hệ nhà cung cấp, nhận báo giá thứ Năm'}
              className={textareaCls}
            />
            <span className="text-xs text-secondary">Ghi vào lịch sử việc để nhân viên xem lại.</span>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-surface-container-low">
          <button type="button" onClick={onClose} disabled={busy} className={ghostButtonCls}>
            Huỷ
          </button>
          <button type="submit" disabled={busy || unchanged} className={primaryButtonCls}>
            {busy ? 'Đang lưu…' : kind === 'return' ? 'Trả về' : kind === 'unblock' ? 'Đã gỡ vướng' : 'Lưu thay đổi'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
