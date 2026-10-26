import React, { useEffect, useId, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hành vi chuẩn của lớp phủ modal: Esc để đóng, Tab không thoát ra ngoài,
 * focus vào phần tử đầu tiên khi mở và trả focus về chỗ cũ khi đóng.
 */
function useModalBehavior(panelRef: React.RefObject<HTMLElement | null>, onClose: () => void, enabled: boolean) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [enabled, panelRef]);
}

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  icon?: string;
  /** 'center' cho modal form, 'drawer' cho panel trượt bên phải. */
  variant?: 'center' | 'drawer';
  /** Chặn đóng (Esc / nền / nút X) khi đang gửi dữ liệu. */
  dismissible?: boolean;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  variant = 'center',
  dismissible = true,
  headerExtra,
  children,
  className = '',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const requestClose = () => {
    if (dismissible) onClose();
  };
  useModalBehavior(panelRef, requestClose, isOpen);

  if (!isOpen) return null;

  const isDrawer = variant === 'drawer';
  return (
    <div className={`fixed inset-0 z-50 ${isDrawer ? '' : 'flex items-center justify-center p-4'}`}>
      <div aria-hidden="true" className="absolute inset-0 bg-on-surface/40" onClick={requestClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative bg-white shadow-2xl flex flex-col focus:outline-none ${
          isDrawer
            ? 'ml-auto h-full w-full sm:w-[480px] border-l border-surface-container animate-slideUp'
            : 'w-full max-w-lg max-h-[calc(100vh-2rem)] rounded-xl border border-surface-container overflow-hidden'
        } ${className}`}
      >
        <div className="px-4 py-3 bg-surface-container-low flex items-center justify-between gap-3 border-b border-surface-container-high shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {icon && (
              <span aria-hidden="true" className="material-symbols-outlined text-primary [--icon-size:22px]">
                {icon}
              </span>
            )}
            <h2 id={titleId} className="text-base font-bold text-on-surface truncate">
              {title}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {headerExtra}
            <button
              type="button"
              onClick={requestClose}
              disabled={!dismissible}
              aria-label="Đóng (Esc)"
              title="Đóng (Esc)"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
            >
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:20px]">close</span>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

/** Class dùng chung cho ô nhập / nút — một nguồn thay cho các chuỗi class chép tay.
 *  Kích thước tách khỏi kiểu dáng để không phải ghi đè class (không dùng `!important`). */
const FIELD_BASE =
  'rounded-lg bg-surface-container-low text-on-surface text-sm border border-surface-container-high placeholder:text-outline focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary disabled:bg-surface-container disabled:text-secondary';

export const inputCls = `w-full h-10 px-3 ${FIELD_BASE}`;
/** Ô nhập thấp cho thanh công cụ (lọc, tìm kiếm); độ rộng do nơi dùng quyết định. */
export const compactInputCls = `h-9 px-3 ${FIELD_BASE}`;
export const textareaCls = `w-full p-2.5 ${FIELD_BASE}`;

export const labelCls = 'text-xs font-bold text-on-surface';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed';
const PRIMARY = 'bg-primary hover:bg-primary-container text-on-primary font-bold shadow-sm';
const GHOST = 'text-secondary hover:bg-surface-container-low font-semibold';
const OUTLINE = 'bg-white text-on-surface border border-surface-container-high hover:bg-surface-container-low font-semibold';

export const primaryButtonCls = `${BUTTON_BASE} ${PRIMARY} px-4 py-2 text-sm`;
export const ghostButtonCls = `${BUTTON_BASE} ${GHOST} px-4 py-2 text-sm`;
/** Nút nhỏ cho thao tác trong dòng danh sách / bảng. */
export const smallPrimaryButtonCls = `${BUTTON_BASE} ${PRIMARY} px-3 py-1.5 text-xs`;
export const smallOutlineButtonCls = `${BUTTON_BASE} ${OUTLINE} px-3 py-1.5 text-xs`;
