import React, { useState, useEffect } from 'react';
import { TierItem, TierLevel, User } from '../types';
import { todayIso } from '../lib/transforms';
import { Dialog, ghostButtonCls, inputCls, labelCls, primaryButtonCls, textareaCls } from './ui/Dialog';

interface NewItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolve true khi server đã tạo xong — modal chỉ đóng khi đó. */
  onAddItem: (item: Partial<TierItem>) => Promise<boolean>;
  parents: { id: string; title: string; tier: TierLevel }[];
  currentUser: User;
  /** Danh sách users cùng phòng ban (dùng cho dropdown owner) */
  deptUsers?: { username: string; fullname: string }[];
  /**
   * 'plan'   — tạo mục trong cây (chọn tầng, mặc định người phụ trách là mình).
   * 'assign' — giao việc cho người khác: luôn là đầu việc T4, bắt buộc chọn người làm.
   */
  mode?: 'plan' | 'assign';
}

const TIER_OPTIONS: { lvl: TierLevel; label: string; code: string }[] = [
  { lvl: 1, label: 'Dự án', code: 'T1' },
  { lvl: 2, label: 'Giai đoạn', code: 'T2' },
  { lvl: 3, label: 'Hạng mục', code: 'T3' },
  { lvl: 4, label: 'Đầu việc', code: 'T4' },
];

/** Class tĩnh — Tailwind không sinh được class ghép chuỗi động như `grid-cols-${n}`. */
const GRID_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

/** Tầng được tạo theo vai trò — khớp `canCreateTiers` ở backend/lib/policies.js. */
function allowedTiersFor(role: User['role']): TierLevel[] {
  switch (role) {
    case 'admin': return [1, 2, 3, 4];
    case 'director': return [1, 2];
    case 'manager': return [3, 4];
    default: return [4];
  }
}

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export const NewItemModal: React.FC<NewItemModalProps> = ({
  isOpen,
  onClose,
  onAddItem,
  parents,
  currentUser,
  deptUsers = [],
  mode = 'plan',
}) => {
  const assign = mode === 'assign';
  const allowedTiers: TierLevel[] = assign ? [4] : allowedTiersFor(currentUser.role);
  const defaultTier = allowedTiers[allowedTiers.length - 1];

  const [tier, setTier] = useState<TierLevel>(defaultTier);
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [ownerUsername, setOwnerUsername] = useState(currentUser.username);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDays(todayIso(), 30));
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TierItem['priority']>('Trung bình');
  const [submitting, setSubmitting] = useState(false);

  // Mở modal là bắt đầu một form mới.
  useEffect(() => {
    if (!isOpen) return;
    setTier(defaultTier);
    setTitle('');
    setParentId('');
    setOwnerUsername(assign ? '' : currentUser.username);
    setStartDate(todayIso());
    setEndDate(plusDays(todayIso(), 30));
    setDescription('');
    setPriority('Trung bình');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const parentOptions = parents.filter((p) => p.tier === tier - 1);
  // T2, T3 bắt buộc có cha; T4 được phép độc lập.
  const parentRequired = tier === 2 || tier === 3;
  const dateRangeError = startDate > endDate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || dateRangeError || submitting) return;
    if (parentRequired && !parentId) return;
    if (!ownerUsername) return;
    setSubmitting(true);
    try {
      const ok = await onAddItem({
        tier,
        title,
        parentId: tier > 1 && parentId ? parentId : undefined,
        ownerUsername,
        department: currentUser.departments[0],
        startDate,
        endDate,
        priority,
        description,
        managementNotes: `Tạo bởi ${currentUser.fullname}.`,
      });
      if (ok) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={assign ? 'Giao việc' : 'Thêm công việc mới'}
      icon="add_task"
      dismissible={!submitting}
    >
      <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
        {!assign && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className={`${labelCls} mb-1.5`}>Chọn cấp tầng quản lý *</legend>
          <div className={`grid gap-1.5 p-1 bg-surface-container-low rounded-lg ${GRID_COLS[allowedTiers.length]}`}>
            {TIER_OPTIONS.filter((opt) => allowedTiers.includes(opt.lvl)).map((opt) => (
              <button
                key={opt.lvl}
                type="button"
                aria-pressed={tier === opt.lvl}
                onClick={() => {
                  setTier(opt.lvl);
                  setParentId('');
                }}
                className={`py-1.5 px-1 text-xs font-bold rounded transition-colors flex flex-col items-center leading-tight ${
                  tier === opt.lvl ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-on-surface'
                }`}
              >
                <span className="opacity-70">{opt.code}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-item-title" className={labelCls}>
            Tên công việc / Hạng mục *
          </label>
          <input
            id="new-item-title"
            data-autofocus
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Triển khai kiểm thử bảo mật..."
            className={inputCls}
          />
        </div>

        {tier > 1 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-item-parent" className={labelCls}>
              Thuộc mục cấp trên (Tầng {tier - 1}){parentRequired ? ' *' : ''}
            </label>
            <select
              id="new-item-parent"
              value={parentId}
              required={parentRequired}
              onChange={(e) => setParentId(e.target.value)}
              className={inputCls}
            >
              <option value="">{parentRequired ? '-- Chọn mục cha --' : '-- Không thuộc hạng mục nào --'}</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            {parentRequired && parentOptions.length === 0 && (
              <p className="text-xs text-error font-semibold">
                Chưa có mục Tầng {tier - 1} nào bạn được xem — cần tạo mục cấp trên trước.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-item-owner" className={labelCls}>
              {assign ? 'Người làm *' : 'Người phụ trách'}
            </label>
            {assign || deptUsers.length > 1 ? (
              <select
                id="new-item-owner"
                value={ownerUsername}
                required
                onChange={(e) => setOwnerUsername(e.target.value)}
                className={inputCls}
              >
                {assign && <option value="">-- Chọn người làm --</option>}
                {deptUsers.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.fullname}
                  </option>
                ))}
              </select>
            ) : (
              <input id="new-item-owner" type="text" value={currentUser.fullname} disabled className={inputCls} />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-item-priority" className={labelCls}>
              Mức ưu tiên
            </label>
            <select
              id="new-item-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TierItem['priority'])}
              className={inputCls}
            >
              <option value="Cao (Critical Path)">Cao (đường găng)</option>
              <option value="Trung bình">Trung bình</option>
              <option value="Thấp">Thấp</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-item-start" className={labelCls}>
              Ngày bắt đầu *
            </label>
            <input
              id="new-item-start"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-item-end" className={labelCls}>
              Hạn hoàn thành *
            </label>
            <input
              id="new-item-end"
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-invalid={dateRangeError}
              aria-describedby={dateRangeError ? 'new-item-date-error' : undefined}
              className={inputCls}
            />
          </div>
          {dateRangeError && (
            <p id="new-item-date-error" role="alert" className="col-span-2 text-xs text-error font-semibold">
              Ngày bắt đầu phải trước hoặc bằng hạn hoàn thành.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-item-desc" className={labelCls}>
            Mô tả & Phạm vi
          </label>
          <textarea
            id="new-item-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Mục tiêu bàn giao chính..."
            className={textareaCls}
          />
        </div>

        <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-surface-container-low">
          <button type="button" onClick={onClose} disabled={submitting} className={ghostButtonCls}>
            Hủy bỏ
          </button>
          <button
            type="submit"
            disabled={submitting || dateRangeError || !title.trim() || (parentRequired && !parentId) || !ownerUsername}
            className={primaryButtonCls}
          >
            {submitting ? 'Đang lưu…' : assign ? 'Giao việc' : 'Lưu công việc'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
