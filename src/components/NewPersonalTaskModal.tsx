import React, { useState } from 'react';
import { DEPARTMENT_LABEL, User } from '../types';

interface NewPersonalTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (title: string, deadline: string, notes: string) => void;
  currentUser: User;
}

/** Fix UI-06: format Date thành chuỗi dd/MM theo local timezone. */
function formatDdMm(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/** Lấy thứ Hai của tuần chứa d (start-of-week theo ISO). */
function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay() === 0 ? 7 : out.getDay(); // CN=0 → 7
  out.setDate(out.getDate() - (day - 1));
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Lấy Chủ nhật cuối cùng của tuần chứa d (end-of-week theo ISO). */
function endOfWeek(d: Date): Date {
  const out = startOfWeek(d);
  out.setDate(out.getDate() + 6);
  return out;
}

export const NewPersonalTaskModal: React.FC<NewPersonalTaskModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  currentUser,
}) => {
  const [taskName, setTaskName] = useState('');
  const [dueOption, setDueOption] = useState('today');
  const [notes, setNotes] = useState('');
  const departmentName = currentUser.departments[0]
    ? DEPARTMENT_LABEL[currentUser.departments[0]]
    : 'Cá nhân';
  const bundleName = `Việc riêng • ${currentUser.username.toUpperCase()}`;

  if (!isOpen) return null;

  // Fix UI-06: deadline text được tính động từ ngày thực tế thay vì hardcode.
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = endOfWeek(now);

  const deadlineText =
    dueOption === 'today'
      ? 'Hôm nay (Hạn: 17:00)'
      : dueOption === 'tomorrow'
      ? `Ngày mai (${formatDdMm(tomorrow)})`
      : `Trong tuần này (${formatDdMm(weekEnd)})`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName.trim()) return;

    onAdd(taskName, deadlineText, notes);
    setTaskName('');
    setNotes('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-[#e5eeff] overflow-hidden flex flex-col">
        <div className="p-4 bg-[#eff4ff] flex items-center justify-between border-b border-[#dce9ff]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#004ac6] text-[22px]">
              note_add
            </span>
            <h4 className="text-[16px] font-bold text-[#0b1c30]">
              Tạo thêm việc cá nhân
            </h4>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#565e74] hover:bg-[#dce9ff]"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-bold text-[#0b1c30]">
              Tên việc cần làm *
            </label>
            <input
              type="text"
              required
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Ví dụ: Gọi điện xác nhận số lượng bàn ghế..."
              className="w-full h-10 px-3 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-[#0b1c30]">
                Khi nào cần xong?
              </label>
              <select
                value={dueOption}
                onChange={(e) => setDueOption(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
              >
                <option value="today">Hôm nay</option>
                <option value="tomorrow">Ngày mai</option>
                <option value="this_week">Trong tuần này</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-[#0b1c30]">
                Thuộc dự án / gói việc
              </label>
              <input
                type="text"
                disabled
                value={bundleName}
                className="w-full h-10 px-3 rounded-lg bg-[#f1f5f9] text-[#565e74] text-[13px] border border-[#dce9ff]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-bold text-[#0b1c30]">
              Ghi chú hoặc kết quả mong muốn
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú ngắn để bạn không bị quên..."
              className="w-full p-2.5 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#eff4ff]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-[#565e74] hover:bg-[#eff4ff] rounded-lg text-[12px] font-semibold"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#004ac6] hover:bg-[#2563eb] text-white rounded-lg text-[13px] font-bold shadow-sm"
            >
              Lưu việc vào danh sách
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
