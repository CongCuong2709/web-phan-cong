import React from 'react';

interface ToastProps {
  message: string | null;
  type?: 'success' | 'info' | 'warning';
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'success' }) => {
  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-[#0b1c30] text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 animate-slideUp">
      <span
        className={`material-symbols-outlined text-[20px] ${
          type === 'success'
            ? 'text-[#85f8c4]'
            : type === 'warning'
            ? 'text-amber-400'
            : 'text-sky-300'
        }`}
      >
        {type === 'success'
          ? 'check_circle'
          : type === 'warning'
          ? 'warning'
          : 'info'}
      </span>
      <span className="text-[13px] font-medium">{message}</span>
    </div>
  );
};
