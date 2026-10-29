import React, { useState, useEffect, useMemo } from 'react';
import { TierItem, DailyLog, HistoryEntry, User } from '../types';
import {
  canAddDailyLog,
  canApproveTask,
  canArchiveTierItem,
  canAttachToTask,
  canEditTierItem,
} from '../auth/permissions';
import { api, type AttachmentDto, type TaskMessageDto } from '../lib/apiClient';
import {
  apiToHistoryEntry,
  extractBackendId,
  formatDateTime,
  formatIsoDate,
  isTierItemOverdue,
  PRIORITY_OPTIONS,
  PRIORITY_VI,
  TIER_STATUS_OPTIONS,
  viStatusToEnum,
} from '../lib/transforms';
import { Dialog, ghostButtonCls, inputCls, labelCls, primaryButtonCls, textareaCls } from './ui/Dialog';
import { FilePicker } from './ui/FilePicker';
import { PriorityBadge } from './ui/PriorityBadge';
import { ConversationSection, TaskFilesSection, TimelineSection } from './TaskActivity';

/** Tab của đầu việc (T4), lưu trên URL (?tab=trao-doi). */
export type DetailTab = 'trao-doi' | 'lich-su';

interface TaskDetailDialogProps {
  item: TierItem | null;
  onClose: () => void;
  /** Tab đang mở (giá trị lạ → 'trao-doi') và cách đổi tab. */
  tab?: string;
  onTabChange: (tab: DetailTab) => void;
  /** Resolve true khi server đã lưu — chỉ thoát chế độ sửa khi đó. */
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
  /** Duyệt T4 (kèm ghi chú / tệp) hoặc nghiệm thu T1–T3. */
  onApprove?: (itemId: string, note?: string, files?: File[]) => Promise<boolean>;
  /** T4: người làm chuyển bước (Bắt đầu / Báo xong / Hoàn thành). */
  onAdvance?: (itemId: string, note?: string, files?: File[]) => Promise<boolean>;
  onReturn?: (itemId: string, reason: string, files: File[]) => Promise<boolean>;
  onUnblock?: (itemId: string, note: string, files: File[]) => Promise<boolean>;
  /** Lưu trữ (true) / khôi phục (false) dự án, giai đoạn. Resolve true khi đã lưu. */
  onSetArchived?: (itemId: string, archived: boolean) => Promise<boolean>;
  /** T4: gửi ghi chú / vướng mắc vào luồng trao đổi (kèm tệp). Resolve true khi đã lưu. */
  onPostMessage?: (itemId: string, body: string, kind: 'note' | 'blocker', files: File[]) => Promise<boolean>;
  /** Thêm tệp đính kèm cho mục (mọi tầng). */
  onUploadFiles?: (itemId: string, files: File[]) => Promise<boolean>;
  onDeleteAttachment?: (attachmentId: number) => Promise<boolean>;
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

const STATUS_TONE: Record<TierItem['status'], string> = {
  'Chưa bắt đầu': 'bg-surface-container-low text-secondary border-surface-container-high',
  'Đang làm': 'bg-primary-fixed text-on-primary-fixed-variant border-primary-fixed-dim',
  'Chờ duyệt': 'bg-warning-container text-on-warning-container border-warning-fixed',
  'Đang vướng': 'bg-error-container text-on-error-container border-error-fixed',
  'Đã xong': 'bg-tertiary-fixed/40 text-tertiary border-tertiary/30',
};

interface LogDraft {
  description: string;
  result: string;
  obstacle: string;
  progress: number;
}

/** Thao tác trên đầu việc cần ghi chú (Bắt đầu thì bấm thẳng, không cần). */
type NoteAction = 'finish' | 'approve' | 'return' | 'unblock';

const Block: React.FC<{ title: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ title, aside, children }) => (
  <section className="bg-white p-3.5 rounded-lg border border-surface-container">
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-xs text-secondary">{label}</dt>
    <dd className="text-sm text-on-surface">{children}</dd>
  </div>
);

/**
 * Chi tiết 1 mục công việc: hộp thoại lớn 2 cột (toàn màn hình trên điện thoại).
 *   - Cột trái: chỉ thị / mô tả, tệp đính kèm, rồi tab Trao đổi | Lịch sử (T4).
 *   - Cột phải: trạng thái + nút thao tác, ưu tiên, người, ngày, tiến độ — luôn trong tầm mắt
 *     để đọc xong trao đổi là duyệt / trả về / báo xong được ngay.
 * Mục đang mở nằm trên URL (?muc=4-12&tab=trao-doi).
 */
export const TaskDetailDialog: React.FC<TaskDetailDialogProps> = ({
  item,
  onClose,
  tab: tabParam,
  onTabChange,
  onUpdateItem,
  dailyLogs = [],
  onAddDailyLog,
  currentUser,
  acceptance,
  onApprove,
  onAdvance,
  onReturn,
  onUnblock,
  onSetArchived,
  onPostMessage,
  onUploadFiles,
  onDeleteAttachment,
}) => {
  const [formData, setFormData] = useState<TierItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newLogDraft, setNewLogDraft] = useState<LogDraft | null>(null);
  const [savingLog, setSavingLog] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [acting, setActing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [messages, setMessages] = useState<TaskMessageDto[] | null>(null);
  const [taskFiles, setTaskFiles] = useState<AttachmentDto[] | null>(null);
  const [noteAction, setNoteAction] = useState<NoteAction | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionFiles, setActionFiles] = useState<File[]>([]);

  // Đổi sang item khác: bỏ chế độ sửa, nháp nhật ký, thao tác đang nhập.
  useEffect(() => {
    setIsEditing(false);
    setNewLogDraft(null);
    setNoteAction(null);
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

  // Tệp của mục (mọi tầng) + luồng trao đổi (chỉ T4); tải lại mỗi khi dữ liệu item đổi (sau mỗi lần ghi).
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    const num = extractBackendId(item.id);
    setMessages(null);
    setTaskFiles(null);
    if (item.tier === 4) {
      api.listMessages(num).then((r) => {
        if (!cancelled) setMessages(r.ok ? r.data.items : []);
      });
    }
    api.listAttachments(item.tier, num).then((r) => {
      if (!cancelled) setTaskFiles(r.ok ? r.data.items.filter((f) => f.message_id === null) : []);
    });
    return () => { cancelled = true; };
  }, [item]);

  const canEdit = useMemo(() => canEditTierItem(currentUser, item), [currentUser, item]);

  const itemLogs = useMemo(
    () => (item?.tier === 4 ? dailyLogs.filter((l) => l.taskId === String(extractBackendId(item.id))) : []),
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

  const busy = saving || savingLog || acting || archiving;
  const canArchive = !!onSetArchived && canArchiveTierItem(currentUser, item);

  if (!formData || !item) return null;

  const tab: DetailTab = tabParam === 'lich-su' ? 'lich-su' : 'trao-doi';
  const currentEnum = viStatusToEnum(item.status);
  const isLeaf = formData.tier === 4;
  // Mục cha chỉ "Đã xong" qua Nghiệm thu (server kiểm tra mục con) — không chọn tay.
  const statusChoices = TIER_STATUS_OPTIONS.filter(
    (s) => s === item.status || (NEXT_STATUS[currentEnum]?.includes(viStatusToEnum(s)) && s !== 'Đã xong'),
  );

  // Thao tác theo vai trò (server kiểm tra lại bằng policies + state machine).
  const live = !item.archived;
  const isOwner = !!currentUser && item.ownerUserId === currentUser.id;
  const canApprove = isLeaf && live && canApproveTask(currentUser, { bundleOwnerUserId: item.bundleOwnerUserId });
  const selfClose = isOwner && canApprove;
  const leafActions = {
    start: isLeaf && live && isOwner && item.status === 'Chưa bắt đầu' && !!onAdvance,
    finish: isLeaf && live && isOwner && item.status === 'Đang làm' && !!onAdvance,
    approve: canApprove && item.status === 'Chờ duyệt' && !!onApprove,
    return: canApprove && item.status === 'Chờ duyệt' && !!onReturn,
    unblock: canApprove && (item.status === 'Đang vướng' || !!item.blockerNote?.trim()) && !!onUnblock,
  };

  const ACTION_TEXT: Record<NoteAction, { button: string; label: string; required?: boolean; placeholder: string }> = {
    finish: {
      button: selfClose ? 'Hoàn thành' : 'Báo xong',
      label: selfClose ? 'Ghi chú kết quả' : 'Ghi chú cho người duyệt',
      placeholder: 'Kết quả đạt được, nơi lưu sản phẩm, điều cần lưu ý…',
    },
    approve: { button: 'Duyệt', label: 'Nhận xét', placeholder: 'Ví dụ: Đạt yêu cầu' },
    return: { button: 'Trả về', label: 'Lý do / cần sửa gì', required: true, placeholder: 'Ví dụ: Bổ sung báo giá xi măng' },
    unblock: { button: 'Gỡ vướng mắc', label: 'Hướng xử lý', placeholder: 'Ví dụ: Đã gửi số đầu mối mới' },
  };

  const openAction = (a: NoteAction) => {
    setNoteAction(a);
    setActionNote('');
    setActionFiles([]);
  };

  const runAction = async (fn: () => Promise<boolean> | undefined) => {
    setActing(true);
    try {
      if (await fn()) setNoteAction(null);
    } finally {
      setActing(false);
    }
  };

  const submitAction = () => {
    if (!noteAction) return;
    const note = actionNote.trim();
    if (ACTION_TEXT[noteAction].required && !note) return;
    void runAction(() =>
      noteAction === 'finish' ? onAdvance?.(item.id, note, actionFiles)
        : noteAction === 'approve' ? onApprove?.(item.id, note, actionFiles)
          : noteAction === 'return' ? onReturn?.(item.id, note, actionFiles)
            : onUnblock?.(item.id, note, actionFiles),
    );
  };

  const handleSetArchived = async (archived: boolean) => {
    if (!onSetArchived) return;
    const what = item.tier === 1 ? 'dự án' : 'giai đoạn';
    const question = archived
      ? `Lưu trữ ${what} "${item.title}"?

${what[0].toUpperCase()}${what.slice(1)} và toàn bộ mục con sẽ ẩn khỏi cây công việc, giao việc và báo cáo. Dữ liệu vẫn được giữ, có thể khôi phục.`
      : `Khôi phục ${what} "${item.title}" từ lưu trữ?`;
    if (!window.confirm(question)) return;
    setArchiving(true);
    try {
      await onSetArchived(item.id, archived);
    } finally {
      setArchiving(false);
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
    const dirty =
      isEditing ||
      !!newLogDraft?.description.trim() ||
      (noteAction !== null && (!!actionNote.trim() || actionFiles.length > 0));
    if (dirty && !window.confirm('Bạn có thay đổi chưa lưu. Đóng và bỏ thay đổi?')) return;
    onClose();
  };

  const scheduleBadge =
    daysRemaining === undefined
      ? { cls: 'bg-surface-container-low text-secondary border-surface-container-high', text: 'Chưa đặt hạn' }
      : formData.status === 'Đã xong'
        ? { cls: 'bg-tertiary-fixed/40 text-tertiary border-tertiary/30', text: 'Đã xong' }
        : formData.status === 'Chờ duyệt'
          ? { cls: 'bg-warning-container text-on-warning-container border-warning-fixed', text: 'Đã báo xong, chờ duyệt' }
          : isTierItemOverdue({ daysRemaining, status: formData.status })
            ? { cls: 'bg-error-container text-on-error-container border-error-fixed', text: `Quá hạn ${Math.abs(daysRemaining)} ngày` }
            : {
                cls: 'bg-tertiary-fixed/40 text-tertiary border-tertiary/30',
                text: daysRemaining === 0 ? 'Đến hạn hôm nay' : `Còn ${daysRemaining} ngày`,
              };

  const anyLeafAction = Object.values(leafActions).some(Boolean);
  const blockerCount = messages?.filter((m) => m.kind === 'blocker' && !m.is_resolved).length ?? 0;

  // ── Cột phải: thông tin + thao tác ──
  const side = (
    <div className="flex flex-col gap-3">
      <Block title="Trạng thái">
        {isEditing && !isLeaf ? (
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
            <p className="mt-1 text-xs text-secondary">Chỉ hiện các bước chuyển hợp lệ từ trạng thái hiện tại.</p>
          </>
        ) : (
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-sm font-semibold ${STATUS_TONE[item.status]}`}>
            {item.status}
          </span>
        )}
        {isLeaf && item.blockerNote?.trim() && item.status !== 'Đang vướng' && (
          <p className="mt-1.5 text-xs font-semibold text-error">Có vướng mắc chưa xử lý</p>
        )}

        {/* Thao tác đầu việc */}
        {isLeaf && anyLeafAction && !isEditing && (
          <div className="mt-3 pt-3 border-t border-surface-container flex flex-col gap-2">
            {noteAction === null ? (
              <div className="flex flex-wrap gap-2">
                {leafActions.start && (
                  <button type="button" disabled={busy} onClick={() => void runAction(() => onAdvance?.(item.id))} className={primaryButtonCls}>
                    {acting ? 'Đang gửi…' : 'Bắt đầu'}
                  </button>
                )}
                {leafActions.finish && (
                  <button type="button" disabled={busy} onClick={() => openAction('finish')} className={primaryButtonCls}>
                    {ACTION_TEXT.finish.button}
                  </button>
                )}
                {leafActions.approve && (
                  <button type="button" disabled={busy} onClick={() => openAction('approve')} className={primaryButtonCls}>
                    Duyệt
                  </button>
                )}
                {leafActions.return && (
                  <button type="button" disabled={busy} onClick={() => openAction('return')} className={ghostButtonCls}>
                    Trả về
                  </button>
                )}
                {leafActions.unblock && (
                  <button type="button" disabled={busy} onClick={() => openAction('unblock')} className={primaryButtonCls}>
                    Gỡ vướng mắc
                  </button>
                )}
              </div>
            ) : (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitAction();
                }}
              >
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>
                    {ACTION_TEXT[noteAction].label} {ACTION_TEXT[noteAction].required ? '(bắt buộc)' : '(không bắt buộc)'}
                  </span>
                  <textarea
                    autoFocus
                    rows={4}
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder={ACTION_TEXT[noteAction].placeholder}
                    className={textareaCls}
                  />
                </label>
                <FilePicker files={actionFiles} onChange={setActionFiles} disabled={acting} />
                <p className="text-xs text-secondary">Ghi chú và tệp được lưu vào mục Trao đổi, kèm ngày giờ.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={acting} onClick={() => setNoteAction(null)} className={ghostButtonCls}>
                    Huỷ
                  </button>
                  <button
                    type="submit"
                    disabled={acting || (!!ACTION_TEXT[noteAction].required && !actionNote.trim())}
                    className={primaryButtonCls}
                  >
                    {acting ? 'Đang gửi…' : ACTION_TEXT[noteAction].button}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Nghiệm thu mục cha */}
        {!isLeaf && acceptance && item.status !== 'Đã xong' && !item.archived && !isEditing && (
          <div className="mt-3 pt-3 border-t border-surface-container flex flex-col gap-2">
            <p className="text-xs text-secondary">
              {!acceptance.allowed
                ? acceptance.deniedReason
                : acceptance.openChildren > 0
                  ? `Còn ${acceptance.openChildren} ${acceptance.childLabel} chưa xong — nghiệm thu khi tất cả đã xong.`
                  : `Mọi ${acceptance.childLabel} đã xong. Nghiệm thu để đóng ${formData.tierName.split(': ')[1]?.toLowerCase() ?? 'mục này'}.`}
            </p>
            {acceptance.allowed && acceptance.openChildren === 0 && onApprove && (
              <button type="button" onClick={() => void runAction(() => onApprove(item.id))} disabled={busy} className={primaryButtonCls}>
                {acting ? 'Đang nghiệm thu…' : 'Nghiệm thu'}
              </button>
            )}
          </div>
        )}
      </Block>

      <Block title="Thông tin">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <div className="col-span-2">
            <Field label={isLeaf ? 'Người làm' : 'Người phụ trách'}>
              <span className="font-semibold">{formData.owner.name}</span>
              {formData.department && <span className="text-xs text-secondary"> · {formData.department}</span>}
            </Field>
          </div>
          {isLeaf && (
            <div className="col-span-2">
              <Field label="Giao bởi">
                {formData.assignedByFullname && formData.assignedByFullname !== formData.owner.name
                  ? formData.assignedByFullname
                  : 'Việc tự tạo'}
                {formData.createdAt && <span className="text-xs text-secondary"> · {formatDateTime(formData.createdAt)}</span>}
              </Field>
            </div>
          )}
          {isLeaf && (
            <div className="col-span-2">
              <Field label="Mức ưu tiên">
                {isEditing ? (
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as TierItem['priority'] })}
                    aria-label="Mức độ ưu tiên"
                    className={inputCls}
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>{PRIORITY_VI[p]}</option>
                    ))}
                  </select>
                ) : (
                  <PriorityBadge priority={formData.priority} />
                )}
              </Field>
            </div>
          )}
          {isEditing ? (
            <>
              <label className="text-xs text-secondary flex flex-col gap-1">
                Bắt đầu
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="text-xs text-secondary flex flex-col gap-1">
                Hạn chót
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className={inputCls}
                />
              </label>
            </>
          ) : (
            <>
              <Field label="Bắt đầu">{formData.startDate ? formatIsoDate(formData.startDate) : '—'}</Field>
              <Field label="Hạn chót">
                <span className="font-semibold">{formData.endDate ? formatIsoDate(formData.endDate) : '—'}</span>
              </Field>
            </>
          )}
          <div className="col-span-2">
            <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded border ${scheduleBadge.cls}`}>{scheduleBadge.text}</span>
          </div>
          <div className="col-span-2">
            <Field label="Tiến độ">
              <div className="flex items-center gap-2">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={formData.progress}
                  aria-label="Tiến độ"
                  className="flex-1 h-2 bg-surface-container-low rounded-full overflow-hidden"
                >
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${formData.progress}%` }} />
                </div>
                <span className="font-mono font-bold text-primary w-11 text-right">{formData.progress}%</span>
              </div>
              {isEditing && isLeaf ? (
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={formData.progress}
                  onChange={(e) => setFormData({ ...formData, progress: Number(e.target.value) })}
                  aria-label="Chỉnh tiến độ"
                  className="mt-1 w-full accent-primary cursor-pointer"
                />
              ) : !isLeaf ? (
                <p className="mt-1 text-xs text-secondary">Tính tự động từ tiến độ các mục con.</p>
              ) : null}
            </Field>
          </div>
        </dl>
      </Block>
    </div>
  );

  // ── Tab Lịch sử của đầu việc: thêm nhật ký + dòng thời gian gộp ──
  const historyTab = (
    <div className="flex flex-col gap-3">
      {onAddDailyLog && live && canAddDailyLog(currentUser, formData) &&
        (newLogDraft ? (
          <div className="bg-surface-container-low border border-surface-container-high rounded-lg p-3 space-y-2">
            <textarea
              value={newLogDraft.description}
              onChange={(e) => setNewLogDraft({ ...newLogDraft, description: e.target.value })}
              rows={3}
              aria-label="Mô tả công việc hôm nay"
              placeholder="Mô tả công việc hôm nay (bắt buộc)…"
              className={textareaCls}
            />
            <textarea
              value={newLogDraft.result}
              onChange={(e) => setNewLogDraft({ ...newLogDraft, result: e.target.value })}
              rows={2}
              aria-label="Kết quả đạt được"
              placeholder="Kết quả đạt được (tuỳ chọn)"
              className={textareaCls}
            />
            <textarea
              value={newLogDraft.obstacle}
              onChange={(e) => setNewLogDraft({ ...newLogDraft, obstacle: e.target.value })}
              rows={2}
              aria-label="Vướng mắc"
              placeholder="Vướng mắc (tuỳ chọn — sẽ gửi Trưởng phòng)"
              className={textareaCls}
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
            className="self-start text-xs font-bold text-primary hover:text-primary-container flex items-center gap-1"
            type="button"
          >
            <span aria-hidden="true" className="material-symbols-outlined [--icon-size:14px]">add</span>
            Thêm nhật ký hôm nay
          </button>
        ))}
      <TimelineSection item={item} history={history} logs={itemLogs} messages={messages} />
    </div>
  );

  const tabs: [DetailTab, string][] = [
    ['trao-doi', `Trao đổi${messages ? ` (${messages.length})` : ''}`],
    ['lich-su', 'Lịch sử'],
  ];

  return (
    <Dialog
      isOpen
      size="wide"
      onClose={requestClose}
      dismissible={!busy}
      title={
        <>
          <span className="font-mono text-xs px-2 py-0.5 mr-2 bg-surface-container text-primary font-bold rounded align-middle">
            {formData.code}
          </span>
          {formData.title}
        </>
      }
    >
      <div className="flex flex-col min-h-full">
        <div className="flex-1 p-4 bg-surface grid gap-4 md:grid-cols-[minmax(0,1fr)_320px] items-start">
          {/* Cột trái */}
          <div className="flex flex-col gap-3 min-w-0 order-2 md:order-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold px-2 py-0.5 bg-primary text-on-primary rounded">{formData.tierName}</span>
            </div>

            {item.archived && (
              <div role="status" className="flex items-start gap-2 p-3 rounded-lg bg-surface-container-high text-on-surface text-sm">
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px] text-secondary">inventory_2</span>
                <span>
                  {item.archivedAt
                    ? 'Mục này đã được lưu trữ — chỉ đọc, không hiện trong cây công việc và báo cáo.'
                    : 'Mục này thuộc dự án / giai đoạn đã lưu trữ — chỉ đọc. Khôi phục mục cha để chỉnh sửa.'}
                </span>
              </div>
            )}

            <Block title={isLeaf ? 'Chỉ thị / mô tả công việc' : 'Mô tả & Phạm vi'}>
              {isEditing ? (
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  aria-label={isLeaf ? 'Chỉ thị / mô tả công việc' : 'Mô tả & Phạm vi'}
                  className={textareaCls}
                  rows={6}
                />
              ) : (
                <p className="text-sm text-on-surface leading-relaxed whitespace-pre-line break-words">
                  {formData.description || (
                    <span className="italic text-outline">{isLeaf ? 'Người giao chưa ghi chỉ thị / mô tả.' : 'Chưa có mô tả.'}</span>
                  )}
                </p>
              )}
            </Block>

            {(isLeaf || taskFiles === null || taskFiles.length > 0 || canAttachToTask(currentUser, item)) && (
              <TaskFilesSection
                leaf={isLeaf}
                files={taskFiles}
                canUpload={!!onUploadFiles && canAttachToTask(currentUser, item)}
                canDelete={(a) =>
                  canAttachToTask(currentUser, item) &&
                  (currentUser?.role === 'admin' || String(a.uploaded_by_user_id) === currentUser?.id)
                }
                onUpload={(files) => onUploadFiles?.(item.id, files) ?? Promise.resolve(false)}
                onDelete={(a) => onDeleteAttachment?.(a.id) ?? Promise.resolve(false)}
              />
            )}

            {/* Chỉ T2 (giai đoạn) có cột management_notes. */}
            {formData.tier === 2 && (
              <Block title="Ghi chú điều hành">
                {isEditing ? (
                  <textarea
                    value={formData.managementNotes}
                    onChange={(e) => setFormData({ ...formData, managementNotes: e.target.value })}
                    aria-label="Ghi chú điều hành"
                    className={textareaCls}
                    rows={3}
                  />
                ) : (
                  <p className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">
                    {formData.managementNotes || <span className="italic text-outline">Chưa có ghi chú.</span>}
                  </p>
                )}
              </Block>
            )}

            {isLeaf ? (
              <div className="flex flex-col gap-2">
                <div role="tablist" aria-label="Trao đổi và lịch sử" className="flex gap-1 border-b border-surface-container">
                  {tabs.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      id={`tab-${k}`}
                      aria-selected={tab === k}
                      aria-controls={`panel-${k}`}
                      onClick={() => onTabChange(k)}
                      className={`px-3 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
                        tab === k ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-on-surface'
                      }`}
                    >
                      {label}
                      {k === 'trao-doi' && blockerCount > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-error-container text-on-error-container text-xs">
                          {blockerCount} vướng mắc
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
                  {tab === 'trao-doi' ? (
                    <ConversationSection
                      messages={messages}
                      canPost={!!onPostMessage && canEdit}
                      canReportBlocker={isOwner}
                      onPost={(body, kind, files) => onPostMessage?.(item.id, body, kind, files) ?? Promise.resolve(false)}
                    />
                  ) : (
                    historyTab
                  )}
                </div>
              </div>
            ) : (
              <Block title="Lịch sử thao tác">
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
                          — {h.userName || 'Hệ thống'} · {formatDateTime(h.createdAt)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Block>
            )}
          </div>

          {/* Cột phải: dính trên màn hình rộng để luôn thấy trạng thái + nút thao tác */}
          <aside aria-label="Thông tin và thao tác" className="order-1 md:order-2 md:sticky md:top-0">
            {side}
          </aside>
        </div>

        <div className="sticky bottom-0 p-3 bg-surface-container-low border-t border-surface-container-high flex items-center justify-between gap-2">
          {isEditing ? (
            <button onClick={() => setIsEditing(false)} type="button" disabled={saving} className={ghostButtonCls}>
              Huỷ sửa
            </button>
          ) : (
            <button onClick={requestClose} type="button" className={ghostButtonCls}>
              Đóng lại
            </button>
          )}
          {canArchive && !isEditing && (item.archivedAt || !item.archived) && (
            <button onClick={() => handleSetArchived(!item.archivedAt)} type="button" disabled={busy} className={`${ghostButtonCls} ml-auto`}>
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">
                {item.archivedAt ? 'unarchive' : 'inventory_2'}
              </span>
              {archiving ? 'Đang xử lý…' : item.archivedAt ? 'Khôi phục' : 'Lưu trữ'}
            </button>
          )}
          {!canEdit ? (
            item.archivedAt && canArchive ? null : (
              <span className="text-xs text-secondary italic px-3">
                {item.archived
                  ? 'Đã lưu trữ — chỉ đọc'
                  : currentUser?.role === 'board' || currentUser?.role === 'director'
                    ? 'Chế độ chỉ đọc'
                    : 'Bạn không có quyền chỉnh sửa mục này'}
              </span>
            )
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
