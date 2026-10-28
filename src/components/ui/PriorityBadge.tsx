import React from 'react';
import type { TaskPriority } from '../../types';
import { PRIORITY_VI } from '../../lib/transforms';

const TONE: Record<TaskPriority, string> = {
  critical: 'bg-error-container text-on-error-container border-error-fixed',
  high: 'bg-warning-container text-on-warning-container border-warning-fixed',
  normal: 'bg-surface-container-low text-secondary border-surface-container-high',
  low: 'bg-surface text-outline border-surface-container',
};

const ICON: Partial<Record<TaskPriority, string>> = { critical: 'priority_high', high: 'keyboard_double_arrow_up' };

/** Nhãn mức ưu tiên. `hideNormal` để bảng đỡ rối: chỉ việc khác "Bình thường" mới có nhãn. */
export const PriorityBadge: React.FC<{ priority: TaskPriority; hideNormal?: boolean }> = ({ priority, hideNormal }) => {
  if (hideNormal && priority === 'normal') return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${TONE[priority]}`}
    >
      {ICON[priority] && (
        <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px]">{ICON[priority]}</span>
      )}
      <span className="sr-only">Ưu tiên </span>
      {PRIORITY_VI[priority]}
    </span>
  );
};
