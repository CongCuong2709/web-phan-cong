import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import { api, WeeklyReportHistoryDto } from '../lib/apiClient';

// =============================================================================
// WeeklyReportView — báo cáo tuần (2 chế độ dùng chung 1 component).
//
//   mode='edit'   → Nhân viên tự soạn (bảng nhập liệu + cột "Phản hồi của QL").
//   mode='review' → Trưởng phòng phản hồi (nội dung NV hiển thị dạng text,
//                    ô trống → "—", KHÔNG placeholder; thêm cột "Chỉ đạo của QL"
//                    + khung nhận xét chung + nút xác nhận đã xem).
//
// Ponytail: 1 file, không component con. 2 mode dùng chung 1 bảng nên không
// phải viết lại markup; khác biệt chỉ ở chỗ render ô.
// =============================================================================

type Mode = 'edit' | 'review';

type Row = {
  id: string;
  name: string;
  result: string;
  status: 'Hoàn thành' | 'Đang làm' | 'Chưa bắt đầu' | 'Vướng mắc';
  blocker: string;
  /** Chỉ đạo của QL cho dòng này (chỉ có khi QL đã phản hồi). */
  mgr_comment: string;
};

const STATUS_META: Record<Row['status'], { dot: string; color: string }> = {
  'Hoàn thành': { dot: 'dot-green', color: 'var(--color-tertiary)' },
  'Đang làm': { dot: 'dot-amber', color: 'var(--color-warning)' },
  'Chưa bắt đầu': { dot: 'dot-gray', color: 'var(--color-secondary)' },
  'Vướng mắc': { dot: 'dot-red', color: 'var(--color-error)' },
};

const NEW_ROW = (): Row => ({
  id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name: '', result: '', status: 'Chưa bắt đầu', blocker: '',
  mgr_comment: '',
});

// ── Helpers ngày tuần ────────────────────────────────────────────────────────
export function weekStartOf(d = new Date()): string {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // về thứ 2
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function isoWeek(d = new Date()): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = (t.getTime() - firstThu.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}
const fmtDateVI = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const fmtTime = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/**
 * "2026-10-22 07:30:00" (SQLite datetime('now') = UTC) → "22/10/2026 14:30"
 * theo giờ địa phương của trình duyệt. Đây là nguồn duy nhất cho cả 2 view
 * (WeeklyReportView + WeeklyReportTeamView) để mốc thời gian không lệch nhau.
 */
export function fmtStamp(sqlStamp: string | null | undefined): string {
  if (!sqlStamp) return '';
  const m = sqlStamp.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${fmtTime(d)}`;
}

interface Props {
  currentUser: User;
  /** 'edit' = NV soạn, 'review' = QL phản hồi. Mặc định 'edit'. */
  mode?: Mode;
  /** NV mà QL đang xem (chỉ dùng ở mode='review'). */
  targetUser?: { fullname: string; username: string; userId: number; departments?: string[] };
  targetUserId?: number;
  /** Quay lại danh sách (nút back ở mode review). */
  onBack?: () => void;
  /** Tuần khởi tạo (team view truyền vào khi drill-down). */
  week?: string;
  onToast?: (msg: string, type?: 'success' | 'error' | 'warning') => void;
}

export const WeeklyReportView: React.FC<Props> = ({
  currentUser, mode = 'edit', targetUser, targetUserId, onBack, week, onToast,
}) => {
  const isReview = mode === 'review';
  const canEdit = mode === 'edit';
  // Chỉ quản lý/admin phản hồi được (POST /review); BGĐ xem báo cáo ở chế độ chỉ đọc.
  const canRespond = isReview && (currentUser.role === 'manager' || currentUser.role === 'admin');

  const [weekStart, setWeekStart] = useState<string>(() => week ?? weekStartOf());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);   // lúc NV bấm Lưu
  const [dirty, setDirty] = useState(false);                      // bản nháp NV chưa lưu
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<WeeklyReportHistoryDto[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // ── Phản hồi của QL ──
  const [managerNote, setManagerNote] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [reviewDirty, setReviewDirty] = useState(false);          // phản hồi QL chưa lưu
  const [reviewSaving, setReviewSaving] = useState(false);
  const [acked, setAcked] = useState(false);
  const [ackAt, setAckAt] = useState<string | null>(null);

  const viewerId = isReview ? targetUserId : undefined;

  // ── Load report ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getWeeklyReport(weekStart, viewerId).then((r) => {
      if (cancelled) return;
      const item = r.ok ? r.data?.item : null;
      const remote = item?.rows as Row[] | undefined;
      setRows(
        remote && remote.length
          ? remote.map((x) => ({ ...x, mgr_comment: x.mgr_comment ?? '' }))
          : [NEW_ROW()]
      );
      setSavedAt(item?.updated_at ?? null);
      setManagerNote(item?.manager_note ?? '');
      setNoteDraft(item?.manager_note ?? '');
      setAcked(item?.ack_user_id != null);
      setAckAt(item?.ack_at ?? null);
      setDirty(false);
      setReviewDirty(false);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [weekStart, viewerId]);

  // ── Lịch sử tuần (chỉ NV xem báo cáo của chính mình) ──
  useEffect(() => {
    if (isReview) return;
    let cancelled = false;
    api.getWeeklyReportHistory(26).then((r) => {
      if (cancelled || !r.ok) return;
      setHistory(r.data.items);
    });
    return () => { cancelled = true; };
  }, [isReview, weekStart, savedAt]);

  // ── Cảnh báo rời trang khi còn thay đổi chưa lưu ──
  useEffect(() => {
    if (!dirty && !reviewDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, reviewDirty]);

  // ── Lưu báo cáo (NV) ──
  const saveReport = useCallback(async () => {
    if (saving || !dirty) return;
    setSaving(true);
    const r = await api.putWeeklyReport({ week_start: weekStart, rows });
    setSaving(false);
    if (r.ok) {
      setSavedAt(fmtTime());
      setDirty(false);
      onToast?.('Đã lưu báo cáo tuần.');
    } else {
      onToast?.(r.error.message || 'Lưu thất bại.', 'error');
    }
  }, [saving, dirty, weekStart, rows, onToast]);

  // ── Lưu phản hồi (QL) ──
  const saveReview = useCallback(async (alsoAck = false) => {
    if (!targetUserId || reviewSaving) return;
    setReviewSaving(true);
    const r = await api.reviewWeeklyReport(targetUserId, {
      week_start: weekStart,
      manager_note: noteDraft,
      ack: alsoAck || undefined,
      rows: rows.map((x) => ({ id: x.id, mgr_comment: x.mgr_comment })),
    });
    setReviewSaving(false);
    if (r.ok) {
      setManagerNote(r.data.manager_note);
      setReviewDirty(false);
      if (alsoAck) {
        setAcked(true);
        // Giữ stamp thô từ backend để fmtStamp() parse đúng (chuyển UTC → giờ máy).
        setAckAt(r.data.ack_at ?? new Date().toISOString().replace('T', ' ').slice(0, 19));
        onToast?.('Đã xác nhận báo cáo của nhân viên.');
      } else {
        onToast?.('Đã lưu phản hồi.');
      }
    } else {
      onToast?.(r.error.message || 'Lưu phản hồi thất bại.', 'error');
    }
  }, [targetUserId, reviewSaving, weekStart, noteDraft, rows, onToast]);

  // ── Mutations phía NV ──
  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () => {
    setRows((prev) => [...prev, NEW_ROW()]);
    setDirty(true);
  };
  const removeRow = (idx: number) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [NEW_ROW()];
    });
    setDirty(true);
  };

  // ── Mutations phía QL (chỉ đạo từng dòng) ──
  const updateMgr = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setReviewDirty(true);
  };

  // ── Chuyển tuần: chặn khi còn thay đổi chưa lưu ──
  const trySwitchWeek = useCallback((target: string): boolean => {
    if (dirty) {
      onToast?.(`Báo cáo tuần ${isoWeek(new Date(weekStart))} chưa lưu — hãy lưu trước khi chuyển tuần.`, 'warning');
      return false;
    }
    if (reviewDirty) {
      onToast?.('Phản hồi chưa lưu — hãy lưu trước khi chuyển tuần.', 'warning');
      return false;
    }
    setWeekStart(target);
    return true;
  }, [dirty, reviewDirty, weekStart, onToast]);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const isCurrentWeek = weekStart === weekStartOf();
  const canGoNext = weekEnd < weekStartOf();

  // ── Render helpers ──
  /** Ô nội dung của NV. review → text thuần, trống hiện "—" (KHÔNG placeholder). */
  const empCell = (idx: number, field: 'name' | 'result' | 'blocker', ph: string) => {
    const value = rows[idx][field];
    if (isReview) {
      return <td>{value ? value : <span className="text-outline-variant">—</span>}</td>;
    }
    return (
      <td
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => updateRow(idx, { [field]: (e.currentTarget.textContent ?? '').trim() } as Partial<Row>)}
        data-ph={ph}
        className="border-r border-surface-container align-middle empty:before:content-[attr(data-ph)] empty:before:text-outline-variant empty:before:italic focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset hover:bg-surface hover:outline hover:outline-1 hover:outline-outline-variant"
      >{value}</td>
    );
  };

  /** Ô trạng thái: NV đổi được; review → text tĩnh. */
  const statusCell = (idx: number) => {
    const meta = STATUS_META[rows[idx].status];
    if (isReview) {
      return (
        <td>
          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: meta.color }}>
            <span className={`dot ${meta.dot}`} />{rows[idx].status}
          </span>
        </td>
      );
    }
    return (
      <td className="border-r border-surface-container relative align-middle">
        <span className={`dot ${meta.dot}`} />
        <select
          value={rows[idx].status}
          onChange={(e) => updateRow(idx, { status: e.target.value as Row['status'] })}
          className="appearance-none bg-transparent border border-transparent hover:border-surface-container focus:border-primary focus:bg-white rounded px-2 py-1 pl-5 font-medium text-sm cursor-pointer w-full focus:outline-none"
          style={{ color: meta.color }}
        >
          <option>Hoàn thành</option>
          <option>Đang làm</option>
          <option>Chưa bắt đầu</option>
          <option>Vướng mắc</option>
        </select>
      </td>
    );
  };

  /** Cột phản hồi/chỉ đạo của QL (cột 6). */
  const mgrCell = (idx: number) => {
    const r = rows[idx];
    if (canRespond) {
      return (
        <td className="bg-surface">
          <div
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => updateMgr(idx, { mgr_comment: (e.currentTarget.textContent ?? '').trim() })}
            data-ph="Ghi chỉ đạo cho dòng này…"
            className="empty:before:content-[attr(data-ph)] empty:before:text-outline-variant empty:before:italic focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset hover:bg-white hover:outline hover:outline-1 hover:outline-outline-variant rounded px-1 py-0.5 mb-1"
          >{r.mgr_comment}</div>
        </td>
      );
    }
    // NV / BGĐ: chỉ đọc chỉ đạo của QL
    if (!r.mgr_comment) {
      return <td className="bg-surface"><span className="text-outline-variant">—</span></td>;
    }
    return (
      <td className="bg-surface">{r.mgr_comment}</td>
    );
  };

  const hasAnyContent = rows.some((r) => r.name || r.result || r.blocker);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
      {/* ===== Header bản in ===== */}
      <div className="hidden print:block mb-4 pb-3 border-b-2 border-on-surface">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-bold uppercase">Báo cáo công việc tuần</div>
            <div className="text-xs text-secondary mt-0.5">
              {targetUser ? targetUser.fullname : currentUser.fullname}
              {targetUser?.departments?.length ? ` · ${targetUser.departments.join(', ')}` : ''}
            </div>
          </div>
          <div className="text-right text-xs text-secondary leading-relaxed">
            <div>Tuần {isoWeek(new Date(weekStart))} · {fmtDateVI(weekStart)} – {fmtDateVI(weekEnd)}</div>
            <div>{isReview ? 'Trưởng phòng' : 'Nhân viên'} nộp {fmtStamp(savedAt)}</div>
          </div>
        </div>
      </div>

      {/* ===== Toolbar ===== */}
      <div className="flex items-start justify-between gap-3 mb-3 print:hidden">
        <div className="min-w-0">
          {isReview && onBack && (
            <button type="button"
              onClick={onBack}
              className="text-sm text-secondary hover:text-primary mb-1"
            >← Báo cáo tuần phòng ban</button>
          )}
          <div className="flex items-center gap-2">
            {isReview && targetUser && (
              <div className="w-8 h-8 rounded-full bg-surface-container-high text-primary flex items-center justify-center text-sm font-bold shrink-0">
                {targetUser.fullname.trim().charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="text-lg font-semibold tracking-tight">
              {isReview && targetUser ? (
                <>
                  {targetUser.fullname}
                  <span className="text-secondary font-normal">
                    {targetUser.departments?.length ? ` · NV.${targetUser.departments.join('.')}` : ''}
                  </span>
                </>
              ) : (
                <>Báo cáo tuần {isoWeek(new Date(weekStart))}</>
              )}
            </h1>
            <div className="flex items-center">
              <button type="button"
                className="px-2 py-1 rounded-md hover:bg-surface-container text-xs text-secondary"
                onClick={() => trySwitchWeek(addDays(weekStart, -7))}
              >Tuần trước</button>
              <button type="button"
                className="px-2 py-1 rounded-md hover:bg-surface-container disabled:opacity-40 text-xs text-secondary"
                onClick={() => trySwitchWeek(addDays(weekStart, 7))}
                disabled={!canGoNext}
              >Tuần sau</button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-secondary">
            <span>Tuần {isoWeek(new Date(weekStart))} ({fmtDateVI(weekStart)} – {fmtDateVI(weekEnd)})</span>
            {savedAt && (
              <>
                <span className="text-outline-variant">|</span>
                <span>Nộp lúc {fmtStamp(savedAt)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isReview && (
            <span className="text-xs font-medium">
              {dirty ? (
                <span className="text-warning">● Có thay đổi chưa lưu</span>
              ) : savedAt ? (
                <span className="text-secondary">Đã lưu · {fmtStamp(savedAt)}</span>
              ) : null}
            </span>
          )}
          {isReview && reviewDirty && (
            <span className="text-xs text-warning font-medium">● Phản hồi chưa lưu</span>
          )}

          {/* Lịch sử tuần — chỉ NV (bỏ qua ở mode review) */}
          {!isReview && (
            <div className="relative">
              <button type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-surface-container text-sm font-medium text-secondary hover:bg-surface"
                onClick={() => setShowHistory((v) => !v)}
              >Lịch sử tuần</button>
              {showHistory && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowHistory(false)} />
                  <div className="absolute right-0 top-full mt-1.5 w-[300px] bg-white border border-surface-container rounded-[10px] shadow-[0_8px_24px_rgba(15,23,42,0.10)] z-40 overflow-hidden">
                    <div className="px-3 py-2 border-b border-surface-container text-xs font-semibold uppercase tracking-wider text-outline">
                      Tuần đã lập
                    </div>
                    <div className="max-h-[280px] overflow-y-auto py-1">
                      {history.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-outline-variant text-center">
                          Chưa có tuần nào đã lưu
                        </div>
                      ) : history.map((h) => (
                        <div
                          key={h.week_start}
                          className={`flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer ${
                            h.week_start === weekStart ? 'bg-surface-container-low font-medium' : 'hover:bg-surface'
                          }`}
                          onClick={() => { if (trySwitchWeek(h.week_start)) setShowHistory(false); }}
                        >
                          <span className="flex items-center gap-2">
                            Tuần {isoWeek(new Date(h.week_start))}
                            <span className="text-outline text-xs">
                              {fmtDateVI(h.week_start)} – {fmtDateVI(h.week_end)}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 text-xs text-secondary shrink-0">
                            {h.blocked_count > 0 && (
                              <span className="inline-flex items-center gap-1 text-error">
                                <span className="w-1.5 h-1.5 rounded-full bg-error" />{h.blocked_count}
                              </span>
                            )}
                            {h.row_count} dòng
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <button type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-surface-container text-sm font-medium text-secondary hover:bg-surface"
            onClick={() => window.print()}
            title="In hoặc lưu PDF"
          >In / PDF</button>

          {/* NV: Lưu báo cáo (chỉ tuần hiện tại) */}
          {canEdit && isCurrentWeek && (
            <button type="button"
              className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-white shadow-sm hover:bg-on-primary-fixed-variant disabled:bg-primary-fixed-dim disabled:cursor-not-allowed"
              disabled={!dirty || saving}
              onClick={saveReport}
            >{saving ? 'Đang lưu…' : 'Lưu báo cáo'}</button>
          )}

          {/* QL: Xác nhận đã xem — KHÔNG phải duyệt (không có trạng thái từ chối) */}
          {canRespond && (
            <button type="button"
              className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                acked
                  ? 'bg-tertiary-fixed/30 text-tertiary border border-tertiary-fixed-dim'
                  : 'bg-tertiary text-white hover:bg-on-tertiary-fixed-variant'
              }`}
              disabled={reviewSaving}
              onClick={() => saveReview(true)}
            >{acked ? 'Đã xác nhận' : 'Xác nhận đã xem'}</button>
          )}
        </div>
      </div>

      {/* ===== Nhận xét chung của QL ===== */}
      {!loading && (
        canRespond ? (
          <div className="border border-surface-container rounded-lg p-3 mb-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="text-xs font-semibold">
                Nhận xét chung cho tuần này
              </div>
              <span className="text-xs text-outline">
                Nhân viên sẽ thấy nhận xét này trong báo cáo tuần của họ
              </span>
            </div>
            <div
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => {
                setNoteDraft(e.currentTarget.textContent ?? '');
                setReviewDirty(true);
              }}
              data-ph="Nhận xét tổng quan về tuần làm việc…"
              className="text-sm leading-relaxed outline-none rounded-md px-2 py-1.5 empty:before:content-[attr(data-ph)] empty:before:text-outline-variant empty:before:italic hover:bg-surface focus:bg-white focus:ring-2 focus:ring-primary"
            >{managerNote}</div>
            <div className="flex items-center justify-between gap-2 mt-2">
              <span className="text-xs text-tertiary">
                {acked ? `Đã xác nhận lúc ${fmtStamp(ackAt)}` : <span className="text-outline">Chưa xác nhận</span>}
              </span>
              <button type="button"
                className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-white hover:bg-on-primary-fixed-variant disabled:bg-primary-fixed-dim disabled:cursor-not-allowed"
                disabled={!reviewDirty || reviewSaving}
                onClick={() => saveReview(false)}
              >{reviewSaving ? 'Đang lưu…' : 'Lưu nhận xét'}</button>
            </div>
          </div>
        ) : managerNote ? (
          <div className="border border-surface-container-high bg-surface rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold">Nhận xét của Trưởng phòng</span>
              {ackAt && <span className="text-xs text-outline ml-auto">{fmtStamp(ackAt)}</span>}
            </div>
            <div className="text-sm leading-relaxed">{managerNote}</div>
          </div>
        ) : null
      )}

      {/* ===== Bảng ===== */}
      <div className="border border-surface-container rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse table-fixed text-sm">
            <colgroup>
              <col style={{ width: 36 }} />
              <col />
              <col />
              <col style={{ width: isReview ? 150 : 170 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 220 }} />
              {canEdit && <col style={{ width: 32 }} />}
            </colgroup>
            <thead>
              <tr className="bg-surface text-left">
                <th className="text-center font-semibold text-xs text-secondary py-2 px-3 border-b border-surface-container">#</th>
                <th className="font-semibold text-xs text-secondary py-2 px-3 border-b border-surface-container">Tên công việc</th>
                <th className="font-semibold text-xs text-secondary py-2 px-3 border-b border-surface-container">Kết quả trong tuần</th>
                <th className="font-semibold text-xs text-secondary py-2 px-3 border-b border-surface-container">Trạng thái</th>
                <th className="font-semibold text-xs text-secondary py-2 px-3 border-b border-surface-container">Vướng mắc / Đề xuất</th>
                <th className="font-semibold text-xs py-2 px-3 border-b border-surface-container bg-surface-container-low text-primary">
                  {isReview ? 'Chỉ đạo của QL' : 'Phản hồi của QL'}
                </th>
                {canEdit && <th className="border-b border-surface-container" />}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center text-xs text-outline py-8">Đang tải…</td></tr>
              ) : isReview && !hasAnyContent ? (
                <tr><td colSpan={7} className="text-center text-xs text-outline py-8">
                  Nhân viên chưa lập báo cáo cho tuần này
                </td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.id} className="group hover:bg-surface border-b border-surface-container">
                    <td className="text-center text-xs text-outline py-2 px-3 bg-surface select-none tabular-nums align-top pt-2.5">
                      {idx + 1}
                    </td>
                    {empCell(idx, 'name', 'Nhập tên công việc…')}
                    {empCell(idx, 'result', 'Sản phẩm/kết quả…')}
                    {statusCell(idx)}
                    {empCell(idx, 'blocker', 'Cần hỗ trợ từ…')}
                    {mgrCell(idx)}
                    {canEdit && (
                      <td className="text-center align-top px-1 pt-1.5">
                        <button type="button"
                          onClick={() => removeRow(idx)}
                          title="Xoá dòng"
                          className="w-5 h-5 inline-flex items-center justify-center rounded text-xs leading-none text-outline opacity-0 group-hover:opacity-100 transition-opacity hover:bg-error-container hover:text-error"
                        >×</button>
                      </td>
                    )}
                  </tr>
                ))
              )}

              {/* Dòng "+ Thêm dòng mới" — chỉ NV, chỉ tuần hiện tại */}
              {!loading && canEdit && isCurrentWeek && (
                <tr
                  className="text-outline-variant hover:bg-surface hover:text-primary cursor-pointer"
                  onClick={addRow}
                >
                  <td className="text-center text-sm py-2.5 bg-surface">+</td>
                  <td colSpan={6} className="py-2.5 px-3 text-sm text-outline-variant">
                    + Thêm dòng mới
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Footer trạng thái ===== */}
      <div className="mt-3 text-xs text-outline print:hidden">
        {isReview
          ? (acked
              ? `Trưởng phòng đã xác nhận báo cáo lúc ${fmtStamp(ackAt)}.`
              : 'Chưa xác nhận báo cáo.')
          : isCurrentWeek
            ? 'Tuần hiện tại — đang mở chỉnh sửa.'
            : 'Tuần đã đóng (chỉ đọc).'}
      </div>
    </div>
  );
};