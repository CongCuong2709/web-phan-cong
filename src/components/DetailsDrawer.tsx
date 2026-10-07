import React, { useState, useEffect, useMemo } from 'react';
import {
  TierItem,
  Deliverable,
  SubTask,
  DailyLog,
  HistoryEntry,
  TaskStatus,
  User,
} from '../types';
import {
  canEditTierItem,
  canEditSubtask,
  canAddDailyLog,
} from '../auth/permissions';

interface DetailsDrawerProps {
  item: TierItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateItem: (updated: TierItem) => void;
  subtasks?: SubTask[];
  dailyLogs?: DailyLog[];
  history?: HistoryEntry[];
  /** Fix TD-07: cần truyền allTierItems để compute descendants khi filter history. */
  allTierItems?: TierItem[];
  onUpdateSubtaskProgress?: (subtaskId: string, progress: number) => void;
  onAddDailyLog?: (
    subtaskId: string,
    description: string,
    result?: string,
    obstacle?: string,
    progress?: number
  ) => void;
  /** Người đang đăng nhập — dùng để kiểm tra quyền edit */
  currentUser?: User;
}

const SUBTASK_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Chưa bắt đầu',
  in_progress: 'Đang thi công',
  completed: 'Hoàn thành',
  blocked: 'Đang nghẽn',
  review: 'Đang nghiệm thu',
};

const SUBTASK_STATUS_COLOR: Record<TaskStatus, string> = {
  not_started: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-[#004ac6]/10 text-[#004ac6]',
  completed: 'bg-emerald-100 text-emerald-800',
  blocked: 'bg-amber-100 text-amber-800',
  review: 'bg-[#dae2fd] text-[#131b2e]',
};

export const DetailsDrawer: React.FC<DetailsDrawerProps> = ({
  item,
  isOpen,
  onClose,
  onUpdateItem,
  subtasks = [],
  dailyLogs = [],
  history = [],
  allTierItems = [],
  onUpdateSubtaskProgress,
  onAddDailyLog,
  currentUser,
}) => {
  const [formData, setFormData] = useState<TierItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Determine if this user can edit this item.
  // Logic đã được centralize trong auth/permissions.ts (A4 fix gốc).
  const canEdit = useMemo(
    () => canEditTierItem(currentUser, formData),
    [currentUser, formData]
  );

  const [expandedSubtask, setExpandedSubtask] = useState<string | null>(null);
  const [newLogDraft, setNewLogDraft] = useState<{
    subtaskId: string;
    description: string;
    result: string;
    obstacle: string;
    progress: number;
  } | null>(null);

  useEffect(() => {
    setFormData(item ? JSON.parse(JSON.stringify(item)) : null);
    setIsEditing(false);
    setExpandedSubtask(null);
    setNewLogDraft(null);
  }, [item]);

  const itemSubtasks = useMemo(() => {
    if (!formData || formData.tier !== 4) return [];
    return subtasks.filter((s) => s.taskId === formData.id);
  }, [subtasks, formData]);

  const logsBySubtask = useMemo(() => {
    const map = new Map<string, DailyLog[]>();
    for (const log of dailyLogs) {
      if (!map.has(log.subtaskId)) map.set(log.subtaskId, []);
      map.get(log.subtaskId)!.push(log);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.logDate < b.logDate ? 1 : -1));
    }
    return map;
  }, [dailyLogs]);

  // Fix TD-07: history filter đúng theo ý đồ — bao gồm:
  //  1. History của chính item hiện tại
  //  2. History của tất cả descendants (cây con) — bubbled-down
  // Bug cũ:
  //   - `formData.parentId === null` không bao giờ đúng vì parentId là `string | undefined`
  //   - Không bao giờ có descendant history vì comment `false` cố ý
  //   - Hệ quả: T2/T3 chỉ thấy history của chính nó, bỏ sót audit log của các T3/T4 con
  const itemHistory = useMemo(() => {
    if (!formData) return [];
    // Build descendants set 1 lần
    const descendantIds = new Set<string>();
    const stack = [formData.id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const t of allTierItems) {
        if (t.parentId === cur && !descendantIds.has(t.id)) {
          descendantIds.add(t.id);
          stack.push(t.id);
        }
      }
    }
    return history.filter((h) => h.entityId === formData.id || descendantIds.has(h.entityId));
  }, [history, formData, allTierItems]);

  if (!isOpen || !formData) return null;

  const handleToggleDeliverable = (delId: string) => {
    if (!formData) return;
    // Guard A5: chỉ user có quyền edit mới toggle được deliverables (ẩn UI đã làm,
    // nhưng phòng trường hợp gọi trực tiếp từ devtools / future handler khác).
    if (!canEdit) return;
    const newDeliverables = formData.deliverables.map((d: Deliverable) =>
      d.id === delId ? { ...d, completed: !d.completed } : d
    );
    const completedCount = newDeliverables.filter((d) => d.completed).length;
    const calculatedProgress =
      newDeliverables.length > 0
        ? Math.round((completedCount / newDeliverables.length) * 100)
        : formData.progress;

    const updated: TierItem = {
      ...formData,
      deliverables: newDeliverables,
      progress: calculatedProgress,
    };
    setFormData(updated);
    onUpdateItem(updated);
  };

  const handleSave = () => {
    if (formData) {
      onUpdateItem(formData);
      setIsEditing(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#0b1c30]/30 backdrop-blur-[2px] z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <aside
        className="fixed right-0 top-14 bottom-0 w-full sm:w-[460px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-out flex flex-col border-l border-[#e5eeff]"
        aria-label="Chi tiết hạng mục"
      >
        {/* Drawer Header */}
        <div className="p-4 bg-[#eff4ff] flex items-start justify-between border-b border-[#dce9ff]">
          <div className="pr-3">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="font-mono text-[12px] px-2 py-0.5 bg-[#e5eeff] text-[#004ac6] font-bold rounded">
                {formData.code}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-[#004ac6] text-white rounded uppercase tracking-wider">
                {formData.tierName}
              </span>
              {formData.department && (
                <span className="text-[10px] font-bold px-2 py-0.5 bg-white text-[#0b1c30] rounded border border-[#dce9ff]">
                  {formData.department}
                </span>
              )}
            </div>
            <h3 className="font-semibold text-[17px] text-[#0b1c30] leading-snug">
              {formData.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-[#434655] hover:text-[#0b1c30] hover:bg-[#dce9ff] transition-colors shrink-0"
            title="Đóng (Esc)"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#f8f9ff]">
          {/* 1. Responsibility */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
              1. Người phụ trách chính
            </label>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#dae2fd] text-[#131b2e] font-bold flex items-center justify-center text-[13px]">
                {formData.owner.initial}
              </div>
              <div>
                <div className="text-[14px] font-semibold text-[#0b1c30]">
                  {formData.owner.name}
                </div>
                <div className="text-[12px] text-[#565e74]">
                  {formData.owner.role}
                  {formData.ownerUsername && (
                    <span className="ml-2 font-mono text-[#004ac6]">
                      @{formData.ownerUsername}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 2. Deadline */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
              2. Thời hạn hoàn thành
            </label>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[14px] font-bold text-[#0b1c30]">
                {formData.deadline}
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-[#006243] border border-emerald-200">
                {formData.daysRemaining !== undefined
                  ? formData.daysRemaining === 0
                    ? 'Đến hạn hôm nay'
                    : `Còn ${formData.daysRemaining} ngày`
                  : 'Đúng hạn'}
              </span>
            </div>
          </div>

          {/* 3. Progress */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider">
                3. Tiến độ thực tế
              </label>
              <span className="font-mono font-bold text-[15px] text-[#004ac6]">
                {formData.progress}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-[#eff4ff] rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-[#004ac6] rounded-full transition-all duration-300"
                style={{ width: `${formData.progress}%` }}
              ></div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11px] text-[#737686]">Chỉnh tiến độ:</span>
              {canEdit ? (
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={formData.progress}
                  onChange={(e) =>
                    setFormData({ ...formData, progress: Number(e.target.value) })
                  }
                  className="flex-1 accent-[#004ac6] cursor-pointer"
                />
              ) : (
                <div className="flex-1 h-2 bg-[#eff4ff] rounded-full overflow-hidden">
                  <div className="h-full bg-[#004ac6]/40 rounded-full" style={{ width: `${formData.progress}%` }} />
                </div>
              )}
            </div>
          </div>

          {/* 4. Status */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
              4. Trạng thái điều hành
            </label>
            {/* Fix UI-04: select chỉ interactive khi canEdit=true. Khi !canEdit, hiển thị
                read-only badge tránh user đổi status rồi save description → ghi nhầm. */}
            {canEdit ? (
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    status: e.target.value as TierItem['status'],
                  })
                }
                className="w-full text-[13px] font-medium bg-[#f8f9ff] text-[#0b1c30] border border-[#c3c6d7] rounded px-3 py-1.5 focus:outline-none focus:border-[#004ac6]"
              >
                <option value="Đang chạy">Đang chạy</option>
                <option value="Sắp xong">Sắp xong</option>
                <option value="Đã xong">Đã xong</option>
                <option value="Điểm nghẽn">Điểm nghẽn</option>
                <option value="Đang làm">Đang làm</option>
                <option value="Đang nghẽn">Đang nghẽn</option>
                <option value="Lên lịch">Lên lịch</option>
                <option value="Chuẩn bị">Chuẩn bị</option>
              </select>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#eff4ff] text-[#004ac6] rounded border border-[#dce9ff] text-[13px] font-semibold">
                <span className="material-symbols-outlined text-[15px]">
                  lock
                </span>
                <span>{formData.status}</span>
                <span className="text-[10px] font-medium text-[#737686] ml-1">
                  · Chỉ đọc
                </span>
              </div>
            )}
          </div>

          {/* 5. Priority */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
              5. Mức độ ưu tiên
            </label>
            <div className="flex items-center gap-1.5 text-[#ba1a1a] text-[13px] font-semibold">
              <span className="material-symbols-outlined text-[18px]">
                priority_high
              </span>
              <span>{formData.priority}</span>
            </div>
          </div>

          {/* 6. Description */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
              6. Mô tả & Phạm vi
            </label>
            {isEditing ? (
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full text-[13px] bg-[#f8f9ff] border border-[#c3c6d7] rounded p-2 focus:outline-none focus:border-[#004ac6]"
                rows={3}
              />
            ) : (
              <p className="text-[13px] text-[#434655] leading-relaxed whitespace-pre-line">
                {formData.description}
              </p>
            )}
          </div>

          {/* 7. Deliverables */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider">
                7. Kết quả bàn giao (Deliverables)
              </label>
              <span className="text-[11px] font-mono text-[#006243] font-medium">
                {formData.deliverables.filter((d) => d.completed).length}/
                {formData.deliverables.length} đạt
              </span>
            </div>
            <div className="space-y-2">
              {formData.deliverables.map((del) => (
                <div
                  key={del.id}
                  onClick={() => handleToggleDeliverable(del.id)}
                  className={`flex items-start gap-2.5 p-2 rounded border border-transparent transition-colors ${
                    canEdit
                      ? 'hover:bg-[#eff4ff] cursor-pointer hover:border-[#dce9ff]'
                      : 'cursor-not-allowed opacity-80'
                  }`}
                  title={canEdit ? 'Bấm để đánh dấu hoàn thành' : 'Bạn không có quyền chỉnh sửa'}
                >
                  <span
                    className={`material-symbols-outlined text-[18px] shrink-0 mt-0.5 ${
                      del.completed ? 'text-[#006243] fill-1' : 'text-[#737686]'
                    }`}
                  >
                    {del.completed ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span
                    className={`text-[13px] ${
                      del.completed
                        ? 'line-through text-[#737686]'
                        : 'text-[#0b1c30] font-medium'
                    }`}
                  >
                    {del.title}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 8. Management Notes */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
              8. Ghi chú điều hành
            </label>
            {isEditing ? (
              <textarea
                value={formData.managementNotes}
                onChange={(e) =>
                  setFormData({ ...formData, managementNotes: e.target.value })
                }
                className="w-full text-[13px] bg-[#f8f9ff] border border-[#c3c6d7] rounded p-2 focus:outline-none focus:border-[#004ac6]"
                rows={2}
              />
            ) : (
              <p className="text-[13px] text-[#434655] italic leading-relaxed">
                {formData.managementNotes}
              </p>
            )}
          </div>

          {/* 9. SUBTASKS (chỉ hiển thị với T4) */}
          {formData.tier === 4 && (
            <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider">
                  9. Đầu việc con (Sub-tasks)
                </label>
                <span className="text-[11px] font-mono text-[#004ac6] font-semibold">
                  {itemSubtasks.length} hạng mục
                </span>
              </div>

              {itemSubtasks.length === 0 ? (
                <p className="text-[12px] text-[#737686] italic">
                  Đầu việc này chưa có Sub-task nào.
                </p>
              ) : (
                <div className="space-y-2">
                  {itemSubtasks.map((sub) => {
                    const logs = logsBySubtask.get(sub.id) ?? [];
                    const expanded = expandedSubtask === sub.id;
                    return (
                      <div
                        key={sub.id}
                        className="border border-[#e5eeff] rounded-lg overflow-hidden"
                      >
                        <button
                          onClick={() =>
                            setExpandedSubtask(expanded ? null : sub.id)
                          }
                          className="w-full text-left p-2.5 hover:bg-[#eff4ff] flex items-start justify-between gap-2 transition-colors"
                          type="button"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SUBTASK_STATUS_COLOR[sub.status]}`}
                              >
                                {SUBTASK_STATUS_LABEL[sub.status]}
                              </span>
                              <span className="text-[13px] font-semibold text-[#0b1c30] truncate">
                                {sub.name}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#565e74] mt-0.5 flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[12px]">
                                person
                              </span>
                              <span>
                                {sub.assigneeName}
                                {sub.assigneeUsername && (
                                  <span className="font-mono text-[#004ac6] ml-1">
                                    @{sub.assigneeUsername}
                                  </span>
                                )}
                              </span>
                              <span className="text-[#c3c6d7]">•</span>
                              <span>
                                {sub.startDate} → {sub.endDate}
                              </span>
                              {logs.length > 0 && (
                                <>
                                  <span className="text-[#c3c6d7]">•</span>
                                  <span className="text-[#006243] font-semibold">
                                    {logs.length} nhật ký
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="mt-1.5 w-full h-1.5 bg-[#eff4ff] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#004ac6] rounded-full"
                                style={{ width: `${sub.progress}%` }}
                              ></div>
                            </div>
                          </div>
                          <span className="text-[12px] font-bold text-[#004ac6] shrink-0 self-start">
                            {sub.progress}%
                          </span>
                        </button>

                        {expanded && (
                          <div className="border-t border-[#e5eeff] p-2.5 bg-[#f8f9ff] space-y-2.5">
                            {sub.results && (
                              <div className="text-[12px] text-[#434655] bg-emerald-50 border border-emerald-200 rounded p-2 leading-relaxed">
                                <span className="font-semibold text-[#006243]">
                                  Kết quả:
                                </span>{' '}
                                {sub.results}
                              </div>
                            )}

                            {/* Daily logs timeline */}
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                                Nhật ký thi công ({logs.length})
                              </span>
                              {onAddDailyLog && canAddDailyLog(currentUser, sub, formData) && (
                                <button
                                  onClick={() =>
                                    setNewLogDraft({
                                      subtaskId: sub.id,
                                      description: '',
                                      result: '',
                                      obstacle: '',
                                      progress: sub.progress,
                                    })
                                  }
                                  className="text-[11px] font-bold text-[#004ac6] hover:text-[#2563eb] flex items-center gap-1"
                                  type="button"
                                >
                                  <span className="material-symbols-outlined text-[14px]">
                                    add
                                  </span>
                                  Thêm nhật ký
                                </button>
                              )}
                            </div>

                            {logs.length === 0 ? (
                              <p className="text-[12px] text-[#737686] italic">
                                Chưa có nhật ký.
                              </p>
                            ) : (
                              <ul className="space-y-2">
                                {logs.map((log) => (
                                  <li
                                    key={log.id}
                                    className="bg-white border border-[#e5eeff] rounded p-2.5"
                                  >
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="font-mono text-[11px] font-bold text-[#004ac6]">
                                        {log.logDate}
                                      </span>
                                      <span className="text-[10px] font-bold text-[#006243]">
                                        +{log.progress}%
                                      </span>
                                    </div>
                                    <div className="text-[12px] text-[#0b1c30] leading-relaxed">
                                      {log.description}
                                    </div>
                                    {log.result && (
                                      <div className="text-[11px] text-[#006243] mt-1 font-medium">
                                        ✅ {log.result}
                                      </div>
                                    )}
                                    {log.obstacle && log.obstacle !== 'Không' && (
                                      <div className="text-[11px] text-[#ba1a1a] mt-1 font-medium">
                                        ⚠ {log.obstacle}
                                      </div>
                                    )}
                                    <div className="text-[10px] text-[#737686] mt-1.5">
                                      — {log.userName}
                                      {log.userRole && ` · ${log.userRole}`}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}

                            {/* Inline draft form */}
                            {newLogDraft?.subtaskId === sub.id && (
                              <div className="bg-[#eff4ff] border border-[#dce9ff] rounded p-2.5 space-y-2">
                                <textarea
                                  value={newLogDraft.description}
                                  onChange={(e) =>
                                    setNewLogDraft({
                                      ...newLogDraft,
                                      description: e.target.value,
                                    })
                                  }
                                  rows={2}
                                  placeholder="Mô tả công việc hôm nay…"
                                  className="w-full text-[12px] p-2 rounded border border-[#dce9ff] bg-white"
                                />
                                <input
                                  type="text"
                                  value={newLogDraft.result}
                                  onChange={(e) =>
                                    setNewLogDraft({
                                      ...newLogDraft,
                                      result: e.target.value,
                                    })
                                  }
                                  placeholder="Kết quả đạt được (tuỳ chọn)"
                                  className="w-full text-[12px] p-2 rounded border border-[#dce9ff] bg-white"
                                />
                                <input
                                  type="text"
                                  value={newLogDraft.obstacle}
                                  onChange={(e) =>
                                    setNewLogDraft({
                                      ...newLogDraft,
                                      obstacle: e.target.value,
                                    })
                                  }
                                  placeholder="Vướng mắc (tuỳ chọn)"
                                  className="w-full text-[12px] p-2 rounded border border-[#dce9ff] bg-white"
                                />
                                <div className="flex items-center gap-2">
                                  <label className="text-[11px] font-semibold text-[#0b1c30] shrink-0">
                                    Tiến độ:
                                  </label>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={newLogDraft.progress}
                                    onChange={(e) =>
                                      setNewLogDraft({
                                        ...newLogDraft,
                                        progress: Number(e.target.value),
                                      })
                                    }
                                    className="flex-1 accent-[#004ac6]"
                                  />
                                  <span className="text-[12px] font-bold text-[#004ac6] w-12 text-right">
                                    {newLogDraft.progress}%
                                  </span>
                                </div>
                                <div className="flex justify-end gap-2 pt-1">
                                  <button
                                    onClick={() => setNewLogDraft(null)}
                                    type="button"
                                    className="px-2.5 py-1 text-[11px] font-semibold text-[#565e74] hover:bg-white rounded"
                                  >
                                    Hủy
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (
                                        !newLogDraft.description.trim() ||
                                        !onAddDailyLog
                                      )
                                        return;
                                      onAddDailyLog(
                                        sub.id,
                                        newLogDraft.description,
                                        newLogDraft.result || undefined,
                                        newLogDraft.obstacle || undefined,
                                        newLogDraft.progress,
                                      );
                                      setNewLogDraft(null);
                                    }}
                                    type="button"
                                    className="px-3 py-1 bg-[#006243] hover:bg-[#007d57] text-white text-[11px] font-bold rounded"
                                  >
                                    Lưu nhật ký
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Quick progress slider for the subtask */}
                            {onUpdateSubtaskProgress && canEditSubtask(currentUser, sub, formData) && (
                              <div className="flex items-center gap-2 pt-1 border-t border-[#e5eeff]">
                                <span className="text-[11px] text-[#565e74] shrink-0">
                                  Cập nhật nhanh:
                                </span>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={sub.progress}
                                  onChange={(e) =>
                                    onUpdateSubtaskProgress(
                                      sub.id,
                                      Number(e.target.value)
                                    )
                                  }
                                  className="flex-1 accent-[#004ac6] cursor-pointer"
                                />
                                <span className="text-[11px] font-bold text-[#004ac6] w-10 text-right">
                                  {sub.progress}%
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 10. History */}
          {itemHistory.length > 0 && (
            <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
                10. Lịch sử thao tác
              </label>
              <ul className="space-y-1.5">
                {itemHistory.map((h) => (
                  <li
                    key={h.id}
                    className="text-[12px] text-[#434655] flex items-start gap-2"
                  >
                    <span className="material-symbols-outlined text-[14px] text-[#004ac6] mt-0.5">
                      history
                    </span>
                    <div>
                      <div>{h.action}</div>
                      <div className="text-[10px] text-[#737686]">
                        — {h.userName} · {h.createdAt}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-3.5 bg-[#eff4ff] border-t border-[#dce9ff] flex items-center justify-between">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-1.5 bg-white border border-[#c3c6d7] hover:bg-[#f8f9ff] text-[13px] font-medium text-[#0b1c30] rounded transition-colors shadow-sm"
          >
            Đóng lại
          </button>
          <div className="flex items-center gap-2">
            {!canEdit ? (
              <span className="text-[11px] text-[#737686] italic px-3">
                {currentUser?.role === 'director' ? 'Đang xem (Chế độ read-only)' : 'Không có quyền chỉnh sửa'}
              </span>
            ) : isEditing ? (
              <button
                onClick={handleSave}
                type="button"
                className="px-4 py-1.5 bg-[#006243] hover:bg-[#007d57] text-white text-[13px] font-semibold rounded shadow-sm transition-colors"
              >
                Lưu thay đổi
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                type="button"
                className="px-4 py-1.5 bg-[#004ac6] hover:bg-[#2563eb] text-white text-[13px] font-semibold rounded shadow-sm transition-colors"
              >
                Chỉnh sửa nhanh
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};