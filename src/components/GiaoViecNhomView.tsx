import React, { useState } from 'react';
import { Avatar } from './ui/Brand';
import { TeamMember, TeamLeadTask } from '../types';
import { todayIso } from '../lib/transforms';

interface GiaoViecNhomViewProps {
  teamMembers: TeamMember[];
  tasks: TeamLeadTask[];
  /** Resolve sau khi server trả lời — nút bị khoá trong lúc chờ để không gửi trùng. */
  onApproveTask: (taskId: string) => Promise<boolean>;
  onOpenNewTaskModal: () => void;
  onOpenNewBundleModal: () => void;
}

export const GiaoViecNhomView: React.FC<GiaoViecNhomViewProps> = ({
  teamMembers,
  tasks,
  onApproveTask,
  onOpenNewTaskModal,
  onOpenNewBundleModal,
}) => {
  // Escalation qua tasks.blocker_note (manager xem khi mở task — DetailsDrawer).
  const [filter, setFilter] = useState<'all' | 'pending' | 'need_help' | 'done'>('pending');
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const approve = async (taskId: string) => {
    if (approvingId) return;
    setApprovingId(taskId);
    try {
      await onApproveTask(taskId);
    } finally {
      setApprovingId(null);
    }
  };

  // Filtered task list
  const filteredTasks = tasks.filter((t) => {
    // Filter theo ownerUsername (key ổn định) thay vì ownerName (string display)
    // — tránh nhầm khi 2 người trùng tên hiển thị. Fallback so sánh tên nếu
    // seed data chưa có username.
    if (
      memberFilter &&
      t.ownerUsername !== memberFilter &&
      t.ownerName !== memberFilter
    ) return false;

    if (filter === 'all') return true;
    if (filter === 'pending') return t.status === 'pending_approval';
    if (filter === 'need_help') return t.status === 'need_help';
    if (filter === 'done') return t.status === 'done';
    return true;
  });

  const pendingCount = tasks.filter((t) => t.status === 'pending_approval').length;
  const helpCount = tasks.filter((t) => t.status === 'need_help').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  const today = todayIso();
  const isOverdue = (t: TeamLeadTask) =>
    (t.status === 'in_progress' || t.status === 'need_help') && !!t.deadline && t.deadline < today;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const overdueCount = tasks.filter(isOverdue).length;

  /** Số liệu từng thành viên tính từ chính danh sách việc — không dùng câu chữ dựng sẵn ở backend. */
  const statsFor = (username?: string) => {
    const mine = tasks.filter((t) => t.ownerUsername === username);
    return {
      open: mine.filter((t) => t.status === 'in_progress' || t.status === 'need_help').length,
      blocked: mine.filter((t) => t.status === 'need_help').length,
      overdue: mine.filter(isOverdue).length,
      awaiting: mine.filter((t) => t.status === 'pending_approval').length,
    };
  };
  // First member who needs help
  const helpMember = teamMembers.find((m) => m.needHelp);
  const helpMemberNote = helpMember?.urgentNote
    ? `${helpMember.name}: ${helpMember.urgentNote}`
    : helpMember
    ? `${helpMember.name} đang cần hỗ trợ`
    : 'Không có ai cần hỗ trợ';

  return (
    <div className="flex flex-col w-full">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-xl border border-surface-container shadow-sm">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">
              Giao việc & Theo dõi nhóm
            </h1>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0">
            <button
              onClick={onOpenNewBundleModal}
              className="px-3.5 py-2 bg-surface-container-low hover:bg-surface-container-high text-on-surface text-sm font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px] text-primary">
                folder_copy
              </span>
              <span>Tạo nhóm việc / Đợt việc</span>
            </button>
            <button
              onClick={onOpenNewTaskModal}
              className="px-4 py-2 bg-primary hover:bg-primary-container text-white text-sm font-semibold rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                add_task
              </span>
              <span>Giao việc mới cho nhân viên</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Metric Cards — tính động từ props */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-surface-container shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-secondary">
                Tổng việc nhóm quản lý
              </span>
              <div className="w-8 h-8 rounded-lg bg-surface-container-low flex items-center justify-center text-primary">
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:19px]">
                  fact_check
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-display font-bold text-on-surface leading-none tabular-nums">
                {tasks.length}
              </div>
              <p className="text-xs text-secondary mt-1.5">
                Chia cho {teamMembers.length} thành viên
              </p>
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-surface-container shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${overdueCount > 0 ? 'text-error' : 'text-tertiary'}`}>
                Đang thực hiện
              </span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${overdueCount > 0 ? 'bg-error-container text-error' : 'bg-tertiary-fixed/40 text-tertiary'}`}>
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:19px]">
                  {overdueCount > 0 ? 'schedule' : 'play_circle'}
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-display font-bold text-on-surface leading-none tabular-nums">
                {inProgressCount}
              </div>
              <p className={`text-xs mt-1.5 ${overdueCount > 0 ? 'text-error font-semibold' : 'text-secondary'}`}>
                {overdueCount > 0 ? `${overdueCount} việc đã quá hạn chót` : 'Không có việc nào quá hạn'}
              </p>
            </div>
          </div>

          {/* Card 3 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-surface-container shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-secondary">
                Đã nghiệm thu
              </span>
              <div className="w-8 h-8 rounded-lg bg-surface-container-low text-primary flex items-center justify-center">
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:19px]">
                  task_alt
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-display font-bold text-on-surface leading-none tabular-nums">
                {doneCount}
              </div>
              <p className="text-xs text-secondary mt-1.5">
                Đã duyệt nghiệm thu hoàn tất
              </p>
            </div>
          </div>

          {/* Card 4 - Urgent Blocker Card */}
          <div
            className={`p-4 sm:p-5 rounded-xl border shadow-sm flex flex-col justify-between ${
              helpCount > 0
                ? 'bg-error-container/40 border-error-container'
                : 'bg-tertiary-fixed/20 border-tertiary-fixed-dim'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-bold flex items-center gap-1.5 ${
                  helpCount > 0 ? 'text-error' : 'text-tertiary'
                }`}
              >
                {helpCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-error animate-pulse"></span>
                )}
                {helpCount > 0 ? 'Cần Trưởng phòng hỗ trợ' : 'Nhóm ổn định'}
              </span>
              <div
                className={`w-8 h-8 rounded-lg text-white flex items-center justify-center ${
                  helpCount > 0 ? 'bg-error' : 'bg-tertiary'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:19px]">
                  {helpCount > 0 ? 'support' : 'check_circle'}
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div
                className={`text-display font-bold leading-none tabular-nums ${
                  helpCount > 0 ? 'text-error' : 'text-tertiary'
                }`}
              >
                {helpCount}
              </div>
              <p
                className={`text-xs mt-1.5 font-semibold ${
                  helpCount > 0 ? 'text-on-error-container' : 'text-tertiary'
                }`}
              >
                {helpMemberNote}
              </p>
            </div>
          </div>
        </div>

        {/* Section 1: Team Member Workload Allocation */}
        <div className="bg-white p-5 sm:p-6 rounded-xl border border-surface-container shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-surface-container-low text-primary flex items-center justify-center">
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">
                  badge
                </span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-on-surface">
                  Tình hình công việc của từng thành viên
                </h2>
                <p className="text-xs text-secondary">
                  Xem ngay ai đang thong thả, ai đang quá tải để điều phối việc chuẩn xác
                </p>
              </div>
            </div>
            {memberFilter ? (
              <button type="button"
                onClick={() => setMemberFilter(null)}
                className="px-2.5 py-1 bg-surface-container-low text-primary text-xs font-semibold rounded hover:bg-surface-container-high"
              >
                {/* Hiển thị TÊN thay vì raw value. memberFilter có thể là username ("nv_an"). */}
                Đang lọc:{' '}
                {teamMembers.find((m) => m.username === memberFilter)?.name ??
                  teamMembers.find((m) => m.name === memberFilter)?.name ??
                  memberFilter}
              </button>
            ) : (
              <span className="px-2.5 py-1 bg-surface-container-low text-on-surface-variant text-xs font-medium rounded-lg">
                {teamMembers.length} thành viên sẵn sàng
              </span>
            )}
          </div>

          {/* Members Grid Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
            {teamMembers.map((member) => {
              const isSelected = memberFilter === (member.username ?? member.name);
              const stats = statsFor(member.username);
              const isWarning = stats.blocked > 0;

              return (
                <div
                  key={member.id}
                  className={`p-4 rounded-xl flex flex-col justify-between gap-3 transition-all border ${
                    isSelected
                      ? 'ring-2 ring-primary border-transparent'
                      : isWarning
                      ? 'bg-error-container/25 border-error-fixed'
                      : 'bg-surface-container-low/60 border-surface-container hover:bg-surface-container-low'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar name={member.name} src={member.avatar} className="w-10 h-10 text-sm shadow-sm" />
                      {isWarning && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-error rounded-full ring-2 ring-white flex items-center justify-center">
                          <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-on-surface truncate">
                        {member.name}
                      </div>
                      <div className="text-xs text-secondary truncate">
                        {member.role}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-on-surface font-medium">
                        {stats.open} việc chưa xong
                      </span>
                      {isWarning ? (
                        <span className="text-error font-bold flex items-center gap-1">
                          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px]">
                            help
                          </span>
                          {stats.blocked} việc cần hỗ trợ
                        </span>
                      ) : (
                        <span className={`font-semibold flex items-center gap-1 ${stats.overdue > 0 ? 'text-error' : 'text-tertiary'}`}>
                          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px]">
                            {stats.overdue > 0 ? 'schedule' : 'check_circle'}
                          </span>
                          {stats.overdue > 0
                            ? `${stats.overdue} quá hạn`
                            : stats.awaiting > 0
                              ? `${stats.awaiting} chờ duyệt`
                              : 'Không quá hạn'}
                        </span>
                      )}
                    </div>

                    {isWarning && member.urgentNote ? (
                      <div className="text-xs leading-tight text-on-error-container bg-error-container/80 p-1.5 rounded font-medium">
                        {member.urgentNote}
                      </div>
                    ) : (
                      <div className="w-full bg-surface-container-highest rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-tertiary h-1.5 rounded-full"
                          style={{ width: `${member.workloadPercent}%` }}
                        ></div>
                      </div>
                    )}
                  </div>

                  {isWarning ? (
                    <button
                      onClick={() => {
                        setFilter('need_help');
                        setMemberFilter(member.username ?? member.name);
                      }}
                      className="w-full py-1.5 px-3 bg-error hover:bg-on-error-container text-white rounded-lg text-xs font-bold text-center transition-all shadow-sm flex items-center justify-center gap-1"
                      type="button"
                    >
                      <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">
                        support
                      </span>
                      <span>Giúp ngay</span>
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setMemberFilter(isSelected ? null : (member.username ?? member.name))
                      }
                      className="w-full py-1.5 px-3 bg-white text-on-surface hover:bg-surface-container-high rounded-lg text-xs font-semibold text-center transition-all shadow-sm border border-surface-container"
                      type="button"
                    >
                      {isSelected ? 'Đang xem việc' : `Xem việc ${member.name.split(' ').pop()} (${member.activeTasks})`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 2: Actionable Task Coordination Table for Team Leader */}
        <div className="bg-white p-5 sm:p-6 rounded-xl border border-surface-container shadow-sm flex flex-col gap-5">
          {/* Table Header & Filter Tabs */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-on-surface">
                Việc cần Trưởng phòng duyệt & Điều phối
              </h2>
              <p className="text-xs text-secondary">
                Các đầu việc cần bạn bấm nút kiểm tra, tháo gỡ vướng mắc hoặc nghiệm thu
              </p>
            </div>

            {/* Filter Segmented Tabs */}
            <div className="inline-flex p-1 bg-surface-container-low rounded-xl gap-1 self-start md:self-auto overflow-x-auto no-scrollbar max-w-full">
              <button
                onClick={() => setFilter('all')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  filter === 'all'
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-secondary hover:text-on-surface'
                }`}
                type="button"
              >
                Tất cả việc nhóm ({tasks.length})
              </button>
              <button
                onClick={() => setFilter('pending')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  filter === 'pending'
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-secondary hover:text-on-surface'
                }`}
                type="button"
              >
                <span>Chờ tôi duyệt kết quả</span>
                <span className="w-4 h-4 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold">
                  {pendingCount}
                </span>
              </button>
              <button
                onClick={() => setFilter('need_help')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  filter === 'need_help'
                    ? 'bg-white text-error shadow-sm'
                    : 'text-error hover:bg-error-container/40'
                }`}
                type="button"
              >
                <span>Cần tôi hỗ trợ</span>
                <span className="w-4 h-4 rounded-full bg-error text-white text-xs flex items-center justify-center font-bold">
                  {helpCount}
                </span>
              </button>
              <button
                onClick={() => setFilter('done')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  filter === 'done'
                    ? 'bg-white text-tertiary shadow-sm'
                    : 'text-secondary hover:text-on-surface'
                }`}
                type="button"
              >
                Đã xong ({doneCount})
              </button>
            </div>
          </div>

          {/* High Clarity Task Cards List */}
          <div className="flex flex-col gap-3">
            {filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-secondary bg-surface-container-low/40 rounded-xl">
                Không có việc nào trong mục này.
              </div>
            ) : (
              filteredTasks.map((task) => {
                const isPending = task.status === 'pending_approval';
                const isNeedHelp = task.status === 'need_help';
                const isDone = task.status === 'done';

                return (
                  <div
                    key={task.id}
                    className={`p-4 sm:p-5 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all ${
                      isNeedHelp
                        ? 'bg-error-container/25 border-error-fixed hover:bg-error-container/40'
                        : isDone
                        ? 'bg-tertiary-fixed/20 border-tertiary-fixed-dim'
                        : 'bg-surface-container-low/50 border-surface-container hover:bg-surface-container-low'
                    }`}
                  >
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      {/* Status Tag */}
                      {isPending && (
                        <span className="px-2 py-0.5 bg-primary text-white text-xs font-bold rounded uppercase whitespace-nowrap mt-0.5">
                          Chờ duyệt kết quả
                        </span>
                      )}
                      {isNeedHelp && (
                        <span className="px-2 py-0.5 bg-error text-white text-xs font-bold rounded uppercase whitespace-nowrap mt-0.5 flex items-center gap-1">
                          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:12px]">
                            warning
                          </span>
                          Cần hỗ trợ gấp
                        </span>
                      )}
                      {isDone && (
                        <span className="px-2 py-0.5 bg-tertiary text-white text-xs font-bold rounded uppercase whitespace-nowrap mt-0.5 flex items-center gap-1">
                          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:12px]">
                            check
                          </span>
                          Đã nghiệm thu
                        </span>
                      )}
                      {!isPending && !isNeedHelp && !isDone && (
                        <span className="px-2 py-0.5 bg-surface-container text-on-surface-variant text-xs font-bold rounded uppercase whitespace-nowrap mt-0.5">
                          Đang làm
                        </span>
                      )}

                      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                        <div className="text-base font-bold text-on-surface flex items-center gap-2 flex-wrap">
                          <span>{task.title}</span>
                          <span className="text-xs font-semibold text-secondary bg-surface-container px-2 py-0.5 rounded">
                            {task.category}
                          </span>
                        </div>

                        {/* Blocker Note — Manager đọc "Vướng mắc" tại đây mà không cần mở task. */}
                        {task.blockerNote ? (
                          <div className="p-2.5 bg-white rounded-lg border border-error-fixed text-sm text-on-surface flex items-start gap-2 shadow-sm">
                            <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px] text-error shrink-0 mt-0.5">
                              priority_high
                            </span>
                            <span>
                              <strong>Vướng mắc:</strong> “
                              {task.blockerNote}”
                            </span>
                          </div>
                        ) : null}

                        {/* Metadata row */}
                        <div className="flex items-center gap-3 text-xs text-secondary mt-0.5 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <Avatar name={task.ownerName} src={task.ownerAvatar} className="w-5 h-5 text-xs" />
                            <span>
                              Người làm: <strong>{task.ownerName}</strong>
                            </span>
                          </div>
                          <span>•</span>
                          <span
                            className={
                              isNeedHelp ? 'text-error font-semibold' : ''
                            }
                          >
                            {task.submittedAt}
                          </span>
                          {task.deadline && (
                            <>
                              <span>•</span>
                              <span>Hạn chót: <strong>{task.deadline}</strong></span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions — Manager escalation qua tasks.blocker_note (xem khi mở task). */}
                    <div className="flex items-center gap-2 self-end lg:self-center shrink-0">
                      {isPending && (
                        <button
                          onClick={() => approve(task.id)}
                          disabled={approvingId !== null}
                          className="px-3.5 py-1.5 bg-tertiary text-on-tertiary hover:bg-tertiary-container rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          type="button"
                        >
                          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">
                            {approvingId === task.id ? 'progress_activity' : 'check'}
                          </span>
                          <span>{approvingId === task.id ? 'Đang duyệt…' : 'Duyệt đạt'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
