import React, { useState, useEffect, useMemo } from 'react';
import { TierItem, DailyLog, HistoryEntry, User } from '../types';
import { canEditTierItem, canAddDailyLog } from '../auth/permissions';
import { api } from '../lib/apiClient';
import { apiToHistoryEntry, extractBackendId, isTierItemOverdue, TIER_STATUS_OPTIONS, viStatusToEnum } from '../lib/transforms';
import { Dialog, ghostButtonCls, inputCls, primaryButtonCls, textareaCls } from './ui/Dialog';

interface DetailsDrawerProps {
  item: TierItem | null;
  isOpen: boolean;
  onClose: () => void;
  /** Resolve true khi server đã lưu — Drawer chỉ thoát chế độ sửa khi đó. */
  onUpdateItem: (updated: TierItem) => Promise<boolean>;
  dailyLogs?: DailyLog[];
  /** Ghi nhật ký cho task T4 (taskId là composite '<tier>-<num>'). Resolve true khi đã lưu. */
  onAddDailyLog?: (
    taskId: string,
    description: string,
    result: string | undefined,
    obstacle: string | undefined,
    progress: number,
  ) => Promise<boolean>;
  currentUser?: User;
  /** Nghiệm thu mục cha (T1–T3). `openChildren` = số mục con trực tiếp chưa xong. */
  acceptance?: { allowed: boolean; openChildren: number; childLabel: string; deniedReason: string };
  onAcceptItem?: (itemId: string) => Promise<boolean>;
}

/** Bản sao client của TRANSITIONS trong backend/lib/stateMachine.js — chỉ để ẩn lựa chọn chắc chắn bị từ chối. */
const NEXT_STATUS: Record<string, string[]> = {
  pending: ['doing', 'blocked'],
  doing: ['pending_approval', 'blocked', 'pending'],
  pending_approval: ['done', 'doing'],
  blocked: ['doing', 'pending'],
  done: [],
};

const ENTITY_BY_TIER = { 1: 'project', 2: 'phase', 3: 'bundle', 4: 'task' } as const;

const PRIORITY_TONE: Record<TierItem['priority'], string> = {
  'Cao (Critical Path)': 'text-error',
  'Trung bình': 'text-on-surface',
  'Thấp': 'text-secondary',
};

interface LogDraft {
  description: string;
  result: string;
  obstacle: string;
  progress: number;
}

const Section: React.FC<{ title: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ title, aside, children }) => (
  <section className="bg-white p-3.5 rounded-lg border border-surface-container">
    <div className="flex items-center justify-between mb-1.5">
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
);

export const DetailsDrawer: React.FC<DetailsDrawerProps> = ({
  item,
  isOpen,
  onClose,
  onUpdateItem,
  dailyLogs = [],
  onAddDailyLog,
  currentUser,
  acceptance,
  onAcceptItem,
}) => {
  const [formData, setFormData] = useState<TierItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newLogDraft, setNewLogDraft] = useState<LogDraft | null>(null);
  const [savingLog, setSavingLog] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [accepting, setAccepting] = useState(false);

  // Đổi sang item khác: bỏ chế độ sửa + nháp nhật ký.
  useEffect(() => {
    setIsEditing(false);
    setNewLogDraft(null);
  }, [item?.id]);

  // Khi không sửa, form luôn phản ánh dữ liệu mới nhất từ server (kể cả sau khi lưu).
  useEffect(() => {
    if (!isEditing) setFormData(item ? { ...item, owner: { ...item.owner }, gantt: { ...item.gantt } } : null);
  }, [item, isEditing]);

  // Lịch sử lấy từ audit log của chính đối tượng này; tải lại mỗi khi dữ liệu item đổi.
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setHistory(null);
    api.listEntityHistory(ENTITY_BY_TIER[item.tier], extractBackendId(item.id)).then((r) => {
      if (!cancelled) setHistory(r.ok ? r.data.items.map(apiToHistoryEntry) : []);
    });
    return () => { cancelled = true; };
  }, [item]);

  const canEdit = useMemo(() => canEditTierItem(currentUser, item), [currentUser, item]);

  const itemLogs = useMemo(
    () => (item?.tier === 4 ? dailyLogs.filter((l) => l.taskId === String(extractBackendId(item.id))) : [])
      .sort((a, b) => (a.logDate < b.logDate ? 1 : -1)),
    [dailyLogs, item],
  );

  const daysRemaining = useMemo(() => {
    const m = formData?.endDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(formData.endDate) : null;
    if (!m) return undefined;
    const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((end.getTime() - now.getTime()) / 86400000);
  }, [formData?.endDate]);

  const busy = saving || savingLog || accepting;

  if (!isOpen || !formData || !item) return null;

  const currentEnum = viStatusToEnum(item.status);
  const isLeaf = formData.tier === 4;
  // Mục cha chỉ "Đã xong" qua Nghiệm thu (server kiểm tra mục con) — không chọn tay.
  const statusChoices = TIER_STATUS_OPTIONS.filter(
    (s) =>
      s === item.status ||
      (NEXT_STATUS[currentEnum]?.includes(viStatusToEnum(s)) && (isLeaf || s !== 'Đã xong')),
  );

  const handleAccept = async () => {
    if (!onAcceptItem) return;
    setAccepting(true);
    try {
      await onAcceptItem(formData.id);
    } finally {
      setAccepting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (await onUpdateItem(formData)) setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => setIsEditing(false);

  const handleSaveLog = async () => {
    if (!newLogDraft?.description.trim() || !onAddDailyLog) return;
    setSavingLog(true);
    try {
      const ok = await onAddDailyLog(
        formData.id,
        newLogDraft.description.trim(),
        newLogDraft.result.trim() || undefined,
        newLogDraft.obstacle.trim() || undefined,
        newLogDraft.progress,
      );
      if (ok) setNewLogDraft(null);
    } finally {
      setSavingLog(false);
    }
  };

  const requestClose = () => {
    const dirty = isEditing || (newLogDraft && newLogDraft.description.trim());
    if (dirty && !window.confirm('Bạn có thay đổi chưa lưu. Đóng và bỏ thay đổi?')) return;
    onClose();
  };

  return (
    <Dialog isOpen variant="drawer" onClose={requestClose} title={formData.title} dismissible={!busy}>
      <div className="flex flex-col min-h-full">
        <div className="flex-1 p-4 space-y-3 bg-surface">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs px-2 py-0.5 bg-surface-container text-primary font-bold rounded">
              {formData.code}
            </span>
            <span className="text-xs font-bold px-2 py-0.5 bg-primary text-on-primary rounded">{formData.tierName}</span>
            {formData.department && (
              <span className="text-xs font-bold px-2 py-0.5 bg-white text-on-surface rounded border border-surface-container-high">
                {formData.department}
              </span>
            )}
          </div>

          <Section title="Người phụ trách chính">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-secondary-container text-on-secondary-fixed font-bold flex items-center justify-center text-sm">
                {formData.owner.initial}
              </div>
              <div>
                <div className="text-sm font-semibold text-on-surface">{formData.owner.name}</div>
                <div className="text-xs text-secondary">
                  {formData.owner.role}
                  {formData.ownerUsername && <span className="ml-2 font-mono text-primary">@{formData.ownerUsername}</span>}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Lịch trình"
            aside={
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                  daysRemaining === undefined
                    ? 'bg-surface-container-low text-secondary border-surface-container-high'
                    : isTierItemOverdue({ daysRemaining, status: formData.status })
                      ? 'bg-error-container text-on-error-container border-error-fixed'
                      : 'bg-tertiary-fixed/40 text-tertiary border-tertiary/30'
                }`}
              >
                {daysRemaining === undefined
                  ? 'Chưa đặt hạn'
                  : formData.status === 'Đã xong'
                    ? 'Đã hoàn thành'
                    : formData.status === 'Chờ duyệt'
                    ? 'Đã báo xong, chờ duyệt'
                    : daysRemaining === 0
                      ? 'Đến hạn hôm nay'
                      : daysRemaining < 0
                        ? `Quá hạn ${Math.abs(daysRemaining)} ngày`
                        : `Còn ${daysRemaining} ngày`}
              </span>
            }
          >
            {isEditing ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-secondary flex flex-col gap-1">
                  Từ ngày
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="text-xs text-secondary flex flex-col gap-1">
                  Đến ngày
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className={inputCls}
                  />
                </label>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-on-surface-variant">
                <span>
                  Từ <span className="font-mono font-semibold text-on-surface">{formData.startDate || '—'}</span>
                </span>
                <span>
                  Đến <span className="font-mono font-bold text-sm text-on-surface">{formData.endDate || '—'}</span>
                </span>
              </div>
            )}
          </Section>

          <Section title="Tiến độ thực tế" aside={<span className="font-mono font-bold text-base text-primary">{formData.progress}%</span>}>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={formData.progress}
              aria-label="Tiến độ"
              className="w-full h-2.5 bg-surface-container-low rounded-full overflow-hidden"
            >
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${formData.progress}%` }} />
            </div>
            {isEditing && isLeaf ? (
              <label className="mt-2 flex items-center gap-2 text-xs text-secondary">
                Chỉnh tiến độ
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={formData.progress}
                  onChange={(e) => setFormData({ ...formData, progress: Number(e.target.value) })}
                  className="flex-1 accent-primary cursor-pointer"
                />
              </label>
            ) : !isLeaf ? (
              <p className="mt-2 text-xs text-secondary">Tính tự động từ tiến độ các mục con.</p>
            ) : null}
          </Section>

          <Section title="Trạng thái điều hành">
            {isEditing ? (
              <>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as TierItem['status'] })}
                  disabled={statusChoices.length <= 1}
                  aria-label="Trạng thái"
                  className={inputCls}
                >
                  {statusChoices.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-secondary">
                  {statusChoices.length <= 1
                    ? 'Trạng thái này là cuối cùng, không thể đổi.'
                    : 'Chỉ hiện các bước chuyển hợp lệ từ trạng thái hiện tại.'}
                </p>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-low text-primary rounded border border-surface-container-high text-sm font-semibold">
                {formData.status}
              </span>
            )}
            {!isLeaf && acceptance && item.status !== 'Đã xong' && !isEditing && (
              <div className="mt-3 pt-3 border-t border-surface-container flex items-center justify-between gap-3">
                <p className="text-xs text-secondary">
                  {!acceptance.allowed
                    ? acceptance.deniedReason
                    : acceptance.openChildren > 0
                      ? `Còn ${acceptance.openChildren} ${acceptance.childLabel} chưa xong — nghiệm thu khi tất cả đã xong.`
                      : `Mọi ${acceptance.childLabel} đã xong. Nghiệm thu để đóng ${formData.tierName.split(': ')[1]?.toLowerCase() ?? 'mục này'}.`}
                </p>
                {acceptance.allowed && acceptance.openChildren === 0 && (
                  <button type="button" onClick={handleAccept} disabled={busy} className={primaryButtonCls}>
                    {accepting ? 'Đang nghiệm thu…' : 'Nghiệm thu'}
                  </button>
                )}
              </div>
            )}
          </Section>

          <Section title="Mức độ ưu tiên">
            {isEditing && isLeaf ? (
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as TierItem['priority'] })}
                aria-label="Mức độ ưu tiên"
                className={inputCls}
              >
                <option value="Cao (Critical Path)">Cao (đường găng)</option>
                <option value="Trung bình">Trung bình</option>
                <option value="Thấp">Thấp</option>
              </select>
            ) : (
              <span className={`text-sm font-semibold ${PRIORITY_TONE[formData.priority]}`}>{formData.priority}</span>
            )}
          </Section>

          <Section title="Mô tả & Phạm vi">
            {isEditing ? (
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                aria-label="Mô tả & Phạm vi"
                className={textareaCls}
                rows={3}
              />
            ) : (
              <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">
                {formData.description || <span className="italic text-outline">Chưa có mô tả.</span>}
              </p>
            )}
          </Section>

          {isLeaf && (
            <Section title="Vướng mắc (nhân viên báo)">
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {formData.blockerNote || <span className="italic text-outline">Chưa có báo cáo vướng mắc nào.</span>}
              </p>
            </Section>
          )}

          <Section title="Ghi chú điều hành">
            {isEditing ? (
              <textarea
                value={formData.managementNotes}
                onChange={(e) => setFormData({ ...formData, managementNotes: e.target.value })}
                aria-label="Ghi chú điều hành"
                className={textareaCls}
                rows={2}
              />
            ) : (
              <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">
                {formData.managementNotes || <span className="italic text-outline">Chưa có ghi chú.</span>}
              </p>
            )}
          </Section>

          {isLeaf && (
            <Section title="Nhật ký công việc" aside={<span className="text-xs font-mono text-primary font-semibold">{itemLogs.length} mục</span>}>
              {itemLogs.length === 0 ? (
                <p className="text-xs text-outline italic">Đầu việc này chưa có nhật ký nào.</p>
              ) : (
                <ul className="space-y-2">
                  {itemLogs.map((log) => (
                    <li key={log.id} className="bg-surface border border-surface-container rounded p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-xs font-bold text-primary">{log.logDate}</span>
                        <span className="text-xs font-bold text-tertiary">Tiến độ {log.progress}%</span>
                      </div>
                      <div className="text-xs text-on-surface leading-relaxed">{log.description}</div>
                      {log.result && (
                        <div className="text-xs text-tertiary mt-1 font-medium">
                          <span className="font-bold">Kết quả:</span> {log.result}
                        </div>
                      )}
                      {log.obstacle && (
                        <div className="text-xs text-error mt-1 font-medium">
                          <span className="font-bold">Vướng mắc:</span> {log.obstacle}
                        </div>
                      )}
                      <div className="text-xs text-outline mt-1.5">— {log.userName}</div>
                    </li>
                  ))}
                </ul>
              )}

              {onAddDailyLog && canAddDailyLog(currentUser, formData) &&
                (newLogDraft ? (
                  <div className="bg-surface-container-low border border-surface-container-high rounded p-2.5 space-y-2 mt-2">
                    <textarea
                      value={newLogDraft.description}
                      onChange={(e) => setNewLogDraft({ ...newLogDraft, description: e.target.value })}
                      rows={2}
                      aria-label="Mô tả công việc hôm nay"
                      placeholder="Mô tả công việc hôm nay (bắt buộc)…"
                      className={textareaCls}
                    />
                    <input
                      type="text"
                      value={newLogDraft.result}
                      onChange={(e) => setNewLogDraft({ ...newLogDraft, result: e.target.value })}
                      aria-label="Kết quả đạt được"
                      placeholder="Kết quả đạt được (tuỳ chọn)"
                      className={inputCls}
                    />
                    <input
                      type="text"
                      value={newLogDraft.obstacle}
                      onChange={(e) => setNewLogDraft({ ...newLogDraft, obstacle: e.target.value })}
                      aria-label="Vướng mắc"
                      placeholder="Vướng mắc (tuỳ chọn — sẽ gửi Trưởng phòng)"
                      className={inputCls}
                    />
                    <label className="flex items-center gap-2 text-xs font-semibold text-on-surface">
                      Tiến độ
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={newLogDraft.progress}
                        onChange={(e) => setNewLogDraft({ ...newLogDraft, progress: Number(e.target.value) })}
                        className="flex-1 accent-primary"
                      />
                      <span className="font-bold text-primary w-10 text-right">{newLogDraft.progress}%</span>
                    </label>
                    <div className="flex justify-end gap-2 pt-1">
                      <button onClick={() => setNewLogDraft(null)} type="button" disabled={savingLog} className={ghostButtonCls}>
                        Hủy
                      </button>
                      <button
                        onClick={handleSaveLog}
                        type="button"
                        disabled={savingLog || !newLogDraft.description.trim()}
                        className={primaryButtonCls}
                      >
                        {savingLog ? 'Đang lưu…' : 'Lưu nhật ký'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setNewLogDraft({ description: '', result: '', obstacle: '', progress: formData.progress ?? 0 })}
                    className="mt-2 text-xs font-bold text-primary hover:text-primary-container flex items-center gap-1"
                    type="button"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined [--icon-size:14px]">add</span>
                    Thêm nhật ký
                  </button>
                ))}
            </Section>
          )}

          <Section title="Lịch sử thao tác">
            {history === null ? (
              <p className="text-xs text-outline" role="status">Đang tải lịch sử…</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-outline italic">Chưa có thao tác nào được ghi lại.</p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((h) => (
                  <li key={h.id} className="text-xs text-on-surface-variant">
                    <div>{h.action}</div>
                    <div className="text-outline">
                      — {h.userName || 'Hệ thống'} · {h.createdAt}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="sticky bottom-0 p-3.5 bg-surface-container-low border-t border-surface-container-high flex items-center justify-between gap-2">
          {isEditing ? (
            <button onClick={handleCancelEdit} type="button" disabled={saving} className={ghostButtonCls}>
              Huỷ sửa
            </button>
          ) : (
            <button onClick={requestClose} type="button" className={ghostButtonCls}>
              Đóng lại
            </button>
          )}
          {!canEdit ? (
            <span className="text-xs text-secondary italic px-3">
              {currentUser?.role === 'director' ? 'Chế độ chỉ đọc' : 'Bạn không có quyền chỉnh sửa mục này'}
            </span>
          ) : isEditing ? (
            <button onClick={handleSave} type="button" disabled={saving} className={primaryButtonCls}>
              {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          ) : (
            <button onClick={() => setIsEditing(true)} type="button" className={primaryButtonCls}>
              Chỉnh sửa
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
