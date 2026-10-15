import React, { useState, useEffect, useMemo } from 'react';
import {
  TierItem,
  DailyLog,
  HistoryEntry,
  User,
} from '../types';
import {
  canEditTierItem,
  canAddDailyLog,
} from '../auth/permissions';

interface DetailsDrawerProps {
  item: TierItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateItem: (updated: TierItem) => void;
  dailyLogs?: DailyLog[];
  history?: HistoryEntry[];
  /** Fix TD-07: cần truyền allTierItems để compute descendants khi filter history. */
  allTierItems?: TierItem[];
  /**
   * Phase E: gọi khi user ghi nhật ký thi công cho task (T4). Tham số đầu
   * tiên là taskId (composite '<tier>-<num>'), không còn qua subtask.
   */
  onAddDailyLog?: (
    taskId: string,
    description: string,
    result?: string,
    obstacle?: string,
    progress?: number
  ) => void;
  /** Người đang đăng nhập — dùng để kiểm tra quyền edit */
  currentUser?: User;
}


export const DetailsDrawer: React.FC<DetailsDrawerProps> = ({
  item,
  isOpen,
  onClose,
  onUpdateItem,
  dailyLogs = [],
  history = [],
  allTierItems = [],
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

  const [newLogDraft, setNewLogDraft] = useState<{
    description: string;
    result: string;
    obstacle: string;
    progress: number;
  } | null>(null);

  useEffect(() => {
    setFormData(item ? JSON.parse(JSON.stringify(item)) : null);
    setIsEditing(false);
    setNewLogDraft(null);
  }, [item]);

  // 2026-10: re-compute daysRemaining khi endDate thay đổi (transforms.ts chỉ tính
  // lúc load; user thủ công đổi date trong form cần update real-time).
  const liveDaysRemaining = useMemo(() => {
    if (!formData?.endDate) return undefined;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(formData.endDate);
    if (!m) return undefined;
    const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((end.getTime() - now.getTime()) / 86400000);
  }, [formData?.endDate]);

  const itemLogs = useMemo(() => {
    if (!formData || formData.tier !== 4) return [];
    return dailyLogs
      .filter((l) => l.taskId === formData.id)
      .sort((a, b) => (a.logDate < b.logDate ? 1 : -1));
  }, [dailyLogs, formData]);

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

  // Phase F: bỏ handleToggleDeliverable (bảng task_deliverables đã xoá).
  // Tiến độ task giờ update qua daily_log.progress (xem routes/dailyLogs.js).

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

          {/* 2. Lịch trình (start → end) */}
          <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
              2. Lịch trình
            </label>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 text-[12px] text-[#434655]">
                <span className="text-[10px] font-semibold text-[#737686] uppercase">Từ</span>
                <span className="font-mono font-semibold text-[#0b1c30]">
                  {formData.startDate || '—'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-[#434655]">
                <span className="text-[10px] font-semibold text-[#737686] uppercase">Đến</span>
                <span className="font-mono font-bold text-[14px] text-[#0b1c30]">
                  {formData.endDate || '—'}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-end">
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                  liveDaysRemaining !== undefined && liveDaysRemaining < 0
                    ? 'bg-red-50 text-[#ba1a1a] border-red-200'
                    : 'bg-emerald-50 text-[#006243] border-emerald-200'
                }`}
              >
                {liveDaysRemaining === undefined
                  ? 'Đúng hạn'
                  : liveDaysRemaining === 0
                  ? 'Đến hạn hôm nay'
                  : liveDaysRemaining < 0
                  ? `Quá hạn ${Math.abs(liveDaysRemaining)} ngày`
                  : `Còn ${liveDaysRemaining} ngày`}
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

          {/* 7. Blocker Note (chỉ T4) — Phase F: thay cho helpMessage 1:N cũ */}
          {formData.tier === 4 && (
            <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider block mb-1.5">
                7. Vướng mắc (NV báo cáo)
              </label>
              {isEditing ? (
                <textarea
                  value={formData.blockerNote || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, blockerNote: e.target.value })
                  }
                  className="w-full text-[13px] bg-[#f8f9ff] border border-[#c3c6d7] rounded p-2 focus:outline-none focus:border-[#004ac6]"
                  rows={2}
                  placeholder="NV sẽ viết vướng mắc ở đây qua nút Báo cáo vướng mắc trong Việc của tôi"
                />
              ) : (
                <p className="text-[13px] text-[#434655] leading-relaxed">
                  {formData.blockerNote || (
                    <span className="italic text-[#737686]">Chưa có báo cáo vướng mắc nào.</span>
                  )}
                </p>
              )}
            </div>
          )}

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

          {/* 9. NHẬT KÝ THI CÔNG (chỉ T4) — Phase E: gắn trực tiếp vào task, không qua subtask */}
          {formData.tier === 4 && (
            <div className="bg-white p-3.5 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-[#565e74] uppercase tracking-wider">
                  9. Nhật ký thi công
                </label>
                <span className="text-[11px] font-mono text-[#004ac6] font-semibold">
                  {itemLogs.length} mục
                </span>
              </div>

              {itemLogs.length === 0 ? (
                <p className="text-[12px] text-[#737686] italic">
                  Đầu việc này chưa có nhật ký thi công nào.
                </p>
              ) : (
                <ul className="space-y-2">
                  {itemLogs.map((log) => (
                    <li
                      key={log.id}
                      className="bg-[#f8f9ff] border border-[#e5eeff] rounded p-2.5"
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

              {/* Form thêm nhật ký (inline) */}
              {onAddDailyLog && canAddDailyLog(currentUser, formData) && (
                newLogDraft ? (
                  <div className="bg-[#eff4ff] border border-[#dce9ff] rounded p-2.5 space-y-2 mt-2">
                    <textarea
                      value={newLogDraft.description}
                      onChange={(e) =>
                        setNewLogDraft({ ...newLogDraft, description: e.target.value })
                      }
                      rows={2}
                      placeholder="Mô tả công việc hôm nay…"
                      className="w-full text-[12px] p-2 rounded border border-[#dce9ff] bg-white"
                    />
                    <input
                      type="text"
                      value={newLogDraft.result}
                      onChange={(e) =>
                        setNewLogDraft({ ...newLogDraft, result: e.target.value })
                      }
                      placeholder="Kết quả đạt được (tuỳ chọn)"
                      className="w-full text-[12px] p-2 rounded border border-[#dce9ff] bg-white"
                    />
                    <input
                      type="text"
                      value={newLogDraft.obstacle}
                      onChange={(e) =>
                        setNewLogDraft({ ...newLogDraft, obstacle: e.target.value })
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
                          setNewLogDraft({ ...newLogDraft, progress: Number(e.target.value) })
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
                          if (!newLogDraft.description.trim() || !onAddDailyLog) return;
                          onAddDailyLog(
                            formData.id,
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
                ) : (
                  <button
                    onClick={() =>
                      setNewLogDraft({
                        description: '',
                        result: '',
                        obstacle: '',
                        progress: formData.progress ?? 0,
                      })
                    }
                    className="mt-2 text-[11px] font-bold text-[#004ac6] hover:text-[#2563eb] flex items-center gap-1"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[14px]">add</span>
                    Thêm nhật ký
                  </button>
                )
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