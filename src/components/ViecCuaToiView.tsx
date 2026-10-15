import React, { useState } from 'react';
import { EmployeeTask, ROLE_LABEL, User } from '../types';

interface ViecCuaToiViewProps {
  currentUser: User;
  tasks: EmployeeTask[];
  onToggleDone: (taskId: string) => void;
  onStartTask: (taskId: string) => void;
  /** Phase F: callback ghi daily_log 4 cột. Thay cho onUpdateDeliverable + onAddNote cũ. */
  onAddDailyLog: (taskId: string, description: string, result: string, obstacle: string, progress: number) => void;
  /** Phase F: callback ghi tasks.blocker_note (1 dòng). Thay cho onSendHelpRequest cũ. */
  onSetBlocker: (taskId: string, note: string) => void;
  onOpenNewPersonalTaskModal: () => void;
}

export const ViecCuaToiView: React.FC<ViecCuaToiViewProps> = ({
  currentUser,
  tasks,
  onToggleDone,
  onStartTask,
  onAddDailyLog,
  onSetBlocker,
  onOpenNewPersonalTaskModal,
}) => {
  const [filter, setFilter] = useState<'all' | 'today' | 'doing' | 'done'>('all');
  /** Phase F: chỉ giữ 1 modal "Điền nhật ký hôm nay" + 1 modal "Báo cáo vướng mắc". */
  const [logModalTaskId, setLogModalTaskId] = useState<string | null>(null);
  const [logDesc, setLogDesc] = useState('');
  const [logResult, setLogResult] = useState('');
  const [logObstacle, setLogObstacle] = useState('');
  const [logProgress, setLogProgress] = useState(0);
  const [blockerModalTaskId, setBlockerModalTaskId] = useState<string | null>(null);
  const [blockerText, setBlockerText] = useState('');

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

  /** Mở modal nhật ký với giá trị ban đầu = currentDeliverable / blockerNote nếu có. */
  const openLogModal = (task: EmployeeTask) => {
    setLogModalTaskId(task.id);
    setLogDesc(task.description || '');
    setLogResult(task.currentDeliverable || '');
    setLogObstacle(task.blockerNote || ''); // nếu NV đã ghi blocker, hiện sẵn
    setLogProgress(0);
  };

  const submitLog = () => {
    if (!logModalTaskId) return;
    if (!logDesc.trim() && !logResult.trim()) return;
    onAddDailyLog(logModalTaskId, logDesc.trim(), logResult.trim(), logObstacle.trim(), logProgress);
    setLogModalTaskId(null);
  };

  const openBlockerModal = (task: EmployeeTask) => {
    setBlockerModalTaskId(task.id);
    setBlockerText(task.blockerNote || '');
  };

  const submitBlocker = () => {
    if (!blockerModalTaskId) return;
    onSetBlocker(blockerModalTaskId, blockerText);
    setBlockerModalTaskId(null);
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

          {/* Cards List */}
          <div className="space-y-4">
            {filteredTasks.map((task) => {
              const isDone = task.status === 'done';
              const isDoing = task.status === 'doing';
              const isPending = task.status === 'pending';

              return (
                <div
                  key={task.id}
                  className={`bg-white rounded-xl p-5 sm:p-6 border transition-all shadow-sm hover:shadow flex flex-col gap-4 ${
                    isDone
                      ? 'border-emerald-200 bg-emerald-50/20'
                      : task.isToday
                      ? 'border-[#004ac6]/30'
                      : 'border-[#e5eeff]'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Task Code */}
                        <span className="px-1.5 py-0.5 rounded bg-[#eff4ff] text-[#434655] font-mono text-[11px] font-bold">
                          {task.code}
                        </span>

                        {/* Bundle context badge */}
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#eff4ff] text-[#004ac6] text-[11px] font-semibold">
                          <span className="material-symbols-outlined text-[13px]">
                            stars
                          </span>
                          Gói việc: {task.bundleName}
                        </span>

                        {/* Today Alert Badge */}
                        {task.isToday && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#ffdad6] text-[#ba1a1a] text-[11px] font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#ba1a1a] animate-pulse"></span>
                            {task.deadline}
                          </span>
                        )}

                        {!task.isToday && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#eff4ff] text-[#565e74] text-[11px] font-medium">
                            <span className="material-symbols-outlined text-[13px]">
                              event
                            </span>
                            {task.deadline}
                          </span>
                        )}
                      </div>

                      <h2
                        className={`text-[17px] font-bold mt-1 ${
                          isDone ? 'line-through text-[#737686]' : 'text-[#0b1c30]'
                        }`}
                      >
                        {task.title}
                      </h2>
                      <p className="text-[13px] text-[#434655] leading-relaxed">
                        {task.description}
                      </p>
                    </div>

                    {/* Manager Avatar info — chỉ hiển thị cho nhân viên. Trưởng phòng / BGĐ tự giao
                        cho mình thì label "Trưởng phòng giao" vô nghĩa. */}
                    {!isManager && (
                      <div className="flex items-center gap-2.5 shrink-0 self-start md:self-auto">
                        <div className="text-right hidden sm:block">
                          <span className="text-[11px] text-[#565e74] block">
                            Trưởng phòng giao:
                          </span>
                          <span className="text-[12px] font-bold text-[#0b1c30]">
                            {task.manager.name}
                          </span>
                        </div>
                        <img
                          alt="Manager"
                          className="w-9 h-9 rounded-full object-cover ring-1 ring-[#c3c6d7]"
                          src={task.manager.avatar}
                        />
                      </div>
                    )}
                  </div>

                  {/* Result Box — Phase F: chỉ hiển thị text, không inline edit.
                      Click "Điền nhật ký hôm nay" bên dưới để mở modal 4 cột. */}
                  <div className="bg-[#eff4ff] rounded-lg p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-[#dce9ff]">
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      <div className="w-7 h-7 rounded bg-[#dce9ff] flex items-center justify-center text-[#004ac6] shrink-0 mt-0.5 sm:mt-0">
                        <span className="material-symbols-outlined text-[18px]">
                          description
                        </span>
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[11px] font-semibold text-[#565e74]">
                          Kết quả bàn giao hôm nay:
                        </span>
                        <span className="text-[13px] text-[#0b1c30] font-medium leading-relaxed">
                          {task.currentDeliverable || (
                            <span className="text-[#737686] italic">Chưa có — bấm "Điền nhật ký" để ghi.</span>
                          )}
                        </span>
                        {task.blockerNote && (
                          <span className="text-[12px] text-[#ba1a1a] mt-1.5 flex items-start gap-1.5">
                            <span className="material-symbols-outlined text-[15px] mt-0.5">priority_high</span>
                            <span><strong>Vướng mắc:</strong> {task.blockerNote}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 text-[#565e74] text-[11px] bg-white px-2.5 py-1 rounded shadow-sm border border-[#e5eeff]">
                      <span className="material-symbols-outlined text-[13px]">
                        history
                      </span>
                      {task.lastUpdated}
                    </span>
                  </div>

                  {/* Actions Bar — Phase F: 3 nút chính.
                      1) Bắt đầu / Báo xong  2) Điền nhật ký hôm nay  3) Báo cáo vướng mắc (NV only) */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-1 border-t border-[#eff4ff]">
                    {isPending ? (
                      <button
                        onClick={() => onStartTask(task.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#004ac6] hover:bg-[#2563eb] text-white text-[13px] font-bold transition-all shadow-sm"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          play_arrow
                        </span>
                        <span>Bắt đầu làm</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onToggleDone(task.id)}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm ${
                          isDone
                            ? 'bg-[#85f8c4] text-[#002114] hover:bg-emerald-300'
                            : 'bg-[#006243] hover:bg-[#007d57] text-white'
                        }`}
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[19px]">
                          check_circle
                        </span>
                        <span>{isDone ? '✓ Đã xong việc' : '✓ Báo đã xong việc'}</span>
                      </button>
                    )}

                    <button
                      onClick={() => openLogModal(task)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#004ac6] hover:bg-[#2563eb] text-white text-[12px] font-bold transition-all shadow-sm"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        edit_note
                      </span>
                      <span>Điền nhật ký hôm nay</span>
                    </button>

                    {!isManager && (
                      <button
                        onClick={() => openBlockerModal(task)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white text-[#ba1a1a] hover:bg-red-50 border border-red-200 text-[12px] font-semibold transition-all shadow-sm"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[17px]">
                          priority_high
                        </span>
                        <span>{task.blockerNote ? 'Sửa vướng mắc' : 'Báo cáo vướng mắc'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Phase F: Quick Help & Escalation Box đã bỏ. Escalation giờ
            qua tasks.blocker_note (NV mở modal "Báo cáo vướng mắc" trên
            từng task). Modal nhật ký + modal blocker ở dưới. */}

        {/* Modal: Điền nhật ký hôm nay (4 cột text) */}
        {logModalTaskId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setLogModalTaskId(null)}
          >
            <div
              className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[18px] font-bold text-[#0b1c30] flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#004ac6]">edit_note</span>
                  Điền nhật ký hôm nay
                </h3>
                <button onClick={() => setLogModalTaskId(null)} className="text-[#737686] hover:text-[#0b1c30]">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-[12px] font-bold text-[#0b1c30]">
                  Mô tả công việc hôm nay:
                </label>
                <textarea
                  value={logDesc}
                  onChange={(e) => setLogDesc(e.target.value)}
                  rows={2}
                  className="text-[13px] px-3 py-2 bg-[#eff4ff] border border-[#dce9ff] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
                  placeholder="Bạn đã làm gì hôm nay?"
                />
                <label className="text-[12px] font-bold text-[#0b1c30]">
                  Kết quả đạt được:
                </label>
                <textarea
                  value={logResult}
                  onChange={(e) => setLogResult(e.target.value)}
                  rows={2}
                  className="text-[13px] px-3 py-2 bg-[#eff4ff] border border-[#dce9ff] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
                  placeholder="Hoàn thành phần nào? Sản phẩm gì?"
                />
                <label className="text-[12px] font-bold text-[#0b1c30]">
                  Vướng mắc (nếu có):
                </label>
                <textarea
                  value={logObstacle}
                  onChange={(e) => setLogObstacle(e.target.value)}
                  rows={2}
                  className="text-[13px] px-3 py-2 bg-[#eff4ff] border border-[#dce9ff] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
                  placeholder="Khó khăn gặp phải? Cần hỗ trợ gì?"
                />
                <label className="text-[12px] font-bold text-[#0b1c30]">
                  Tiến độ: {logProgress}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={logProgress}
                  onChange={(e) => setLogProgress(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setLogModalTaskId(null)}
                  className="px-4 py-2 rounded-lg bg-slate-200 text-[#0b1c30] text-[13px] font-semibold"
                >
                  Hủy
                </button>
                <button
                  onClick={submitLog}
                  className="px-4 py-2 rounded-lg bg-[#006243] hover:bg-[#007d57] text-white text-[13px] font-bold"
                >
                  Lưu nhật ký
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Báo cáo vướng mắc (1 dòng → tasks.blocker_note) */}
        {blockerModalTaskId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setBlockerModalTaskId(null)}
          >
            <div
              className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[18px] font-bold text-[#0b1c30] flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#ba1a1a]">priority_high</span>
                  Báo cáo vướng mắc
                </h3>
                <button onClick={() => setBlockerModalTaskId(null)} className="text-[#737686] hover:text-[#0b1c30]">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <p className="text-[12px] text-[#565e74] mb-3">
                Mô tả ngắn gọn vướng mắc của bạn. Trưởng phòng sẽ đọc khi mở task.
              </p>
              <textarea
                value={blockerText}
                onChange={(e) => setBlockerText(e.target.value)}
                rows={4}
                className="w-full text-[13px] px-3 py-2 bg-[#eff4ff] border border-[#dce9ff] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#ba1a1a]"
                placeholder="VD: Chờ sếp duyệt chi phí X, cần quyết định trong hôm nay..."
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setBlockerModalTaskId(null)}
                  className="px-4 py-2 rounded-lg bg-slate-200 text-[#0b1c30] text-[13px] font-semibold"
                >
                  Hủy
                </button>
                <button
                  onClick={submitBlocker}
                  className="px-4 py-2 rounded-lg bg-[#ba1a1a] hover:bg-red-700 text-white text-[13px] font-bold"
                >
                  Gửi Trưởng phòng
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
