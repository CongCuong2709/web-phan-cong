import React, { useState } from 'react';
import { TeamMember, TeamLeadTask } from '../types';

interface GiaoViecNhomViewProps {
  teamMembers: TeamMember[];
  tasks: TeamLeadTask[];
  onApproveTask: (taskId: string) => void;
  onResolveHelp: (taskId: string) => void;
  onOpenNewTaskModal: () => void;
  onOpenNewBundleModal: () => void;
  onPreviewDeliverable: (task: TeamLeadTask) => void;
  onSendMessage: (memberName: string, taskTitle: string) => void;
}

export const GiaoViecNhomView: React.FC<GiaoViecNhomViewProps> = ({
  teamMembers,
  tasks,
  onApproveTask,
  onResolveHelp,
  onOpenNewTaskModal,
  onOpenNewBundleModal,
  onPreviewDeliverable,
  onSendMessage,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'need_help' | 'done'>('pending');
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(true);

  // Filtered task list
  const filteredTasks = tasks.filter((t) => {
    if (memberFilter && t.ownerName !== memberFilter) return false;

    if (filter === 'all') return true;
    if (filter === 'pending') return t.status === 'pending_approval';
    if (filter === 'need_help') return t.status === 'need_help';
    if (filter === 'done') return t.status === 'done';
    return true;
  });

  const pendingCount = tasks.filter((t) => t.status === 'pending_approval').length;
  const helpCount = tasks.filter((t) => t.status === 'need_help').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  // --- Dynamic summary cards (replacing all hardcoded values) ---
  // "Đang làm tốt": tasks that are in_progress (not blocked, not done, not need_help)
  const inProgressCount = tasks.filter(
    (t) => t.status !== 'need_help' && t.status !== 'done' && t.status !== 'pending_approval'
  ).length;
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-xl border border-[#e5eeff] shadow-sm">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[#565e74] text-[12px] font-semibold">
              <span className="material-symbols-outlined text-[17px] text-[#004ac6]">
                groups
              </span>
              <span>Phòng ban</span>
              <span className="text-[#c3c6d7]">•</span>
              <span className="text-[#004ac6]">Đội ngũ của tôi</span>
            </div>
            <h1 className="text-[22px] sm:text-[26px] font-bold text-[#0b1c30] tracking-tight">
              Giao việc & Theo dõi tiến độ nhóm (Trưởng phòng)
            </h1>
            <p className="text-[14px] text-[#434655] max-w-2xl leading-relaxed">
              Phân chia việc cho các bạn trong nhóm, hỗ trợ khi gặp khó khăn và kiểm tra công việc đã hoàn thành dễ dàng, không thuật ngữ phức tạp.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0">
            <button
              onClick={onOpenNewBundleModal}
              className="px-3.5 py-2 bg-[#eff4ff] hover:bg-[#dce9ff] text-[#0b1c30] text-[13px] font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-[#004ac6]">
                folder_copy
              </span>
              <span>+ Tạo nhóm việc / Đợt việc</span>
            </button>
            <button
              onClick={onOpenNewTaskModal}
              className="px-4 py-2 bg-[#004ac6] hover:bg-[#2563eb] text-white text-[13px] font-semibold rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">
                add_task
              </span>
              <span>+ Giao việc mới cho nhân viên</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Metric Cards — tính động từ props */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#565e74]">
                Tổng việc nhóm quản lý
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#eff4ff] flex items-center justify-center text-[#004ac6]">
                <span className="material-symbols-outlined text-[19px]">
                  fact_check
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[32px] font-bold text-[#0b1c30] leading-none tabular-nums">
                {tasks.length}
              </div>
              <p className="text-[11px] text-[#565e74] mt-1.5">
                Chia cho {teamMembers.length} thành viên
              </p>
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#006243]">
                Đang làm tốt
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#85f8c4]/40 text-[#006243] flex items-center justify-center">
                <span className="material-symbols-outlined text-[19px]">
                  thumb_up
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[32px] font-bold text-[#006243] leading-none tabular-nums">
                {inProgressCount}
              </div>
              <p className="text-[11px] text-[#565e74] mt-1.5">
                Tiến độ đều đặn, đúng kế hoạch
              </p>
            </div>
          </div>

          {/* Card 3 */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#565e74]">
                Đã xong tuần này
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#eff4ff] text-[#004ac6] flex items-center justify-center">
                <span className="material-symbols-outlined text-[19px]">
                  task_alt
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[32px] font-bold text-[#0b1c30] leading-none tabular-nums">
                {doneCount}
              </div>
              <p className="text-[11px] text-[#565e74] mt-1.5">
                Đã duyệt nghiệm thu hoàn tất
              </p>
            </div>
          </div>

          {/* Card 4 - Urgent Blocker Card */}
          <div
            className={`p-4 sm:p-5 rounded-xl border shadow-sm flex flex-col justify-between ${
              helpCount > 0
                ? 'bg-[#ffdad6]/40 border-[#ffdad6]'
                : 'bg-emerald-50/50 border-emerald-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[12px] font-bold flex items-center gap-1.5 ${
                  helpCount > 0 ? 'text-[#ba1a1a]' : 'text-[#006243]'
                }`}
              >
                {helpCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-[#ba1a1a] animate-pulse"></span>
                )}
                {helpCount > 0 ? 'Cần Trưởng phòng hỗ trợ' : 'Nhóm ổn định'}
              </span>
              <div
                className={`w-8 h-8 rounded-lg text-white flex items-center justify-center ${
                  helpCount > 0 ? 'bg-[#ba1a1a]' : 'bg-[#006243]'
                }`}
              >
                <span className="material-symbols-outlined text-[19px]">
                  {helpCount > 0 ? 'support' : 'check_circle'}
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div
                className={`text-[32px] font-bold leading-none tabular-nums ${
                  helpCount > 0 ? 'text-[#ba1a1a]' : 'text-[#006243]'
                }`}
              >
                {helpCount}
              </div>
              <p
                className={`text-[11px] mt-1.5 font-semibold ${
                  helpCount > 0 ? 'text-[#93000a]' : 'text-[#006243]'
                }`}
              >
                {helpMemberNote}
              </p>
            </div>
          </div>
        </div>

        {/* Section 1: Team Member Workload Allocation */}
        <div className="bg-white p-5 sm:p-6 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#eff4ff] text-[#004ac6] flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">
                  badge
                </span>
              </div>
              <div>
                <h2 className="text-[18px] font-bold text-[#0b1c30]">
                  Tình hình công việc của từng thành viên
                </h2>
                <p className="text-[12px] text-[#565e74]">
                  Xem ngay ai đang thong thả, ai đang quá tải để điều phối việc chuẩn xác
                </p>
              </div>
            </div>
            {memberFilter ? (
              <button
                onClick={() => setMemberFilter(null)}
                className="px-2.5 py-1 bg-[#eff4ff] text-[#004ac6] text-[11px] font-semibold rounded hover:bg-[#dce9ff]"
              >
                Đang lọc: {memberFilter} (Bấm để xóa lọc)
              </button>
            ) : (
              <span className="px-2.5 py-1 bg-[#eff4ff] text-[#434655] text-[11px] font-medium rounded-lg">
                5 thành viên sẵn sàng
              </span>
            )}
          </div>

          {/* Members Grid Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
            {teamMembers.map((member) => {
              const isSelected = memberFilter === member.name;
              const isWarning = member.needHelp;

              return (
                <div
                  key={member.id}
                  className={`p-4 rounded-xl flex flex-col justify-between gap-3 transition-all border ${
                    isSelected
                      ? 'ring-2 ring-[#004ac6] border-transparent'
                      : isWarning
                      ? 'bg-[#ffdad6]/25 border-red-200'
                      : 'bg-[#eff4ff]/60 border-[#e5eeff] hover:bg-[#eff4ff]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <img
                        className="w-10 h-10 rounded-full object-cover shadow-sm ring-1 ring-white"
                        src={member.avatar}
                        alt={member.name}
                      />
                      {isWarning && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#ba1a1a] rounded-full ring-2 ring-white flex items-center justify-center">
                          <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[14px] text-[#0b1c30] truncate">
                        {member.name}
                      </div>
                      <div className="text-[11px] text-[#565e74] truncate">
                        {member.role}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#0b1c30] font-medium">
                        {member.activeTasks} việc đang làm
                      </span>
                      {isWarning ? (
                        <span className="text-[#ba1a1a] font-bold flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">
                            help
                          </span>
                          1 việc cần hỗ trợ
                        </span>
                      ) : (
                        <span className="text-[#006243] font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">
                            check_circle
                          </span>
                          {member.onTimeRate}
                        </span>
                      )}
                    </div>

                    {isWarning && member.urgentNote ? (
                      <div className="text-[11px] leading-tight text-[#93000a] bg-red-100/80 p-1.5 rounded font-medium">
                        {member.urgentNote}
                      </div>
                    ) : (
                      <div className="w-full bg-[#d3e4fe] rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-[#006243] h-1.5 rounded-full"
                          style={{ width: `${member.workloadPercent}%` }}
                        ></div>
                      </div>
                    )}
                  </div>

                  {isWarning ? (
                    <button
                      onClick={() => {
                        setFilter('need_help');
                        setMemberFilter(member.name);
                      }}
                      className="w-full py-1.5 px-3 bg-[#ba1a1a] hover:bg-red-700 text-white rounded-lg text-[12px] font-bold text-center transition-all shadow-sm flex items-center justify-center gap-1"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        support
                      </span>
                      <span>Giúp ngay</span>
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setMemberFilter(isSelected ? null : member.name)
                      }
                      className="w-full py-1.5 px-3 bg-white text-[#0b1c30] hover:bg-[#dce9ff] rounded-lg text-[12px] font-semibold text-center transition-all shadow-sm border border-[#e5eeff]"
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
        <div className="bg-white p-5 sm:p-6 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col gap-5">
          {/* Table Header & Filter Tabs */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-bold text-[#0b1c30]">
                Việc cần Trưởng phòng duyệt & Điều phối
              </h2>
              <p className="text-[12px] text-[#565e74]">
                Các đầu việc cần bạn bấm nút kiểm tra, tháo gỡ vướng mắc hoặc nghiệm thu
              </p>
            </div>

            {/* Filter Segmented Tabs */}
            <div className="inline-flex p-1 bg-[#eff4ff] rounded-xl gap-1 self-start md:self-auto overflow-x-auto no-scrollbar max-w-full">
              <button
                onClick={() => setFilter('all')}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors ${
                  filter === 'all'
                    ? 'bg-white text-[#004ac6] shadow-sm'
                    : 'text-[#565e74] hover:text-[#0b1c30]'
                }`}
                type="button"
              >
                Tất cả việc nhóm ({tasks.length})
              </button>
              <button
                onClick={() => setFilter('pending')}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  filter === 'pending'
                    ? 'bg-white text-[#004ac6] shadow-sm'
                    : 'text-[#565e74] hover:text-[#0b1c30]'
                }`}
                type="button"
              >
                <span>Chờ tôi duyệt kết quả</span>
                <span className="w-4 h-4 rounded-full bg-[#004ac6] text-white text-[10px] flex items-center justify-center font-bold">
                  {pendingCount}
                </span>
              </button>
              <button
                onClick={() => setFilter('need_help')}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  filter === 'need_help'
                    ? 'bg-white text-[#ba1a1a] shadow-sm'
                    : 'text-[#ba1a1a] hover:bg-red-50'
                }`}
                type="button"
              >
                <span>Cần tôi hỗ trợ</span>
                <span className="w-4 h-4 rounded-full bg-[#ba1a1a] text-white text-[10px] flex items-center justify-center font-bold">
                  {helpCount}
                </span>
              </button>
              <button
                onClick={() => setFilter('done')}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors ${
                  filter === 'done'
                    ? 'bg-white text-[#006243] shadow-sm'
                    : 'text-[#565e74] hover:text-[#0b1c30]'
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
              <div className="p-8 text-center text-[#565e74] bg-[#eff4ff]/40 rounded-xl">
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
                        ? 'bg-[#ffdad6]/25 border-red-200 hover:bg-[#ffdad6]/40'
                        : isDone
                        ? 'bg-emerald-50/40 border-emerald-200'
                        : 'bg-[#eff4ff]/50 border-[#e5eeff] hover:bg-[#eff4ff]'
                    }`}
                  >
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      {/* Status Tag */}
                      {isPending && (
                        <span className="px-2 py-0.5 bg-[#004ac6] text-white text-[10px] font-bold rounded uppercase whitespace-nowrap mt-0.5">
                          Chờ duyệt kết quả
                        </span>
                      )}
                      {isNeedHelp && (
                        <span className="px-2 py-0.5 bg-[#ba1a1a] text-white text-[10px] font-bold rounded uppercase whitespace-nowrap mt-0.5 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">
                            warning
                          </span>
                          Cần hỗ trợ gấp
                        </span>
                      )}
                      {isDone && (
                        <span className="px-2 py-0.5 bg-[#006243] text-white text-[10px] font-bold rounded uppercase whitespace-nowrap mt-0.5 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">
                            check
                          </span>
                          Đã nghiệm thu
                        </span>
                      )}
                      {!isPending && !isNeedHelp && !isDone && (
                        <span className="px-2 py-0.5 bg-[#e5eeff] text-[#434655] text-[10px] font-bold rounded uppercase whitespace-nowrap mt-0.5">
                          Đang làm
                        </span>
                      )}

                      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                        <div className="text-[15px] font-bold text-[#0b1c30] flex items-center gap-2 flex-wrap">
                          <span>{task.title}</span>
                          <span className="text-[11px] font-semibold text-[#565e74] bg-[#e5eeff] px-2 py-0.5 rounded">
                            {task.category}
                          </span>
                        </div>

                        {/* Evidence preview box */}
                        {isNeedHelp && task.helpMessage ? (
                          <div className="p-2.5 bg-white rounded-lg border border-red-200 text-[13px] text-[#0b1c30] flex items-start gap-2 shadow-sm">
                            <span className="material-symbols-outlined text-[18px] text-[#ba1a1a] shrink-0 mt-0.5">
                              priority_high
                            </span>
                            <span>
                              <strong>{task.helpMessage.author} gửi lời nhắn:</strong> “
                              {task.helpMessage.message}”
                            </span>
                          </div>
                        ) : (
                          <div
                            onClick={() => onPreviewDeliverable(task)}
                            className="p-2 bg-white rounded-lg border border-[#e5eeff] flex items-center gap-2 text-[13px] text-[#0b1c30] cursor-pointer hover:border-[#004ac6] transition-colors shadow-sm"
                          >
                            <span className="material-symbols-outlined text-[18px] text-[#006243]">
                              {task.deliverableType === 'pdf'
                                ? 'attachment'
                                : task.deliverableType === 'spreadsheet'
                                ? 'table_chart'
                                : 'description'}
                            </span>
                            <span className="truncate">
                              Kết quả nộp: <strong>{task.deliverableText}</strong>
                            </span>
                            <span className="material-symbols-outlined text-[16px] text-[#737686] ml-auto">
                              open_in_new
                            </span>
                          </div>
                        )}

                        {/* Metadata row */}
                        <div className="flex items-center gap-3 text-[11px] text-[#565e74] mt-0.5 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            {task.ownerAvatar ? (
                              <img
                                src={task.ownerAvatar}
                                alt={task.ownerName}
                                className="w-4 h-4 rounded-full object-cover"
                              />
                            ) : (
                              <span className="material-symbols-outlined text-[14px]">
                                person
                              </span>
                            )}
                            <span>
                              Người làm: <strong>{task.ownerName}</strong>
                            </span>
                          </div>
                          <span>•</span>
                          <span
                            className={
                              isNeedHelp ? 'text-[#ba1a1a] font-semibold' : ''
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

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end lg:self-center shrink-0">
                      {isPending && (
                        <>
                          <button
                            onClick={() =>
                              onSendMessage(task.ownerName, task.title)
                            }
                            className="px-3 py-1.5 bg-white border border-[#c3c6d7] text-[#0b1c30] hover:bg-[#eff4ff] rounded-lg text-[12px] font-semibold shadow-sm transition-colors"
                            type="button"
                          >
                            Nhắc sửa
                          </button>
                          <button
                            onClick={() => onApproveTask(task.id)}
                            className="px-3.5 py-1.5 bg-[#006243] text-white hover:bg-[#007d57] rounded-lg text-[12px] font-bold shadow-sm flex items-center gap-1.5 transition-all"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              check
                            </span>
                            <span>Duyệt đạt</span>
                          </button>
                        </>
                      )}

                      {isNeedHelp && (
                        <>
                          <button
                            onClick={() =>
                              onSendMessage(task.ownerName, task.title)
                            }
                            className="px-3 py-1.5 bg-white border border-[#c3c6d7] text-[#0b1c30] hover:bg-[#eff4ff] rounded-lg text-[12px] font-semibold shadow-sm transition-colors"
                            type="button"
                          >
                            Nhắn {task.ownerName.split(' ').pop()}
                          </button>
                          <button
                            onClick={() => onResolveHelp(task.id)}
                            className="px-3.5 py-1.5 bg-[#004ac6] text-white hover:bg-[#2563eb] rounded-lg text-[12px] font-bold shadow-sm flex items-center gap-1.5 transition-all"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              task_alt
                            </span>
                            <span>Đã xử lý hỗ trợ</span>
                          </button>
                        </>
                      )}

                      {!isPending && !isNeedHelp && (
                        <button
                          onClick={() =>
                            onSendMessage(task.ownerName, task.title)
                          }
                          className="px-3 py-1.5 bg-white border border-[#c3c6d7] text-[#0b1c30] hover:bg-[#eff4ff] rounded-lg text-[12px] font-semibold shadow-sm flex items-center gap-1 transition-colors"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[16px] text-[#004ac6]">
                            chat
                          </span>
                          <span>Nhắn hỏi thăm</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Friendly Team Leader Guidance Card */}
        {showTip && (
          <div className="p-4 sm:p-5 bg-[#dce9ff]/50 border border-[#c3c6d7] rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-full bg-[#004ac6] text-white flex items-center justify-center shrink-0 shadow-sm">
                <span className="material-symbols-outlined text-[22px]">
                  lightbulb
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[14px] font-bold text-[#0b1c30]">
                  Mẹo quản lý cho Trưởng phòng
                </span>
                <p className="text-[12px] text-[#434655] leading-relaxed">
                  Bạn chỉ cần mở trang này vào đầu buổi sáng: duyệt các mục có nhãn{' '}
                  <span className="text-[#004ac6] font-semibold">
                    [Chờ duyệt kết quả]
                  </span>{' '}
                  hoặc bấm{' '}
                  <span className="text-[#ba1a1a] font-semibold">[Giúp ngay]</span>{' '}
                  khi nhân viên báo vướng. Những việc còn lại nhân viên tự tích hoàn thành, bạn không cần ghi sổ sách riêng!
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowTip(false)}
              className="px-3.5 py-1.5 bg-white text-[#004ac6] hover:bg-[#eff4ff] rounded-lg text-[12px] font-bold shrink-0 shadow-sm border border-[#c3c6d7]"
              type="button"
            >
              Đã hiểu mẹo này
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
