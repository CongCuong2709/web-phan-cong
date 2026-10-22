import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import { api } from '../lib/apiClient';

// =============================================================================
// WeeklyReportView — bảng nhập liệu báo cáo tuần (lưu thủ công, inline-edit).
// Ponytail: state tối thiểu, 1 ref cho debounce, không có lib ngoài.
// =============================================================================

type Row = {
  id: string;
  name: string;
  result: string;
  status: 'Hoàn thành' | 'Đang làm' | 'Chưa bắt đầu' | 'Vướng mắc';
  blocker: string;
};

const STATUS_DOT: Record<Row['status'], string> = {
  'Hoàn thành': 'dot-green',
  'Đang làm': 'dot-amber',
  'Chưa bắt đầu': 'dot-gray',
  'Vướng mắc': 'dot-red',
};
const STATUS_TEXT_COLOR: Record<Row['status'], string> = {
  'Hoàn thành': '#0f7a3a',
  'Đang làm': '#a16207',
  'Chưa bắt đầu': '#5b6371',
  'Vướng mắc': '#b91c1c',
};
const NEW_ROW: () => Row = () => ({
  id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: '', result: '', status: 'Chưa bắt đầu', blocker: '',
});

/** Trả về thứ 2 của tuần chứa `d` (YYYY-MM-DD local). */
function weekStartOf(d = new Date()): string {
  const dt = new Date(d);
  const dow = (dt.getDay() + 6) % 7; // ISO Mon=0..Sun=6
  dt.setDate(dt.getDate() - dow);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** ISO week number (1..53). */
function isoWeek(d = new Date()): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - day + 3); // Thursday of current week
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = (t.getTime() - firstThu.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

function fmtDateVI(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtTime(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Props {
  currentUser: User;
}

export const WeeklyReportView: React.FC<Props> = ({ currentUser }) => {
  const [weekStart, setWeekStart] = useState<string>(() => weekStartOf());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // dirty = có thay đổi chưa lưu. Mọi mutation flip true, save-success flip false.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Load report theo tuần ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getWeeklyReport(weekStart).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        const remote = r.data?.item?.rows as Row[] | undefined;
        setRows(remote && remote.length ? remote : [NEW_ROW()]);
        setSavedAt(r.data?.item?.updated_at ?? null);
      } else {
        setRows([NEW_ROW()]);
        setSavedAt(null);
      }
      setDirty(false); // load xong = sạch
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [weekStart]);

  // ── Save thủ công ──
  const save = useCallback(async () => {
    if (saving || !dirty) return;
    setSaving(true);
    const r = await api.putWeeklyReport({ week_start: weekStart, rows });
    setSaving(false);
    if (r.ok) {
      setSavedAt(fmtTime());
      setDirty(false);
    }
  }, [weekStart, rows, dirty, saving]);

  // ── Mutations — chỉ setRows + đánh dấu dirty, KHÔNG gọi API ──
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
      return next.length ? next : [NEW_ROW()]; // luôn giữ ≥1 dòng
    });
    setDirty(true);
  };

  // ── Derived ──
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [weekStart]);

  const isCurrentWeek = weekStart === weekStartOf();
  const canGoNext = weekEnd < weekStartOf();
  const canGoPrev = true;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-6">
      {/* ===== Toolbar ===== */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[18px] font-semibold tracking-tight whitespace-nowrap">
            Báo cáo tuần {isoWeek(new Date(weekStart))}
            <span className="text-[#5b6371] font-normal"> ({fmtDateVI(weekStart)} – {fmtDateVI(weekEnd)})</span>
          </h1>
          <div className="flex items-center">
            <button
              className="w-7 h-7 rounded-md hover:bg-[#eef2f8] disabled:opacity-30 flex items-center justify-center"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              disabled={!canGoPrev}
              title="Tuần trước"
            >
              <span className="material-symbols-outlined text-[18px] text-[#5b6371]">chevron_left</span>
            </button>
            <button
              className="w-7 h-7 rounded-md hover:bg-[#eef2f8] disabled:opacity-30 flex items-center justify-center"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              disabled={!canGoNext}
              title="Tuần sau"
            >
              <span className="material-symbols-outlined text-[18px] text-[#5b6371]">chevron_right</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty ? (
            <span className="text-[12px] text-[#a16207] font-medium">● Có thay đổi chưa lưu</span>
          ) : savedAt ? (
            <span className="text-[12px] text-[#5b6371]">Đã lưu · {savedAt}</span>
          ) : null}
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-[#4b5462] hover:bg-[#eef2f8]"
            onClick={() => setWeekStart(weekStartOf())}
          >
            <span className="material-symbols-outlined text-[16px]">today</span>
            Tuần này
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold bg-[#1a73e8] text-white shadow-sm hover:bg-[#1657b3] disabled:bg-[#c3d6ff] disabled:cursor-not-allowed"
            disabled={!dirty || saving}
            onClick={save}
          >
            <span className="material-symbols-outlined text-[16px]">{saving ? 'progress_activity' : 'save'}</span>
            {saving ? 'Đang lưu…' : 'Lưu báo cáo'}
          </button>
        </div>
      </div>

      {/* ===== Banner nếu nhân viên đang đăng nhập xem tab Báo cáo (legacy tab) ===== */}
      {currentUser.role === 'employee' && (
        <div className="hidden" />
      )}

      {/* ===== Sheet ===== */}
      <div className="border border-[#e4e8f0] rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse table-fixed text-[13px]">
            <colgroup>
              <col style={{ width: 44 }} />
              <col />
              <col />
              <col style={{ width: 170 }} />
              <col />
              <col style={{ width: 32 }} />
            </colgroup>
            <thead>
              <tr className="bg-[#f8f9fc] text-left">
                <th className="text-center font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-[#e4e8f0]">#</th>
                <th className="font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-[#e4e8f0]">Tên công việc</th>
                <th className="font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-[#e4e8f0]">Kết quả trong tuần</th>
                <th className="font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-[#e4e8f0]">Trạng thái</th>
                <th className="font-semibold text-[12px] text-[#5b6371] py-2 px-3 border-b border-[#e4e8f0]">Vướng mắc / Đề xuất</th>
                <th className="border-b border-[#e4e8f0]" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center text-[12px] text-[#9aa0b4] py-8">Đang tải…</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.id} className="group hover:bg-[#fafbfd] border-b border-[#eef0f6]">
                    <td className="text-center text-[12px] text-[#97a0b0] py-2 px-3 bg-[#fafbfd] select-none tabular-nums">{idx + 1}</td>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => updateRow(idx, { name: (e.currentTarget.textContent ?? '').trim() })}
                      data-ph="Nhập tên công việc…"
                      className="px-3 py-2 border-r border-[#eef0f6] align-middle empty:before:content-[attr(data-ph)] empty:before:text-[#b0b6c3] empty:before:italic focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1a73e8] focus:ring-inset hover:bg-[#f6f8fc] hover:outline hover:outline-1 hover:outline-[#c7d2e3]"
                    >{r.name}</td>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => updateRow(idx, { result: (e.currentTarget.textContent ?? '').trim() })}
                      data-ph="Sản phẩm/kết quả…"
                      className="px-3 py-2 border-r border-[#eef0f6] align-middle empty:before:content-[attr(data-ph)] empty:before:text-[#b0b6c3] empty:before:italic focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1a73e8] focus:ring-inset hover:bg-[#f6f8fc] hover:outline hover:outline-1 hover:outline-[#c7d2e3]"
                    >{r.result}</td>
                    <td className="px-3 py-2 border-r border-[#eef0f6] relative align-middle">
                      <span className={`dot ${STATUS_DOT[r.status]}`} />
                      <select
                        value={r.status}
                        onChange={(e) => updateRow(idx, { status: e.target.value as Row['status'] })}
                        className="appearance-none bg-transparent border border-transparent hover:border-[#dfe3ec] focus:border-[#1a73e8] focus:bg-white rounded px-2 py-1 pl-5 font-medium text-[13px] cursor-pointer w-full focus:outline-none"
                        style={{ color: STATUS_TEXT_COLOR[r.status] }}
                      >
                        <option>Hoàn thành</option>
                        <option>Đang làm</option>
                        <option>Chưa bắt đầu</option>
                        <option>Vướng mắc</option>
                      </select>
                    </td>
                    <td
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => updateRow(idx, { blocker: (e.currentTarget.textContent ?? '').trim() })}
                      data-ph="Cần hỗ trợ từ…"
                      className="px-3 py-2 border-r border-[#eef0f6] align-middle empty:before:content-[attr(data-ph)] empty:before:text-[#b0b6c3] empty:before:italic focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1a73e8] focus:ring-inset hover:bg-[#f6f8fc] hover:outline hover:outline-1 hover:outline-[#c7d2e3]"
                    >{r.blocker}</td>
                    <td className="text-center align-middle px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => removeRow(idx)}
                        title="Xoá dòng"
                        className="w-6 h-6 inline-flex items-center justify-center rounded text-[#97a0b0] hover:bg-[#fde8e8] hover:text-[#c43a3a]"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
              {!loading && (
                <tr className="text-[#b0b6c3] hover:bg-[#f6f8fc] hover:text-[#1a73e8] cursor-pointer" onClick={addRow}>
                  <td className="text-center text-[13px] py-2.5 bg-[#fafbfd]">+</td>
                  <td colSpan={5} className="py-2.5 px-3 text-[13px] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Thêm dòng mới
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-[#9aa0b4] text-right">
        {isCurrentWeek ? 'Tuần hiện tại — đang mở chỉnh sửa.' : 'Tuần đã đóng (chỉ đọc).'}
      </div>
    </div>
  );
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
