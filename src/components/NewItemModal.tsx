import React, { useState, useEffect, useMemo } from 'react';
import { DEPARTMENT_LABEL, TierItem, TierLevel, User } from '../types';
import { PRIORITY_OPTIONS, PRIORITY_VI, todayIso } from '../lib/transforms';
import { canCreateUnder, creatableTiers } from '../auth/permissions';
import { Dialog, ghostButtonCls, inputCls, labelCls, primaryButtonCls, textareaCls } from './ui/Dialog';
import { FilePicker } from './ui/FilePicker';

interface NewItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolve true khi server đã tạo xong — modal chỉ đóng khi đó. Tệp gắn vào mục vừa tạo. */
  onAddItem: (item: Partial<TierItem>, files: File[]) => Promise<boolean>;
  /** Mọi mục đang hoạt động — modal tự lọc mục cha user được tạo con bên dưới. */
  parents: TierItem[];
  currentUser: User;
  /** Danh bạ (có id thật) để chọn người phụ trách theo tầng. */
  users: User[];
  /**
   * 'plan'   — tạo mục trong cây (chọn tầng theo vai trò).
   * 'assign' — giao việc: luôn là đầu việc T4, bắt buộc chọn người làm.
   */
  mode?: 'plan' | 'assign';
}

const TIER_OPTIONS: { lvl: TierLevel; label: string; code: string }[] = [
  { lvl: 1, label: 'Dự án', code: 'T1' },
  { lvl: 2, label: 'Giai đoạn', code: 'T2' },
  { lvl: 3, label: 'Hạng mục', code: 'T3' },
  { lvl: 4, label: 'Đầu việc', code: 'T4' },
];
const TIER_LABEL: Record<TierLevel, string> = { 1: 'dự án', 2: 'giai đoạn', 3: 'hạng mục', 4: 'đầu việc' };

/** Class tĩnh — Tailwind không sinh được class ghép chuỗi động như `grid-cols-${n}`. */
const GRID_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** dd/mm/yyyy */
function viDate(iso: string): string {
  return iso ? iso.split('-').reverse().join('/') : '';
}

/**
 * Người được chọn làm phụ trách theo tầng — khớp policy `task:assign` ở backend/lib/policies.js.
 *   T1: Điều hành. T3: Trưởng phòng. T4: Trưởng phòng phụ trách hạng mục hoặc nhân viên phòng của hạng mục.
 */
function ownerCandidates(tier: TierLevel, parent: TierItem | undefined, users: User[]): User[] {
  if (tier === 1) return users.filter((u) => u.role === 'director');
  if (tier === 3) return users.filter((u) => u.role === 'manager');
  if (tier === 4 && parent) {
    return users.filter(
      (u) =>
        u.id === parent.ownerUserId ||
        (u.role === 'employee' && !!parent.department && u.departments.includes(parent.department)),
    );
  }
  return [];
}

const OWNER_LABEL: Record<TierLevel, string> = {
  1: 'Điều hành phụ trách',
  2: 'Điều hành phụ trách',
  3: 'Trưởng phòng phụ trách',
  4: 'Người làm',
};

export const NewItemModal: React.FC<NewItemModalProps> = ({
  isOpen,
  onClose,
  onAddItem,
  parents,
  currentUser,
  users,
  mode = 'plan',
}) => {
  const assign = mode === 'assign';
  const allowedTiers: TierLevel[] = assign ? [4] : creatableTiers(currentUser.role);
  const defaultTier = allowedTiers[allowedTiers.length - 1] ?? 4;

  const [tier, setTier] = useState<TierLevel>(defaultTier);
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [department, setDepartment] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDays(todayIso(), 30));
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TierItem['priority']>('normal');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Mở modal là bắt đầu một form mới.
  useEffect(() => {
    if (!isOpen) return;
    setTier(defaultTier);
    setTitle('');
    setParentId('');
    setOwnerUserId('');
    setDepartment('');
    setStartDate(todayIso());
    setEndDate(plusDays(todayIso(), 30));
    setDescription('');
    setPriority('normal');
    setFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Chỉ mục cha mà user phụ trách (được tạo con bên dưới).
  const parentOptions = useMemo(
    () => (tier === 1 ? [] : parents.filter((p) => p.tier === tier - 1 && canCreateUnder(currentUser, tier, p))),
    [parents, tier, currentUser],
  );
  const parent = parentOptions.find((p) => p.id === parentId);
  const candidates = useMemo(() => ownerCandidates(tier, parent, users), [tier, parent, users]);
  const owner = candidates.find((u) => u.id === ownerUserId);
  // Trưởng phòng nhiều phòng → chọn phòng của hạng mục.
  const ownerDepartments = tier === 3 && owner ? owner.departments : [];

  // Chọn mục cha → ngày mặc định nằm trong khoảng của mục cha; đầu việc mặc định giao cho chính mình nếu được.
  const pickParent = (id: string) => {
    setParentId(id);
    const p = parentOptions.find((x) => x.id === id);
    if (!p) return;
    const start = p.startDate && p.startDate > todayIso() ? p.startDate : todayIso();
    setStartDate(p.endDate && start > p.endDate ? p.startDate : start);
    setEndDate(p.endDate && plusDays(start, 30) > p.endDate ? p.endDate : plusDays(start, 30));
    if (tier === 4 && !assign) {
      setOwnerUserId(ownerCandidates(4, p, users).some((u) => u.id === currentUser.id) ? currentUser.id : '');
    }
  };
  const pickOwner = (id: string) => {
    setOwnerUserId(id);
    setDepartment(candidates.find((u) => u.id === id)?.departments[0] ?? '');
  };

  const needsParent = tier > 1;
  const needsOwner = tier !== 2;
  const dateRangeError = startDate > endDate;
  const outsideParent =
    !!parent && ((!!parent.startDate && startDate < parent.startDate) || (!!parent.endDate && endDate > parent.endDate));
  const invalid =
    !title.trim() ||
    dateRangeError ||
    outsideParent ||
    (needsParent && !parent) ||
    (needsOwner && !owner) ||
    (tier === 3 && !department);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid || submitting) return;
    setSubmitting(true);
    try {
      const ok = await onAddItem({
        tier,
        title,
        parentId: parent?.id,
        ownerUserId: needsOwner ? ownerUserId : undefined,
        department: tier === 3 ? (department as TierItem['department']) : undefined,
        startDate,
        endDate,
        priority,
        description,
        managementNotes: `Tạo bởi ${currentUser.fullname}.`,
      }, files);
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
        {!assign && allowedTiers.length > 1 && (
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
                  setOwnerUserId('');
                  setDepartment('');
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
            Tên {TIER_LABEL[tier]} *
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

        {needsParent && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-item-parent" className={labelCls}>
              Thuộc {TIER_LABEL[(tier - 1) as TierLevel]} *
            </label>
            <select
              id="new-item-parent"
              value={parentId}
              required
              onChange={(e) => pickParent(e.target.value)}
              className={inputCls}
            >
              <option value="">-- Chọn {TIER_LABEL[(tier - 1) as TierLevel]} --</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.title}
                </option>
              ))}
            </select>
            {parentOptions.length === 0 && (
              <p className="text-xs text-error font-semibold">
                Bạn chưa phụ trách {TIER_LABEL[(tier - 1) as TierLevel]} nào đang hoạt động.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-item-owner" className={labelCls}>
              {OWNER_LABEL[tier]}{needsOwner ? ' *' : ''}
            </label>
            {needsOwner ? (
              <select
                id="new-item-owner"
                value={ownerUserId}
                required
                disabled={tier === 4 && !parent}
                onChange={(e) => pickOwner(e.target.value)}
                className={inputCls}
              >
                <option value="">
                  {tier === 4 && !parent ? '-- Chọn hạng mục trước --' : '-- Chọn người --'}
                </option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullname}{u.id === currentUser.id ? ' (tôi)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="new-item-owner"
                type="text"
                value={parent?.owner.name ?? '—'}
                disabled
                className={inputCls}
              />
            )}
          </div>

          {tier === 3 && ownerDepartments.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-item-dept" className={labelCls}>
                Phòng của hạng mục *
              </label>
              <select
                id="new-item-dept"
                value={department}
                required
                onChange={(e) => setDepartment(e.target.value)}
                className={inputCls}
              >
                {ownerDepartments.map((d) => (
                  <option key={d} value={d}>{DEPARTMENT_LABEL[d] ?? d}</option>
                ))}
              </select>
            </div>
          ) : tier === 4 ? (
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
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{PRIORITY_VI[p]}</option>
                ))}
              </select>
            </div>
          ) : null}
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
              min={parent?.startDate || undefined}
              max={parent?.endDate || undefined}
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
              min={parent?.startDate || undefined}
              max={parent?.endDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              aria-invalid={dateRangeError || outsideParent}
              aria-describedby={dateRangeError || outsideParent ? 'new-item-date-error' : undefined}
              className={inputCls}
            />
          </div>
          {(dateRangeError || outsideParent) && (
            <p id="new-item-date-error" role="alert" className="col-span-2 text-xs text-error font-semibold">
              {dateRangeError
                ? 'Ngày bắt đầu phải trước hoặc bằng hạn hoàn thành.'
                : `Thời gian phải nằm trong ${TIER_LABEL[(tier - 1) as TierLevel]} (${viDate(parent!.startDate)} – ${viDate(parent!.endDate)}).`}
            </p>
          )}
          {parent && !dateRangeError && !outsideParent && (
            <p className="col-span-2 text-xs text-secondary">
              Trong khoảng {viDate(parent.startDate)} – {viDate(parent.endDate)} của {TIER_LABEL[(tier - 1) as TierLevel]}.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-item-desc" className={labelCls}>
            {tier === 4 ? 'Chỉ thị / mô tả công việc' : 'Mô tả & Phạm vi'}
          </label>
          <textarea
            id="new-item-desc"
            rows={tier === 4 ? 4 : 2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tier === 4 ? 'Cần làm gì, yêu cầu kết quả ra sao, lưu ý…' : 'Mục tiêu bàn giao chính...'}
            className={textareaCls}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Tệp / ảnh đính kèm</span>
          <FilePicker files={files} onChange={setFiles} disabled={submitting} />
        </div>

        <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-surface-container-low">
          <button type="button" onClick={onClose} disabled={submitting} className={ghostButtonCls}>
            Hủy bỏ
          </button>
          <button type="submit" disabled={submitting || invalid} className={primaryButtonCls}>
            {submitting ? 'Đang lưu…' : assign ? 'Giao việc' : 'Lưu công việc'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
