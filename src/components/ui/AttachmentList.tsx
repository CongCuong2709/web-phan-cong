import React, { useState } from 'react';
import { api, describeApiError, type AttachmentDto } from '../../lib/apiClient';
import { fileIcon, formatBytes, saveBlob } from '../../lib/attachments';
import { formatDateTime } from '../../lib/transforms';

/**
 * Danh sách tệp đã lưu trên máy chủ. Tải xuống đi qua API (cần token) rồi lưu bằng blob.
 * `onDelete` chỉ truyền cho tệp người xem được xoá; resolve true khi server đã xoá.
 */
export const AttachmentList: React.FC<{
  items: AttachmentDto[];
  /** Hiện người tải + thời điểm dưới tên tệp. */
  showMeta?: boolean;
  canDelete?: (a: AttachmentDto) => boolean;
  onDelete?: (a: AttachmentDto) => Promise<boolean>;
}> = ({ items, showMeta = false, canDelete, onDelete }) => {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (a: AttachmentDto) => {
    setBusyId(a.id);
    setError(null);
    try {
      const r = await api.downloadAttachment(a.id);
      if (r.ok) saveBlob(r.data, a.original_name);
      else setError(`Không tải được ${a.original_name}: ${describeApiError(r)}`);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (a: AttachmentDto) => {
    if (!onDelete || !window.confirm(`Xoá tệp "${a.original_name}"? Thao tác này không hoàn tác được.`)) return;
    setBusyId(a.id);
    try {
      await onDelete(a);
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {items.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-surface-container bg-white text-xs"
          >
            <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px] text-primary shrink-0">
              {fileIcon(a.original_name)}
            </span>
            <button
              type="button"
              onClick={() => download(a)}
              disabled={busyId !== null}
              title="Tải xuống"
              className="min-w-0 flex-1 text-left disabled:opacity-60"
            >
              <span className="block truncate font-semibold text-primary hover:underline">{a.original_name}</span>
              {showMeta && (
                <span className="block text-secondary">
                  {a.uploader_fullname ?? '—'} · {formatDateTime(a.created_at)}
                </span>
              )}
            </button>
            <span className="text-secondary shrink-0">{busyId === a.id ? 'Đang xử lý…' : formatBytes(a.size_bytes)}</span>
            {onDelete && canDelete?.(a) && (
              <button
                type="button"
                onClick={() => remove(a)}
                disabled={busyId !== null}
                aria-label={`Xoá tệp ${a.original_name}`}
                title="Xoá tệp"
                className="w-6 h-6 rounded inline-flex items-center justify-center text-secondary hover:bg-error-container hover:text-on-error-container shrink-0"
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">delete</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-error font-semibold">{error}</p>}
    </div>
  );
};
