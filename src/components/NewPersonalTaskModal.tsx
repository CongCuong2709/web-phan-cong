import React, { useState } from 'react';
import { User } from '../types';
import { todayIso } from '../lib/transforms';
import { Dialog, ghostButtonCls, inputCls, labelCls, primaryButtonCls, textareaCls } from './ui/Dialog';

interface NewPersonalTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolve true khi server đã tạo xong — modal chỉ đóng khi đó. */
  onAdd: (title: string, endDate: string, notes: string) => Promise<boolean>;
  currentUser: User;
}

type DueOption = 'today' | 'tomorrow' | 'this_week';

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Hạn chót (YYYY-MM-DD) theo lựa chọn; "trong tuần" = Chủ nhật của tuần hiện tại. */
function dueDate(option: DueOption): string {
  const d = new Date();
  if (option === 'tomorrow') d.setDate(d.getDate() + 1);
  if (option === 'this_week') d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return option === 'today' ? todayIso() : toIso(d);
}

function formatDdMm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export const NewPersonalTaskModal: React.FC<NewPersonalTaskModalProps> = ({ isOpen, onClose, onAdd }) => {
  const [taskName, setTaskName] = useState('');
  const [dueOption, setDueOption] = useState<DueOption>('today');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const endDate = dueDate(dueOption);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (await onAdd(taskName, endDate, notes)) {
        setTaskName('');
        setNotes('');
        setDueOption('today');
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Tạo thêm việc cá nhân" icon="note_add" dismissible={!submitting}>
      <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="personal-task-name" className={labelCls}>
            Tên việc cần làm *
          </label>
          <input
            id="personal-task-name"
            data-autofocus
            type="text"
            required
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="Ví dụ: Gọi điện xác nhận số lượng bàn ghế..."
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="personal-task-due" className={labelCls}>
            Khi nào cần xong?
          </label>
          <select
            id="personal-task-due"
            value={dueOption}
            onChange={(e) => setDueOption(e.target.value as DueOption)}
            className={inputCls}
          >
            <option value="today">Hôm nay ({formatDdMm(dueDate('today'))})</option>
            <option value="tomorrow">Ngày mai ({formatDdMm(dueDate('tomorrow'))})</option>
            <option value="this_week">Trong tuần này ({formatDdMm(dueDate('this_week'))})</option>
          </select>
          <p className="text-xs text-secondary">Việc cá nhân không thuộc hạng mục nào và chỉ bạn nhìn thấy trong "Việc của tôi".</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="personal-task-notes" className={labelCls}>
            Ghi chú hoặc kết quả mong muốn
          </label>
          <textarea
            id="personal-task-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ghi chú ngắn..."
            className={textareaCls}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-surface-container-low">
          <button type="button" onClick={onClose} disabled={submitting} className={ghostButtonCls}>
            Hủy bỏ
          </button>
          <button type="submit" disabled={submitting || !taskName.trim()} className={primaryButtonCls}>
            {submitting ? 'Đang lưu…' : 'Lưu việc vào danh sách'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
