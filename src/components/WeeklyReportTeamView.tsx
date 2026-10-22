import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { api, WeeklyTeamMemberDto } from '../lib/apiClient';
import { WeeklyReportView, fmtStamp } from './WeeklyReportView';

// =============================================================================
// WeeklyReportTeamView — P1: Quản lý xem tổng hợp báo cáo tuần phòng ban.
//
// Ponytail: không có component con. 1 bảng danh sách NV + drill-down bằng cách
// tái sử dụng WeeklyReportView với `readOnly` (không viết lại markup bảng).
// Backend đã lọc theo departments của manager → FE không cần lọc lại.
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
function fmtAck(sqlStamp: string): string {
  return fmtStamp(sqlStamp).replace(/^\d{2}\/\d{2}\//, '');
}

export const WeeklyReportTeamView: React.FC<Props> = ({ currentUser, onToast }) => {
  const [weekStart, setWeekStart] = useState<string>(() => weekStartOf());
  const [items, setItems] = useState<WeeklyTeamMemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  /** NV đang drill-down; null = đang ở danh sách. */
  const [openUser, setOpenUser] = useState<WeeklyTeamMemberDto | null>(null);

  const load = useCallback((week: string) => {
    setLoading(true);
    api.getWeeklyReportTeam(week).then((r) => {
      if (r.ok) setItems(r.data.items);
      else {
        setItems([]);
        onToast?.(r.error.message || 'Không tải được tổng hợp phòng ban.', 'error');
      }
      setLoading(false);
    });
  }, [onToast]);

  useEffect(() => { load(weekStart); }, [weekStart, load]);

  const weekEnd = addDays(weekStart, 6);
  const canGoNext = weekEnd < weekStartOf();

  // Stats nhẹ — chỉ đủ để QL biết "còn ai chưa nộp / có vướng gì không".
  const submitted = items.filter((i) => i.submitted).length;
  const pending = items.length - submitted;
  const totalBlocked = items.reduce((s, i) => s + i.blocked_count, 0);
  const ackedCount = items.filter((i) => i.ack_at).length;

  // ── Drill-down: tái dùng WeeklyReportView ở chế độ review (QL ghi phản hồi) ──
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
    <div className="max-w-[1100px] mx-auto px-6 py-6">
      {/* ===== Toolbar ===== */}
      <div className="flex items-center justify-between gap-3 mb-3 print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[18px] font-semibold tracking-tight whitespace-nowrap">
            Báo cáo tuần phòng ban
            <span className="text-[#5b6371] font-normal"> ({fmtDateVI(weekStart)} – {fmtDateVI(weekEnd)})</span>
          </h1>
          <div className="flex items-center">
            <button
              className="px-2 py-1 rounded-md hover:bg-[#eef2f8] text-[12px] text-[#5b6371]"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >Tuần trước</button>
            <button
              className="px-2 py-1 rounded-md hover:bg-[#eef2f8] disabled:opacity-40 text-[12px] text-[#5b6371]"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              disabled={!canGoNext}
            >Tuần sau</button>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 print:hidden">
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#dfe3ec] text-[13px] font-medium text-[#4b5462] hover:bg-[#f6f8fc]"
            onClick={() => window.print()}
          >In / PDF</button>
        </div>
      </div>

      {/* ===== Header bản in ===== */}
      <div className="hidden print:block mb-4 pb-3 border-b-2 border-[#1f2330]">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[13px] font-bold uppercase">Báo cáo công việc tuần — {currentUser.fullname}</div>
            <div className="text-[11px] text-[#5b6371] mt-0.5">
              {fmtDateVI(weekStart)} – {fmtDateVI(weekEnd)} · {submitted}/{items.length} nhân viên đã lập
            </div>
          </div>
          <div className="text-right text-[11px] text-[#5b6371]">In ngày {fmtDateVI(weekStartOf())}</div>
        </div>
      </div>

      {/* ===== Tổng kết 1 dòng (chỉ khi có data — không phải stat card) ===== */}
      {!loading && items.length > 0 && (
        <div className="flex items-center gap-4 mb-2 text-[12px] text-[#5b6371]">
          <span>{submitted}/{items.length} đã lập</span>
          {pending > 0 && <span className="text-[#a16207]">{pending} chưa lập</span>}
          {totalBlocked > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[#b91c1c]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626]" />
              {totalBlocked} vướng mắc
            </span>
          )}
          <span className="text-[#0f7a3a]">{ackedCount}/{submitted} đã xác nhận</span>
        </div>
      )}

      {/* ===== Bảng ===== */}
      <div className="border border-[#e4e8f0] rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse table-fixed text-[13px]">
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
              <tr className="bg-[#f8f9fc] text-left">
                <th className="text-center font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-r border-[#e4e8f0]">#</th>
                <th className="font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-r border-[#e4e8f0]">Nhân viên</th>
                <th className="font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-r border-[#e4e8f0]">Phòng ban</th>
                <th className="text-center font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-r border-[#e4e8f0]">Số đầu việc</th>
                <th className="text-center font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-r border-[#e4e8f0]">Vướng mắc</th>
                <th className="font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-r border-[#e4e8f0]">Báo cáo</th>
                <th className="font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-[#e4e8f0]">QL đã xem</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center text-[12px] text-[#9aa0b4] py-8">Đang tải…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-[12px] text-[#9aa0b4] py-8">Phòng ban chưa có nhân viên</td></tr>
              ) : (
                items.map((m, idx) => (
                  <tr
                    key={m.user_id}
                    className="hover:bg-[#fafbfd] border-b border-[#eef0f6] last:border-b-0"
                    onClick={() => setOpenUser(m)}
                    style={{ cursor: 'pointer', opacity: m.submitted ? 1 : 0.65 }}
                  >
                    <td className="text-center text-[12px] text-[#97a0b0] py-2 px-3 bg-[#fafbfd] tabular-nums border-r border-[#eef0f6]">{idx + 1}</td>
                    <td className="px-3 py-2 border-r border-[#eef0f6]">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-[#dce9ff] text-[#004ac6] flex items-center justify-center text-[11px] font-bold shrink-0">
                          {initialOf(m.fullname)}
                        </div>
                        <span className={m.submitted ? 'font-medium' : 'text-[#5b6371]'}>{m.fullname}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[#5b6371] text-[12px] border-r border-[#eef0f6]">{m.departments.join(', ') || '—'}</td>
                    <td className="text-center py-2 px-3 tabular-nums border-r border-[#eef0f6]">
                      {m.submitted ? m.row_count : <span className="text-[#b0b6c3]">—</span>}
                    </td>
                    <td className="text-center py-2 px-3 tabular-nums border-r border-[#eef0f6]">
                      {m.submitted ? (
                        m.blocked_count > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-[#b91c1c]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626]" />
                            {m.blocked_count}
                          </span>
                        ) : <span className="text-[#b0b6c3]">0</span>
                      ) : <span className="text-[#b0b6c3]">—</span>}
                    </td>
                    <td className="px-3 py-2 border-r border-[#eef0f6]">
                      {m.submitted ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#0f7a3a]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                          Đã lập
                        </span>
                      ) : (
                        <span className="text-[12px] text-[#97a0b0]">Chưa lập</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m.ack_at ? (
                        <span className="text-[12px] text-[#0f7a3a]">{fmtAck(m.ack_at)}</span>
                      ) : m.submitted ? (
                        <span className="text-[12px] text-[#a16207]">Chưa xem</span>
                      ) : (
                        <span className="text-[12px] text-[#c3c6d7]">—</span>
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