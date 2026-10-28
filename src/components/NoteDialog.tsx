import React, { useState } from 'react';
import { Dialog, ghostButtonCls, labelCls, primaryButtonCls, textareaCls } from './ui/Dialog';
import { FilePicker } from './ui/FilePicker';

export interface NoteRequest {
  title: string;
  taskCode: string;
  taskTitle: string;
  /** Nhãn ô ghi chú, vd "Ghi chú cho người duyệt". */
  label: string;
  placeholder?: string;
  /** Bắt buộc nhập nội dung (vd lý do trả về). */
  required?: boolean;
  confirmLabel: string;
}

/**
 * Hộp thoại ghi chú + tệp đính kèm cho 1 thao tác đổi trạng thái. Ghi chú thành 1 tin
 * trong luồng "Trao đổi" của việc. Chỉ đóng khi `onSubmit` resolve true (server đã lưu).
 */
export const NoteDialog: React.FC<{
  request: NoteRequest | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string, files: File[]) => Promise<boolean>;
}> = ({ request, busy, onClose, onSubmit }) => {
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const key = request ? `${request.title}:${request.taskCode}` : '';
  const [lastKey, setLastKey] = useState('');
  if (key !== lastKey) {
    setLastKey(key);
    setNote('');
    setFiles([]);
  }
  if (!request) return null;
  const missing = !!request.required && !note.trim();

  return (
    <Dialog isOpen onClose={onClose} title={request.title} dismissible={!busy}>
      <form
        className="p-5 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (missing || busy) return;
          if (await onSubmit(note.trim(), files)) onClose();
        }}
      >
        <div className="text-sm">
          <span className="font-mono text-xs text-secondary mr-2">{request.taskCode}</span>
          <span className="font-semibold text-on-surface">{request.taskTitle}</span>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>
            {request.label} {request.required ? '(bắt buộc)' : '(không bắt buộc)'}
          </span>
          <textarea
            data-autofocus
            rows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={request.placeholder}
            aria-invalid={missing}
            className={textareaCls}
          />
          <span className="text-xs text-secondary">Ghi chú và tệp được lưu vào mục Trao đổi của việc, kèm ngày giờ.</span>
        </label>
        <FilePicker files={files} onChange={setFiles} disabled={busy} />
        <div className="flex justify-end gap-2 pt-3 border-t border-surface-container-low">
          <button type="button" onClick={onClose} disabled={busy} className={ghostButtonCls}>
            Huỷ
          </button>
          <button type="submit" disabled={busy || missing} className={primaryButtonCls}>
            {busy ? 'Đang gửi…' : request.confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
