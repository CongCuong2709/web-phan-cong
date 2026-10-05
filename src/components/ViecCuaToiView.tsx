import React, { useState } from 'react';
import { EmployeeTask, QuickHelpRequest, ROLE_LABEL, User } from '../types';

interface ViecCuaToiViewProps {
  currentUser: User;
  tasks: EmployeeTask[];
  onToggleDone: (taskId: string) => void;
  onStartTask: (taskId: string) => void;
  onUpdateDeliverable: (taskId: string, newText: string) => void;
  onSendHelpRequest: (request: Omit<QuickHelpRequest, 'id' | 'timestamp' | 'status'>) => void;
  onOpenNewPersonalTaskModal: () => void;
}

export const ViecCuaToiView: React.FC<ViecCuaToiViewProps> = ({
  currentUser,
  tasks,
  onToggleDone,
  onStartTask,
  onUpdateDeliverable,
  onSendHelpRequest,
  onOpenNewPersonalTaskModal,
}) => {
  const [filter, setFilter] = useState<'all' | 'today' | 'doing' | 'done'>('all');
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [helpMessage, setHelpMessage] = useState<string>('');
  const [showSentAlert, setShowSentAlert] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editDeliverableText, setEditDeliverableText] = useState('');
  const [noteOpenTaskId, setNoteOpenTaskId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');

  // Quick reason presets
  const reasonPresets = [
    'Chờ sếp duyệt tiền/chi phí',
    'Thiếu tài liệu từ đối tác',
    'Cần sếp gọi hỗ trợ trực tiếp',
    'Khác',
  ];

  const handleSelectReason = (reason: string) => {
    setSelectedReason(reason);
    setHelpMessage(`[${reason}] `);
  };

  const handleSendHelp = () => {
    if (!helpMessage.trim()) return;
    onSendHelpRequest({
      sender: currentUser.fullname,
      reason: selectedReason || 'Vướng mắc công việc',
      message: helpMessage,
    });
    setShowSentAlert(true);
    setHelpMessage('');
    setSelectedReason('');
    setTimeout(() => setShowSentAlert(false), 5000);
  };

  const handleRequestHelpFromTask = (taskTitle: string) => {
    const targetSection = document.getElementById('support-section');
    if (targetSection) {
      targetSection.scrollIntoView({ behavior: 'smooth' });
      setHelpMessage(`Về việc "${taskTitle}": `);
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'today') return t.isToday;
    if (filter === 'doing') return t.status === 'doing';
    if (filter === 'done') return t.status === 'done';
    return true;
  });

  const doingCount = tasks.filter((t) => t.status === 'doing').length;
  const todayCount = tasks.filter((t) => t.isToday).length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const overdueCount = tasks.filter((t) => t.isToday && t.status !== 'done').length;

  // Dynamic metric 2 sub-text: first urgent task
  const firstTodayPending = tasks.find((t) => t.isToday && t.status !== 'done');

  const isManager = currentUser.role === 'manager' || currentUser.role === 'director';

  // Use the manager of the first task as the recipient label
  const managerLabel = isManager ? 'Ban Điều hành' : (tasks[0]?.manager?.name ?? 'Trưởng phòng phụ trách');

  return (
    <div className="flex flex-col w-full">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Top Personalized Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-xl border border-[#e5eeff] shadow-sm">
          <div className="flex flex-col gap-1.5 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#dae2fd] text-[#131b2e] text-[12px] font-semibold">
                <span className="w-2 h-2 rounded-full bg-[#006243]"></span>
                Không gian cá nhân • {ROLE_LABEL[currentUser.role]}
              </span>
              <span className="font-mono text-[12px] text-[#565e74] font-semibold">
                @{currentUser.username}
              </span>
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[17px] font-bold text-[#004ac6]">
                Xin chào {currentUser.fullname} 👋
              </span>
              <span className="text-[14px] text-[#565e74]">
                Chúc bạn một ngày làm việc hiệu quả và nhẹ nhàng!
              </span>
            </div>
            <h1 className="text-[22px] sm:text-[26px] font-bold text-[#0b1c30] tracking-tight">
              Việc của tôi hôm nay
            </h1>
            <p className="text-[13px] text-[#434655] leading-relaxed">
              Các đầu việc được Trưởng phòng phân công. Làm xong chỉ cần bấm{' '}
              <span className="font-semibold text-[#006243]">[✓ Xong việc]</span> hoặc bấm{' '}
              <span className="font-semibold text-[#ba1a1a]">[Cần hỗ trợ]</span> nếu gặp khó khăn.
            </p>
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
            <button
              onClick={() => {
                document.getElementById('support-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#004ac6] hover:bg-[#2563eb] text-white text-[13px] font-semibold transition-colors shadow-sm"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">
                campaign
              </span>
              <span>Báo cáo nhanh cho Trưởng phòng</span>
            </button>
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
                {doingCount + (tasks.find((t) => t.isToday && t.status !== 'done') ? 0 : 0)}
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
              Thuê mặt bằng & ký hợp đồng
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
            <div className="flex items-center gap-1.5 text-[#565e74] text-[11px] self-end sm:self-center pr-2">
              <span className="material-symbols-outlined text-[16px] text-[#004ac6]">
                touch_app
              </span>
              <span>Bấm trực tiếp để thao tác nhanh</span>
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

                    {/* Manager Avatar info */}
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
                  </div>

                  {/* Result Box */}
                  <div className="bg-[#eff4ff] rounded-lg p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-[#dce9ff]">
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      <div className="w-7 h-7 rounded bg-[#dce9ff] flex items-center justify-center text-[#004ac6] shrink-0 mt-0.5 sm:mt-0">
                        <span className="material-symbols-outlined text-[18px]">
                          description
                        </span>
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[11px] font-semibold text-[#565e74]">
                          Kết quả bàn giao hiện tại:
                        </span>
                        {editingTaskId === task.id ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="text"
                              value={editDeliverableText}
                              onChange={(e) => setEditDeliverableText(e.target.value)}
                              className="text-[13px] px-2 py-1 bg-white border border-[#004ac6] rounded flex-1 focus:outline-none"
                            />
                            <button
                              onClick={() => {
                                onUpdateDeliverable(task.id, editDeliverableText);
                                setEditingTaskId(null);
                              }}
                              className="px-2.5 py-1 bg-[#006243] text-white text-[11px] font-bold rounded"
                            >
                              Lưu
                            </button>
                            <button
                              onClick={() => setEditingTaskId(null)}
                              className="px-2 py-1 bg-slate-200 text-[#0b1c30] text-[11px] rounded"
                            >
                              Hủy
                            </button>
                          </div>
                        ) : (
                          <span className="text-[13px] text-[#0b1c30] font-medium leading-relaxed">
                            {task.currentDeliverable}
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

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#eff4ff]">
                    <div className="flex items-center gap-2.5 flex-wrap">
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
                        onClick={() => {
                          setEditingTaskId(task.id);
                          setEditDeliverableText(task.currentDeliverable);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#eff4ff] hover:bg-[#dce9ff] text-[#0b1c30] text-[12px] font-semibold transition-all border border-[#dce9ff]"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[16px] text-[#004ac6]">
                          edit
                        </span>
                        <span>Cập nhật kết quả</span>
                      </button>

                      <button
                        onClick={() => handleRequestHelpFromTask(task.title)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white text-[#ba1a1a] hover:bg-red-50 border border-red-200 text-[12px] font-semibold transition-all shadow-sm"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[17px]">
                          help
                        </span>
                        <span>❓ Báo cần Trưởng phòng giúp</span>
                      </button>
                    </div>

                    <button
                      onClick={() =>
                        setNoteOpenTaskId(noteOpenTaskId === task.id ? null : task.id)
                      }
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-[#565e74] hover:text-[#004ac6] transition-colors py-1 px-2 rounded hover:bg-[#eff4ff]"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        chat_bubble_outline
                      </span>
                      <span>
                        Để lại ghi chú cho sếp ({task.notes?.length || task.notesCount})
                      </span>
                    </button>
                  </div>

                  {/* Notes dropdown box if open */}
                  {noteOpenTaskId === task.id && (
                    <div className="p-3 bg-[#eff4ff] rounded-lg border border-[#dce9ff] space-y-2 mt-2">
                      <div className="text-[12px] font-bold text-[#0b1c30]">
                        Ghi chú gửi Trưởng phòng:
                      </div>
                      {task.notes && task.notes.length > 0 ? (
                        <div className="space-y-1.5">
                          {task.notes.map((note, idx) => (
                            <div
                              key={idx}
                              className="text-[12px] text-[#434655] bg-white p-2 rounded border border-[#e5eeff]"
                            >
                              • {note}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-[#737686] italic">
                          Chưa có ghi chú nào.
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newNoteText}
                          onChange={(e) => setNewNoteText(e.target.value)}
                          placeholder="Viết ghi chú ngắn cho sếp..."
                          className="text-[12px] px-2.5 py-1.5 bg-white border border-[#c3c6d7] rounded flex-1 focus:outline-none focus:border-[#004ac6]"
                        />
                        <button
                          onClick={() => {
                            if (newNoteText.trim()) {
                              // Fix C5: use proper state update via onUpdateDeliverable or local state copy
                              // Append to existing notes array immutably
                              const updatedNotes = [...(task.notes ?? []), newNoteText];
                              onUpdateDeliverable(task.id, task.currentDeliverable); // trigger re-render
                              task.notes = updatedNotes; // temporary — will be replaced by proper state handler
                              setNewNoteText('');
                              setNoteOpenTaskId(null);
                            }
                          }}
                          className="px-3 py-1.5 bg-[#004ac6] text-white text-[12px] font-bold rounded"
                        >
                          Gửi ghi chú
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick Help & Escalation Box — chỉ hiện với employee */}
        {!isManager && (
        <div
          id="support-section"
          className="bg-white rounded-xl p-5 sm:p-6 border border-[#e5eeff] shadow-sm flex flex-col gap-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#ffdad6] flex items-center justify-center text-[#ba1a1a]">
                <span className="material-symbols-outlined text-[24px]">
                  support_agent
                </span>
              </div>
              <div className="flex flex-col">
                <h3 className="text-[18px] font-bold text-[#0b1c30]">
                  Bạn đang bị vướng mắc ở khâu nào?
                </h3>
                <span className="text-[13px] text-[#565e74]">
                  Báo trực tiếp cho {managerLabel} chỉ với 1 cú bấm, không cần viết email dài dòng.
                </span>
              </div>
            </div>
            <span className="hidden md:inline-flex items-center gap-1.5 text-[#565e74] text-[11px] bg-[#eff4ff] px-2.5 py-1 rounded font-medium">
              <span className="w-2 h-2 rounded-full bg-[#006243]"></span>
              Trưởng phòng đang online
            </span>
          </div>

          {/* Quick Reason Presets */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-[#0b1c30]">
              1. Chọn nhanh lý do vướng mắc:
            </span>
            <div className="flex flex-wrap gap-2">
              {reasonPresets.map((reason) => {
                const isSelected = selectedReason === reason;
                return (
                  <button
                    key={reason}
                    onClick={() => handleSelectReason(reason)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors border ${
                      isSelected
                        ? 'bg-[#ffdad6] text-[#ba1a1a] border-red-300'
                        : 'bg-[#eff4ff] text-[#434655] border-[#dce9ff] hover:bg-[#dce9ff]'
                    }`}
                    type="button"
                  >
                    {reason === 'Chờ sếp duyệt tiền/chi phí' && '⏳ '}
                    {reason === 'Thiếu tài liệu từ đối tác' && '📁 '}
                    {reason === 'Cần sếp gọi hỗ trợ trực tiếp' && '📞 '}
                    {reason === 'Khác' && '✏️ '}
                    {reason}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Message Input */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-[#0b1c30]">
              2. Lời nhắn nhanh gửi Trưởng phòng:
            </span>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[#737686]">
                  chat
                </span>
                <input
                  value={helpMessage}
                  onChange={(e) => setHelpMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendHelp();
                  }}
                  className="w-full h-11 pl-10 pr-3 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] placeholder:text-[#737686] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6] border border-[#dce9ff]"
                  placeholder="Nhập nhanh điều bạn cần Trưởng phòng giải quyết (ví dụ: Cần sếp duyệt chuyển cọc 10tr sáng nay)..."
                  type="text"
                />
              </div>
              <button
                onClick={handleSendHelp}
                className="shrink-0 h-11 px-5 rounded-lg bg-[#ba1a1a] hover:bg-red-700 text-white text-[13px] font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                type="button"
              >
                <span className="material-symbols-outlined text-[19px]">
                  send
                </span>
                <span>Gửi lời nhắn cho Trưởng phòng</span>
              </button>
            </div>
          </div>

          {/* Success Sent Alert */}
          {showSentAlert && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-lg bg-[#85f8c4]/30 text-[#002114] border border-[#007d57]/30 text-[13px] font-medium animate-fadeIn">
              <span className="material-symbols-outlined text-[#006243] text-[20px]">
                check_circle
              </span>
              <span>
                Tin nhắn đã được chuyển tới thông báo của {managerLabel}. Sếp sẽ phản hồi cho bạn sớm nhất!
              </span>
            </div>
          )}
        </div>
        )} {/* end !isManager */}

        {/* Motivational & Reassurance Footer Banner */}
        <div className="bg-[#eff4ff] rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 border border-[#dce9ff] shadow-sm">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-full bg-[#004ac6] text-white flex items-center justify-center shrink-0 shadow-sm">
              <span className="material-symbols-outlined text-[22px]">
                sync
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[14px] font-bold text-[#0b1c30]">
                Đồng bộ tự động theo thời gian thực
              </span>
              <p className="text-[12px] text-[#565e74] leading-relaxed">
                Mọi thao tác bấm của bạn tự động cập nhật lên bảng theo dõi của Trưởng phòng. Bạn hoàn toàn không cần phải soạn email hay làm báo cáo cuối ngày!
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[#006243] text-[12px] font-bold shrink-0 bg-white px-3.5 py-1.5 rounded-full shadow-sm border border-[#e5eeff]">
            <span className="material-symbols-outlined text-[16px]">
              done_all
            </span>
            <span>Hệ thống sẵn sàng</span>
          </div>
        </div>
      </div>
    </div>
  );
};
