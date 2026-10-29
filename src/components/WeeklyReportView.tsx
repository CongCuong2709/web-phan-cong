import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import { api, WeeklyReportHistoryDto } from '../lib/apiClient';

// =============================================================================
// WeeklyReportView — báo cáo tuần (2 chế độ dùng chung 1 component).
//
//   mode='edit'   → Nhân viên / Trưởng phòng tự soạn báo cáo của mình.
//   mode='review' → Xem báo cáo của người khác (chỉ đọc; ô trống → "—").
//
// Không có bước duyệt hay phản hồi: công ty vận hành bằng niềm tin.
// =============================================================================

type Mode = 'edit' | 'review';

type Row = {
  id: string;
  name: string;
  result: string;
  status: 'Hoàn thành' | 'Đang làm' | 'Chưa bắt đầu' | 'Vướng mắc';
  blocker: string;
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
  /** 'edit' = tự soạn báo cáo của mình, 'review' = xem báo cáo người khác. Mặc định 'edit'. */
  mode?: Mode;
  /** Người đang được xem (chỉ dùng ở mode='review'). */
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

  const [weekStart, setWeekStart] = useState<string>(() => week ?? weekStartOf());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);   // lúc NV bấm Lưu
  const [dirty, setDirty] = useState(false);                      // bản nháp NV chưa lưu
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<WeeklyReportHistoryDto[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const viewerId = isReview ? targetUserId : undefined;

  // ── Load report ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getWeeklyReport(weekStart, viewerId).then((r) => {
      if (cancelled) return;
      const item = r.ok ? r.data?.item : null;
      const remote = item?.rows as Row[] | undefined;
      setRows(remote && remote.length ? remote : [NEW_ROW()]);
      setSavedAt(item?.updated_at ?? null);
      setDirty(false);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [weekStart, viewerId]);

  // ── Lịch sử tuần (chỉ khi xem báo cáo của chính mình) ──
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
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── Lưu báo cáo ──
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

  // ── Sửa bảng ──
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

  // ── Chuyển tuần: chặn khi còn thay đổi chưa lưu ──
  const trySwitchWeek = useCallback((target: string): boolean => {
    if (dirty) {
      onToast?.(`Báo cáo tuần ${isoWeek(new Date(weekStart))} chưa lưu — hãy lưu trước khi chuyển tuần.`, 'warning');
      return false;
    }
    setWeekStart(target);
    return true;
  }, [dirty, weekStart, onToast]);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const isCurrentWeek = weekStart === weekStartOf();
  const canGoNext = weekEnd < weekStartOf();

  // ── Render helpers ──
  /** Ô nội dung. review → text thuần, trống hiện "—" (KHÔNG placeholder). */
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

  /** Ô trạng thái: người viết đổi được; review → text tĩnh. */
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
            <div>Nộp lúc {fmtStamp(savedAt)}</div>
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
            >← Báo cáo tuần</button>
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
                    {targetUser.departments?.length ? ` · ${targetUser.departments.join(', ')}` : ''}
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
          {/* Lịch sử tuần — chỉ báo cáo của chính mình (bỏ qua ở mode review) */}
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

          {/* Lưu báo cáo (chỉ tuần hiện tại) */}
          {canEdit && isCurrentWeek && (
            <button type="button"
              className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-white shadow-sm hover:bg-on-primary-fixed-variant disabled:bg-primary-fixed-dim disabled:cursor-not-allowed"
              disabled={!dirty || saving}
              onClick={saveReport}
            >{saving ? 'Đang lưu…' : 'Lưu báo cáo'}</button>
          )}

        </div>
      </div>

      {/* ===== Bảng ===== */}
      <div className="border border-surface-container rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse table-fixed text-sm">
            <colgroup>
              <col style={{ width: 36 }} />
              <col />
              <col />
              <col style={{ width: isReview ? 150 : 170 }} />
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
                {canEdit && <th className="border-b border-surface-container" />}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center text-xs text-outline py-8">Đang tải…</td></tr>
              ) : isReview && !hasAnyContent ? (
                <tr><td colSpan={6} className="text-center text-xs text-outline py-8">
                  Chưa lập báo cáo cho tuần này
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

              {/* Dòng "+ Thêm dòng mới" — chỉ người viết, chỉ tuần hiện tại */}
              {!loading && canEdit && isCurrentWeek && (
                <tr
                  className="text-outline-variant hover:bg-surface hover:text-primary cursor-pointer"
                  onClick={addRow}
                >
                  <td className="text-center text-sm py-2.5 bg-surface">+</td>
                  <td colSpan={5} className="py-2.5 px-3 text-sm text-outline-variant">
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
          ? 'Chỉ đọc — người viết tự cập nhật báo cáo của mình trong tuần.'
          : isCurrentWeek
            ? 'Tuần hiện tại — đang mở chỉnh sửa.'
            : 'Tuần đã đóng (chỉ đọc).'}
      </div>
    </div>
  );
};