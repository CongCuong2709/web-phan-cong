import React, { useId, useRef, useState } from 'react';
import { FILE_ACCEPT, FILE_RULES_TEXT, MAX_FILES_PER_SEND, fileError, fileIcon, formatBytes } from '../../lib/attachments';

/**
 * Chọn tệp đính kèm trước khi gửi (chưa tải lên). Tệp sai định dạng / quá lớn bị
 * loại ngay và báo lỗi tại chỗ; tệp hợp lệ hiện thành danh sách có nút bỏ.
 */
export const FilePicker: React.FC<{
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}> = ({ files, onChange, disabled, label = 'Đính kèm tệp' }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [errors, setErrors] = useState<string[]>([]);

  const add = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    const errs: string[] = [];
    for (const f of Array.from(picked)) {
      const err = fileError(f);
      if (err) errs.push(err);
      else if (next.length >= MAX_FILES_PER_SEND) errs.push(`Mỗi lần gửi tối đa ${MAX_FILES_PER_SEND} tệp — ${f.name} chưa được thêm.`);
      else if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setErrors(errs);
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-describedby={hintId}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-surface-container-high bg-white text-xs font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-60"
        >
          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">attach_file</span>
          {label}
        </button>
        <span id={hintId} className="text-xs text-secondary">{FILE_RULES_TEXT}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => add(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}`}
              className="flex items-center gap-2 px-2 py-1 rounded-md bg-surface-container-low text-xs text-on-surface"
            >
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px] text-primary">{fileIcon(f.name)}</span>
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-secondary shrink-0">{formatBytes(f.size)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`Bỏ tệp ${f.name}`}
                className="w-6 h-6 rounded inline-flex items-center justify-center text-secondary hover:bg-surface-container-high"
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">close</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="text-xs text-error font-semibold flex flex-col gap-0.5">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  );
};
