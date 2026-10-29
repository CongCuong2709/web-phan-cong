import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { isDeptScoped } from '../auth/permissions';
import { api, WeeklyTeamMemberDto } from '../lib/apiClient';
import { WeeklyReportView, fmtStamp } from './WeeklyReportView';

// =============================================================================
// WeeklyReportTeamView — tổng hợp báo cáo tuần của người viết (Trưởng phòng + Nhân viên).
//
// 1 bảng danh sách + drill-down bằng WeeklyReportView mode='review' (chỉ đọc).
// Phạm vi do backend lọc: Trưởng phòng = phòng mình; HĐQT, Điều hành = toàn công ty.
// Không có bước duyệt / xác nhận.
// =============================================================================

interface Props {
  currentUser: User;
  onToast?: (msg: string, type?: 'success' | 'error' | 'warning') => void;
}

function weekStartOf(d = new Date()): string {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function fmtDateVI(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function initialOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || name).charAt(0).toUpperCase();
}
/** "2026-10-22 07:35:00" (UTC) → "22/10 14:35" (giờ VN). */
function fmtShort(sqlStamp: string): string {
  return fmtStamp(sqlStamp).replace(/^(\d{2}\/\d{2})\/\d{4}/, '$1');
}

export const WeeklyReportTeamView: React.FC<Props> = ({ currentUser, onToast }) => {
  const [weekStart, setWeekStart] = useState<string>(() => weekStartOf());
  const [items, setItems] = useState<WeeklyTeamMemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  /** Người đang drill-down; null = đang ở danh sách. */
  const [openUser, setOpenUser] = useState<WeeklyTeamMemberDto | null>(null);

  const load = useCallback((week: string) => {
    setLoading(true);
    api.getWeeklyReportTeam(week).then((r) => {
      if (r.ok) setItems(r.data.items);
      else {
        setItems([]);
        onToast?.(r.error.message || 'Không tải được tổng hợp báo cáo tuần.', 'error');
      }
      setLoading(false);
    });
  }, [onToast]);

  useEffect(() => { load(weekStart); }, [weekStart, load]);

  const weekEnd = addDays(weekStart, 6);
  const canGoNext = weekEnd < weekStartOf();

  // Stats nhẹ — chỉ đủ để biết "còn ai chưa nộp / có vướng gì không".
  const submitted = items.filter((i) => i.submitted).length;
  const pending = items.length - submitted;
  const totalBlocked = items.reduce((s, i) => s + i.blocked_count, 0);
  const scope = isDeptScoped(currentUser) ? 'phòng ban' : 'toàn công ty';

  // ── Drill-down: tái dùng WeeklyReportView ở chế độ review (chỉ đọc) ──
if (openUser) {
    return (
      <WeeklyReportView
        currentUser={currentUser}
        mode="review"
        targetUserId={openUser.user_id}
        targetUser={{
          fullname: openUser.fullname,
          username: openUser.username,
          userId: openUser.user_id,
          departments: openUser.departments,
        }}
        week={weekStart}
        onBack={() => setOpenUser(null)}
        onToast={onToast}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
      {/* ===== Toolbar ===== */}
      <div className="flex items-center justify-between gap-3 mb-3 print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold tracking-tight whitespace-nowrap">
            Báo cáo tuần {scope}
            <span className="text-secondary font-normal"> ({fmtDateVI(weekStart)} – {fmtDateVI(weekEnd)})</span>
          </h1>
          <div className="flex items-center">
            <button type="button"
              className="px-2 py-1 rounded-md hover:bg-surface-container text-xs text-secondary"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >Tuần trước</button>
            <button type="button"
              className="px-2 py-1 rounded-md hover:bg-surface-container disabled:opacity-40 text-xs text-secondary"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              disabled={!canGoNext}
            >Tuần sau</button>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 print:hidden">
          <button type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-surface-container text-sm font-medium text-secondary hover:bg-surface"
            onClick={() => window.print()}
          >In / PDF</button>
        </div>
      </div>

      {/* ===== Header bản in ===== */}
      <div className="hidden print:block mb-4 pb-3 border-b-2 border-on-surface">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-bold uppercase">Báo cáo công việc tuần — {currentUser.fullname}</div>
            <div className="text-xs text-secondary mt-0.5">
              {fmtDateVI(weekStart)} – {fmtDateVI(weekEnd)} · {submitted}/{items.length} người đã lập
            </div>
          </div>
          <div className="text-right text-xs text-secondary">In ngày {fmtDateVI(weekStartOf())}</div>
        </div>
      </div>

      {/* ===== Tổng kết 1 dòng (chỉ khi có data — không phải stat card) ===== */}
      {!loading && items.length > 0 && (
        <div className="flex items-center gap-4 mb-2 text-xs text-secondary">
          <span>{submitted}/{items.length} đã lập</span>
          {pending > 0 && <span className="text-warning">{pending} chưa lập</span>}
          {totalBlocked > 0 && (
            <span className="inline-flex items-center gap-1.5 text-error">
              <span className="w-1.5 h-1.5 rounded-full bg-error" />
              {totalBlocked} vướng mắc
            </span>
          )}
        </div>
      )}

      {/* ===== Bảng ===== */}
      <div className="border border-surface-container rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse table-fixed text-sm">
            <colgroup>
              <col style={{ width: 40 }} />
              <col />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 120 }} />
            </colgroup>
            <thead>
              <tr className="bg-surface text-left">
                <th className="text-center font-semibold text-xs text-secondary py-2 px-3 border-b border-r border-surface-container">#</th>
                <th className="font-semibold text-xs text-secondary py-2 px-3 border-b border-r border-surface-container">Người viết</th>
                <th className="font-semibold text-xs text-secondary py-2 px-3 border-b border-r border-surface-container">Phòng ban</th>
                <th className="text-center font-semibold text-xs text-secondary py-2 px-3 border-b border-r border-surface-container">Số đầu việc</th>
                <th className="text-center font-semibold text-xs text-secondary py-2 px-3 border-b border-r border-surface-container">Vướng mắc</th>
                <th className="font-semibold text-xs text-secondary py-2 px-3 border-b border-r border-surface-container">Báo cáo</th>
                <th className="font-semibold text-xs text-secondary py-2 px-3 border-b border-surface-container">Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center text-xs text-outline py-8">Đang tải…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-xs text-outline py-8">Chưa có ai trong phạm vi xem</td></tr>
              ) : (
                items.map((m, idx) => (
                  <tr
                    key={m.user_id}
                    className="hover:bg-surface border-b border-surface-container last:border-b-0"
                    onClick={() => setOpenUser(m)}
                    style={{ cursor: 'pointer', opacity: m.submitted ? 1 : 0.65 }}
                  >
                    <td className="text-center text-xs text-outline py-2 px-3 bg-surface tabular-nums border-r border-surface-container">{idx + 1}</td>
                    <td className="px-3 py-2 border-r border-surface-container">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-surface-container-high text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {initialOf(m.fullname)}
                        </div>
                        <span className={m.submitted ? 'font-medium' : 'text-secondary'}>{m.fullname}</span>
                        {m.is_head && (
                          <span className="text-xs text-primary bg-surface-container-low rounded px-1.5">Trưởng phòng</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-secondary text-xs border-r border-surface-container">{m.departments.join(', ') || '—'}</td>
                    <td className="text-center py-2 px-3 tabular-nums border-r border-surface-container">
                      {m.submitted ? m.row_count : <span className="text-outline-variant">—</span>}
                    </td>
                    <td className="text-center py-2 px-3 tabular-nums border-r border-surface-container">
                      {m.submitted ? (
                        m.blocked_count > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-error">
                            <span className="w-1.5 h-1.5 rounded-full bg-error" />
                            {m.blocked_count}
                          </span>
                        ) : <span className="text-outline-variant">0</span>
                      ) : <span className="text-outline-variant">—</span>}
                    </td>
                    <td className="px-3 py-2 border-r border-surface-container">
                      {m.submitted ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-tertiary">
                          <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
                          Đã lập
                        </span>
                      ) : (
                        <span className="text-xs text-outline">Chưa lập</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m.updated_at ? (
                        <span className="text-xs text-secondary">{fmtShort(m.updated_at)}</span>
                      ) : (
                        <span className="text-xs text-outline-variant">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};