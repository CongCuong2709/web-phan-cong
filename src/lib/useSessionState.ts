import { useEffect, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * useState được giữ trong sessionStorage của tab: sống qua đổi tab trong app
 * và F5, mất khi đóng tab. Storage bị chặn (private mode…) thì chạy như useState.
 */
export function useSessionState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage không khả dụng — giữ trong bộ nhớ */
    }
  }, [key, value]);

  return [value, setValue] as const;
}

/** Cảnh báo của trình duyệt khi đóng/tải lại tab lúc còn dữ liệu chưa lưu. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
