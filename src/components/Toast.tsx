import React, { useCallback, useEffect, useRef, useState } from 'react';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

/** Lỗi cần thời gian đọc lâu hơn thông báo thành công. */
const DURATION_MS: Record<ToastType, number> = {
  success: 3500,
  info: 3500,
  warning: 6000,
  error: 8000,
};

const MAX_VISIBLE = 4;

/**
 * Hàng đợi toast: mỗi toast có timer riêng nên toast sau không tắt sớm toast trước.
 * Toast trùng nội dung đang hiển thị thì không thêm lần nữa.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = 'success') => {
      setToasts((prev) => {
        if (prev.some((x) => x.message === message && x.type === type)) return prev;
        const id = nextId.current++;
        timers.current.set(id, setTimeout(() => dismiss(id), DURATION_MS[type]));
        return [...prev, { id, message, type }].slice(-MAX_VISIBLE);
      });
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  return { toasts, show, dismiss };
}

const ICON: Record<ToastType, { name: string; cls: string }> = {
  success: { name: 'check_circle', cls: 'text-tertiary-fixed' },
  info: { name: 'info', cls: 'text-primary-fixed-dim' },
  warning: { name: 'warning', cls: 'text-warning-fixed' },
  error: { name: 'error', cls: 'text-error-fixed' },
};

export const ToastStack: React.FC<{ toasts: ToastItem[]; onDismiss: (id: number) => void }> = ({
  toasts,
  onDismiss,
}) => (
  <div className="fixed bottom-6 right-4 sm:right-6 z-[60] flex flex-col items-end gap-2 max-w-[calc(100vw-2rem)] print:hidden">
    {toasts.map((t) => (
      <div
        key={t.id}
        role={t.type === 'error' ? 'alert' : 'status'}
        aria-live={t.type === 'error' ? 'assertive' : 'polite'}
        className="flex items-start gap-2.5 bg-inverse-surface text-inverse-on-surface pl-4 pr-2 py-3 rounded-xl shadow-2xl w-[380px] max-w-full animate-slideUp"
      >
        <span aria-hidden="true" className={`material-symbols-outlined [--icon-size:20px] shrink-0 ${ICON[t.type].cls}`}>
          {ICON[t.type].name}
        </span>
        <span className="text-sm font-medium flex-1 pt-px">{t.message}</span>
        <button
          type="button"
          onClick={() => onDismiss(t.id)}
          aria-label="Đóng thông báo"
          className="w-7 h-7 -my-1 rounded-md flex items-center justify-center shrink-0 opacity-70 hover:opacity-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
        >
          <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">close</span>
        </button>
      </div>
    ))}
  </div>
);
