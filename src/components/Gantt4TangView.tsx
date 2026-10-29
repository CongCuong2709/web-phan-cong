import React, { useState, useMemo, useEffect } from 'react';
import { Avatar } from './ui/Brand';
import { isTierItemOverdue, PRIORITY_VI } from '../lib/transforms';
import { TierItem, User } from '../types';
import { creatableTiers, isHead } from '../auth/permissions';

interface Gantt4TangViewProps {
  tierItems: TierItem[];
  currentUser?: User;
  onSelectItem: (item: TierItem) => void;
  onOpenNewModal: () => void;
  /** Tháng đang xem 'YYYY-MM' — lưu trên URL (?thang=2026-11); null = tháng hiện tại. */
  month: string | null;
  onMonthChange: (month: string | null) => void;
  /** Đang hiện cả mục lưu trữ (mục có `archived`) trong cây. */
  showArchived?: boolean;
  /** Bật/tắt xem mục lưu trữ — chỉ truyền khi người dùng được lưu trữ (admin / HĐQT / Điều hành). */
  onToggleArchived?: () => void;
}

/** Format "Tháng N/YYYY". */
function fmtMonthYear(d: Date): string {
  return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
}

interface Timeline {
  columns: string[];
  columnsCount: number;
  /** Vị trí "hôm nay" (%) trong tháng; null khi hôm nay không thuộc tháng đang xem. */
  todayLeftPct: number | null;
  rangeStart: Date;
  label: string;
  unitDays: number;
  /** Thứ trong tuần 0=CN..6=T7 cho mỗi cột (dùng để tô màu cuối tuần). */
  weekdayMask: number[];
}

/** 'YYYY-MM' → ngày 1 của tháng đó; giá trị sai → tháng hiện tại. */
function monthStart(month: string | null, today: Date): Date {
  const m = month ? /^(\d{4})-(\d{2})$/.exec(month) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(today.getFullYear(), today.getMonth(), 1);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Timeline theo ngày cho 1 tháng: 28–31 cột, 1 cột/ngày. */
function buildTimeline(start: Date, today: Date): Timeline {
  const totalDays = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const columns: string[] = [];
  const weekdayMask: number[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), i + 1);
    columns.push(String(d.getDate()).padStart(2, '0'));
    weekdayMask.push(d.getDay());
  }
  const inMonth = today.getFullYear() === start.getFullYear() && today.getMonth() === start.getMonth();
  return {
    columns,
    columnsCount: totalDays,
    todayLeftPct: inMonth ? ((today.getDate() - 1 + 0.5) / totalDays) * 100 : null,
    rangeStart: start,
    label: fmtMonthYear(start),
    unitDays: totalDays,
    weekdayMask,
  };
}

/** Màu thanh Gantt theo tầng/trạng thái — token trong index.css (--color-gantt-*). */
const GANTT_COLOR = {
  t1: 'var(--color-gantt-t1)',
  t2: 'var(--color-gantt-t2)',
  t3: 'var(--color-gantt-t3)',
  t4: 'var(--color-gantt-t4)',
  blocked: 'var(--color-error)',
  critical: 'var(--color-warning-fixed)',
  readonly: 'var(--color-gantt-readonly)',
} as const;

const GANTT_LEGEND: { key: keyof typeof GANTT_COLOR; label: string; dot?: boolean }[] = [
  { key: 't1', label: 'T1: Dự án' },
  { key: 't2', label: 'T2: Giai đoạn' },
  { key: 't3', label: 'T3: Hạng mục' },
  { key: 't4', label: 'T4: Đầu việc' },
  { key: 'blocked', label: 'Đang vướng' },
  { key: 'critical', label: 'Ưu tiên cao', dot: true },
  { key: 'readonly', label: 'Chỉ đọc (ngữ cảnh)' },
];

export const Gantt4TangView: React.FC<Gantt4TangViewProps> = ({
  tierItems: allItems,
  currentUser,
  onSelectItem,
  onOpenNewModal,
  month,
  onMonthChange,
  showArchived = false,
  onToggleArchived,
}) => {
  // KPI / đếm chỉ tính mục đang hoạt động; cây hiển thị thêm mục lưu trữ khi được bật.
  const tierItems = useMemo(() => allItems.filter((i) => !i.archived), [allItems]);
  const [searchTerm, setSearchTerm] = useState('');
  // searchTermRaw lưu giá trị input ngay, debounce 300ms xuống searchTerm
  const [searchTermRaw, setSearchTermRaw] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setSearchTerm(searchTermRaw), 300);
    return () => clearTimeout(handle);
  }, [searchTermRaw]);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  const now = new Date();
  const viewStart = monthStart(month, now);
  const timeline = useMemo(() => buildTimeline(viewStart, new Date()), [viewStart.getTime()]);
  const isCurrentMonth = monthKey(viewStart) === monthKey(now);
  const shiftMonth = (delta: number) => {
    const next = new Date(viewStart.getFullYear(), viewStart.getMonth() + delta, 1);
    onMonthChange(monthKey(next) === monthKey(now) ? null : monthKey(next));
  };
  // Cột "hôm nay" — -1 khi hôm nay không thuộc tháng đang xem.
  const todayCol = timeline.todayLeftPct === null ? -1 : now.getDate() - 1;

  // Dynamic filter + DFS tree order (filter mà vẫn giữ thứ tự cây).
  // push của mảng gốc → T1, hết T2, hết T3, hết T4. Giờ sort theo cây: T1 → T2 con →
  // T3 con → T4 con).
  const filteredItems = useMemo(() => {
    // Mục khớp từ khoá + toàn bộ chuỗi cha của nó (cây chỉ duyệt từ gốc xuống,
    // nên thiếu cha thì mục con khớp sẽ không hiện).
    const q = searchTerm.trim().toLowerCase();
    let shown: Set<string> | null = null;
    if (q) {
      const byId = new Map(allItems.map((t) => [t.id, t]));
      shown = new Set();
      for (const item of allItems) {
        const match =
          item.title.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q) ||
          item.owner.name.toLowerCase().includes(q);
        let cur: TierItem | undefined = match ? item : undefined;
        while (cur && !shown.has(cur.id)) {
          shown.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
    const filtered = allItems.filter((item) => {
      if (shown && !shown.has(item.id)) return false;
      if (allCollapsed && (item.tier === 3 || item.tier === 4)) return false;
      if (item.parentId && collapsedMap[item.parentId]) return false;
      return true;
    });
    // Index filtered items by parent → DFS visit roots → render cây đúng quan hệ cha-con.
    const childrenOf = new Map<string | undefined, TierItem[]>();
    for (const item of filtered) {
      const key = item.parentId ?? undefined;
      const arr = childrenOf.get(key);
      if (arr) arr.push(item);
      else childrenOf.set(key, [item]);
    }
    for (const arr of childrenOf.values()) {
      arr.sort((a, b) => a.code.localeCompare(b.code));
    }
    const ordered: TierItem[] = [];
    const visit = (parentId: string | undefined) => {
      for (const child of childrenOf.get(parentId) ?? []) {
        ordered.push(child);
        visit(child.id);
      }
    };
    visit(undefined);
    return ordered;
  }, [allItems, searchTerm, allCollapsed, collapsedMap]);

  const toggleCollapseAll = () => {
    setAllCollapsed(!allCollapsed);
  };

  const toggleRowCollapse = (e: React.MouseEvent, id: string) => {
    // chặn cả bubble (click) và capture (mousedown) để chắc chắn
    // row's onClick (mở chi tiết công việc) không trigger khi click toggle.
    e.stopPropagation();
    e.preventDefault();
    setCollapsedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Counts
  const t1Count = tierItems.filter((i) => i.tier === 1).length;
  const t1ActiveCount = tierItems.filter((i) => i.tier === 1 && i.status !== 'Đã xong').length;
  const t2Count = tierItems.filter((i) => i.tier === 2).length;
  const t3Count = tierItems.filter((i) => i.tier === 3).length;
  const t4Count = tierItems.filter((i) => i.tier === 4).length;

  // Read-only context: T1 project mà currentUser không thể edit.
  // - Admin, HĐQT, Điều hành, Trưởng phòng: không bao giờ read-only
  // - Nhân viên: TẤT CẢ T1 đều read-only (chỉ xem để biết project context)
  const isReadOnlyContext = (item: TierItem): boolean =>
    item.tier === 1 && currentUser?.role === 'employee' && !isHead(currentUser);
  // True nếu có ít nhất 1 T1 read-only trong data → hiện chú thích ở legend
  const hasReadOnlyContext = tierItems.some(isReadOnlyContext);

  // --- Dynamic KPI calculations ---
  // Tổng tiến độ = trung bình các mục gốc (dự án + việc độc lập). Mục cha đã là
  // trung bình của mục con, nên cộng cả 4 tầng sẽ tính trùng.
  const rootItems = tierItems.filter((i) => !i.parentId);
  const avgAll =
    rootItems.length === 0
      ? 0
      : Math.round(rootItems.reduce((s, i) => s + i.progress, 0) / rootItems.length);

  // Vướng mắc = trạng thái nghẽn, hoặc NV đã báo vướng (blocker_note), hoặc cảnh báo giai đoạn.
  const blockedItems = tierItems.filter(
    (i) => i.status !== 'Đã xong' && (i.status === 'Đang vướng' || !!i.blockerNote?.trim() || !!i.blockerAlert)
  );

  const t3Items = tierItems.filter((i) => i.tier === 3);
  const t3OnTime = t3Items.filter((i) => !isTierItemOverdue(i)).length;
  const t3OnTimePct =
    t3Items.length === 0 ? 0 : Math.round((t3OnTime / t3Items.length) * 100);

  // Segmented bar helpers
  const filledSegs = (pct: number) => Math.round(pct / 10);

  return (
    <div className="flex flex-col w-full">
      {/* Top Minimalist Sub-Header */}
      <div className="w-full px-4 sm:px-6 py-5 bg-white border-b border-surface-container shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="max-w-[1720px] mx-auto flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">
              Cây công việc
            </h1>
            <p className="text-sm text-on-surface-variant flex items-center gap-2 flex-wrap">
              <span>Dự án</span>
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px] text-outline">arrow_forward</span>
              <span>Giai đoạn</span>
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px] text-outline">arrow_forward</span>
              <span>Hạng mục</span>
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:13px] text-outline">arrow_forward</span>
              <span>Đầu việc</span>
            </p>
          </div>

          {/* Action & View Controls */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            {/* Chuyển tháng */}
            <div role="group" aria-label="Tháng hiển thị" className="flex items-center gap-1 bg-surface-container-low p-1 rounded-md">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Tháng trước"
                className="w-7 h-7 rounded flex items-center justify-center text-secondary hover:bg-white hover:text-on-surface"
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">chevron_left</span>
              </button>
              <span className="px-2 text-xs font-semibold text-on-surface tabular-nums min-w-[96px] text-center" aria-live="polite">
                {timeline.label}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Tháng sau"
                className="w-7 h-7 rounded flex items-center justify-center text-secondary hover:bg-white hover:text-on-surface"
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:18px]">chevron_right</span>
              </button>
              {!isCurrentMonth && (
                <button
                  type="button"
                  onClick={() => onMonthChange(null)}
                  className="px-2 h-7 rounded text-xs font-semibold text-primary hover:bg-white"
                >
                  Tháng này
                </button>
              )}
            </div>

            {/* Tree Controls */}
            <button
              onClick={toggleCollapseAll}
              className="h-8 px-3 bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold rounded flex items-center gap-1.5 transition-colors"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">
                {allCollapsed ? 'unfold_more' : 'unfold_less'}
              </span>
              <span>{allCollapsed ? 'Mở rộng tất cả' : 'Thu gọn tất cả'}</span>
            </button>

            {onToggleArchived && (
              <button
                onClick={onToggleArchived}
                aria-pressed={showArchived}
                className={`h-8 px-3 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors ${
                  showArchived
                    ? 'bg-secondary-container text-on-surface'
                    : 'bg-surface-container-low hover:bg-surface-container text-on-surface'
                }`}
                type="button"
              >
                <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">inventory_2</span>
                <span>{showArchived ? 'Ẩn mục lưu trữ' : 'Mục lưu trữ'}</span>
              </button>
            )}

            {currentUser && creatableTiers(currentUser).length > 0 && (
            <button
              onClick={onOpenNewModal}
              className="h-8 px-3.5 bg-primary hover:bg-primary-container text-white text-xs font-semibold rounded flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:17px]">add</span>
              <span>Thêm mới</span>
            </button>
            )}
          </div>
        </div>
      </div>

      {/* Segmented KPI Strip — tính động từ tierItems */}
      <div className="w-full px-4 sm:px-6 py-4 bg-surface">
        <div className="max-w-[1720px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Tổng tiến độ */}
          <div className="bg-white p-4 rounded-lg border border-surface-container shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                Tổng tiến độ
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-display font-bold text-on-surface tabular-nums tracking-tight">
                {avgAll}%
              </span>
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    i < filledSegs(avgAll) ? 'bg-primary' : 'bg-surface-container'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* KPI 2: Dự án Tầng 1 */}
          <div className="bg-white p-4 rounded-lg border border-surface-container shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                Dự án
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-display font-bold text-on-surface tabular-nums tracking-tight">
                {t1ActiveCount}
              </span>
              <span className="text-xs text-secondary">
                dự án đang triển khai
              </span>
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    i < Math.min(t1ActiveCount, 10) ? 'bg-primary' : 'bg-surface-container'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* KPI 3: Hạng mục T3 */}
          <div className="bg-white p-4 rounded-lg border border-surface-container shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                Hạng mục giao &amp; Gói việc
              </span>
              <span className="text-xs font-semibold text-tertiary">
                {t3OnTimePct}% đúng hạn
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-display font-bold text-on-surface tabular-nums tracking-tight">
                {t3Count}
              </span>
              <span className="text-xs text-secondary">
                hạng mục (Tầng 3)
              </span>
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    i < filledSegs(t3OnTimePct) ? 'bg-tertiary-container' : 'bg-surface-container'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* KPI 4: Đang vướng */}
          <div className="bg-white p-4 rounded-lg border border-surface-container shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                Đang vướng
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span
                className={`text-display font-bold tabular-nums tracking-tight ${
                  blockedItems.length > 0 ? 'text-error' : 'text-tertiary'
                }`}
              >
                {blockedItems.length}
              </span>
              <span className="text-xs text-secondary">
                {blockedItems.length > 0 ? 'mục đang vướng mắc' : 'không có vướng mắc'}
              </span>
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    blockedItems.length > 0 && i < Math.min(blockedItems.length, 10)
                      ? 'bg-error'
                      : blockedItems.length === 0 && i < 10
                      ? 'bg-tertiary'
                      : 'bg-surface-container'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Unified Workspace: Tree Table + Gantt Timeline */}
      <div className="w-full px-4 sm:px-6 pb-10">
        <div className="max-w-[1720px] mx-auto bg-white rounded-lg border border-surface-container shadow-sm overflow-hidden flex flex-col">
          {/* Top Search & Timeline Legend Bar */}
          <div className="h-12 px-4 bg-white flex items-center justify-between gap-4 border-b border-surface-container-low">
            <div className="flex items-center gap-4">
              <div className="relative w-64 sm:w-72">
                <span aria-hidden="true" className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 [--icon-size:16px] text-outline">
                  search
                </span>
                <input
                  value={searchTermRaw}
                  onChange={(e) => setSearchTermRaw(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 text-sm bg-surface-container-low text-on-surface placeholder:text-outline rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Lọc dự án, gói việc, mã..."
                  type="text"
                />
              </div>
              <span className="text-xs text-secondary hidden md:inline-block">
                Hiển thị <strong className="text-on-surface">{t1Count} Dự án</strong> ·{' '}
                {t2Count} Giai đoạn · {t3Count} Hạng mục · {t4Count} Đầu việc
              </span>
            </div>

            {/* Chú thích — đọc cùng GANTT_COLOR với thanh vẽ nên không thể lệch nhau */}
            <ul aria-label="Chú thích màu" className="hidden xl:flex items-center gap-4 text-xs font-semibold text-secondary">
              {GANTT_LEGEND.filter((l) => l.key !== 'readonly' || hasReadOnlyContext).map((l) => (
                <li key={l.key} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={l.dot ? 'w-2 h-2 rounded-full' : 'w-3 h-2 rounded-sm'} style={{ backgroundColor: GANTT_COLOR[l.key] }} />
                  <span>{l.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Split Layout Container */}
          <div className="w-full overflow-x-auto" tabIndex={-1}>
            <div className="min-w-[1280px] flex flex-col">
              {/* Table Column Headers */}
              <div className="flex items-stretch bg-surface-container-low text-secondary text-xs font-bold uppercase tracking-wider h-10 select-none border-b border-surface-container-high">
                {/* Left 50% Tree Grid Header */}
                <div className="w-[50%] flex items-center px-4">
                  <span className="flex-1">Cấu trúc & Tên công việc</span>
                  <span className="w-28 text-left">Phụ trách</span>
                  <span className="w-24 text-center">Hạn chót</span>
                  <span className="w-28 text-center">Tiến độ</span>
                  <span className="w-24 text-center">Trạng thái</span>
                </div>

                {/* Right 50% Timeline Axis — day-based columns.
                    minmax(20px, 1fr) đảm bảo ngày luôn đủ rộng để đọc số,
                    tối đa 31 cột. */}
                <div
                  className="w-[50%] bg-surface-container text-center font-mono text-xs relative font-semibold text-on-surface-variant"
                  style={{ display: 'grid', gridTemplateColumns: `repeat(${timeline.columnsCount}, minmax(20px, 1fr))` }}
                >
                  {timeline.columns.map((label, idx) => {
                    const isTodayCol = idx === todayCol;
                    const weekday = timeline.weekdayMask[idx];
                    const isWeekend = weekday === 0 || weekday === 6; // CN hoặc T7
                    return (
                      <div
                        key={idx}
                        className={`py-1 flex flex-col items-center justify-center border-l border-surface-container-high ${
                          isTodayCol ? 'bg-primary text-white' : isWeekend ? 'bg-surface-container-high/50 text-outline' : ''
                        }`}
                      >
                        {(
                          <span className={`text-xs font-medium ${isTodayCol ? 'text-white/80' : 'text-outline'}`}>
                            T{weekday === 0 ? 7 : weekday}
                          </span>
                        )}
                        <span className="text-xs font-bold leading-none">{label}</span>
                        {isTodayCol && (
                          <span className="text-xs font-bold mt-0.5">HÔM NAY</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* DATA ROWS LIST */}
              <div className="flex flex-col relative divide-y divide-surface-container-low">
                {/* today marker nằm trong timeline column (50% phải), không phải full width.
                    Position = 50% (offset của timeline column) + todayLeftPct * 50% (tỷ lệ trong timeline). */}
                {timeline.todayLeftPct !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-[2px] bg-primary z-20 pointer-events-none"
                    style={{ left: `calc(50% + ${timeline.todayLeftPct / 2}%)` }}
                  >
                    <div className="sticky top-10 -ml-1.5 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center shadow-md">
                      <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                    </div>
                  </div>
                )}

                {filteredItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                    <span aria-hidden="true" className="material-symbols-outlined text-outline-variant [--icon-size:48px] mb-2">
                      {currentUser?.role === 'employee' ? 'task_alt' : 'inbox'}
                    </span>
                    <h3 className="text-base font-semibold text-on-surface mb-1">
                      {currentUser?.role === 'employee'
                        ? 'Bạn chưa có task nào được giao'
                        : 'Chưa có dữ liệu để hiển thị'}
                    </h3>
                    <p className="text-xs text-outline max-w-md">
                      {currentUser?.role === 'employee'
                        ? 'Liên hệ Trưởng phòng để được phân công đầu việc. Khi có task, bạn sẽ thấy task đó cùng với cây dự án (T1) → giai đoạn (T2) → hạng mục (T3) ở chế độ chỉ đọc.'
                        : 'Hãy thêm dự án, giai đoạn, hạng mục hoặc đầu việc mới để bắt đầu.'}
                    </p>
                  </div>
                )}

                {filteredItems.map((item, idx) => {
                  const isCollapsible = item.tier === 1 || item.tier === 2 || item.tier === 3;
                  const isCollapsed = collapsedMap[item.id];
                  const isHovered = hoveredItemId === item.id;
                  const readonlyCtx = isReadOnlyContext(item);

                  // Zebra striping: dòng chẵn tint nhẹ, dòng lẻ trắng → quét mắt dễ hơn
                  const zebraBase = idx % 2 === 0 ? 'bg-white' : 'bg-surface';

                  // Indentation calculation based on Tier
                  const indentClass =
                    item.tier === 1
                      ? 'pl-2'
                      : item.tier === 2
                      ? 'pl-6'
                      : item.tier === 3
                      ? 'pl-10'
                      : 'pl-16';

                  const rowBg = item.archived
                    ? 'bg-surface/70 opacity-60 hover:opacity-100 hover:bg-surface-container-low/80'
                    : readonlyCtx
                    ? 'bg-surface/70 hover:bg-surface-container-low/80'
                    : item.blockerAlert
                    ? 'bg-warning-container/40 hover:bg-warning-container/70'
                    : item.tier === 1
                    ? `${zebraBase} hover:bg-surface-container-low/80`
                    : `${zebraBase} hover:bg-surface-container-low/70`;

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      // Tooltip mở khi rê chuột HOẶC khi focus bằng bàn phím; Enter/Space mở chi tiết.
                      onMouseEnter={() => setHoveredItemId(item.id)}
                      onMouseLeave={() => setHoveredItemId(null)}
                      onFocus={() => setHoveredItemId(item.id)}
                      onBlur={() => setHoveredItemId(null)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectItem(item);
                        }
                      }}
                      tabIndex={0}
                      aria-label={`${item.code} ${item.title} — ${item.status}, ${item.progress}%. Nhấn Enter để xem chi tiết`}
                      className={`flex items-stretch transition-colors cursor-pointer group focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 ${rowBg}`}
                    >
                      {/* Left Cell (50%) */}
                      <div
                        className={`w-[50%] flex items-center px-4 py-2 ${indentClass} border-r border-surface-container-low`}
                      >
                        <div className="flex-1 flex items-center gap-1.5 min-w-0 pr-3">
                          {readonlyCtx ? (
                            <span
                              className="w-5 h-5 flex items-center justify-center text-outline shrink-0"
                              title="Dự án do phòng ban khác phụ trách — bạn chỉ có thể xem, không sửa"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:16px]">lock</span>
                            </span>
                          ) : isCollapsible ? (
                            <button
                              onClick={(e) => toggleRowCollapse(e, item.id)}
                              onMouseDown={(e) => e.stopPropagation()}
                              aria-expanded={!isCollapsed}
                              aria-label={`${isCollapsed ? 'Mở rộng' : 'Thu gọn'} ${item.title}`}
                              className="w-5 h-5 flex items-center justify-center text-secondary hover:bg-surface-container rounded"
                              type="button"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:17px]">
                                {isCollapsed ? 'chevron_right' : 'keyboard_arrow_down'}
                              </span>
                            </button>
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-outline shrink-0 mr-1.5"></span>
                          )}

                          {/* Tier Badge */}
                          {item.tier === 1 && (
                            <span
                              className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wider ${
                                readonlyCtx
                                  ? 'bg-outline-variant text-on-surface-variant'
                                  : 'bg-gantt-t1 text-white'
                              }`}
                            >
                              DỰ ÁN T1
                            </span>
                          )}
                          {readonlyCtx && (
                            <span
                              className="text-xs font-bold px-1.5 py-0.5 rounded bg-surface-container text-secondary shrink-0 uppercase tracking-wider flex items-center gap-0.5"
                              title={`Dự án thuộc phòng ban "${item.department}" — không thuộc phòng ban của bạn. Bạn có thể xem nhưng không thể sửa.`}
                            >
                              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:11px]">visibility</span>
                              <span>Chỉ đọc</span>
                            </span>
                          )}
                          {item.tier === 2 && (
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-primary-fixed text-on-primary-fixed shrink-0 uppercase tracking-wider">
                              GIAI ĐOẠN T2
                            </span>
                          )}
                          {item.tier === 3 && (
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-primary-fixed text-on-primary-fixed-variant shrink-0 uppercase tracking-wider">
                              HẠNG MỤC T3
                            </span>
                          )}
                          {item.tier === 4 && (
                            <span className="text-xs font-bold px-1 py-0.5 rounded bg-surface-container-low text-on-surface-variant shrink-0 uppercase tracking-wider">
                              VIỆC T4
                            </span>
                          )}

                          <span
                            className={`truncate ${
                              readonlyCtx
                                ? 'font-bold text-sm text-secondary'
                                : item.tier === 1
                                ? 'font-bold text-sm text-on-surface'
                                : item.tier === 2
                                ? 'font-semibold text-sm text-on-surface'
                                : item.tier === 3
                                ? 'font-medium text-sm text-on-surface'
                                : 'text-sm text-on-surface-variant group-hover:text-on-surface'
                            }`}
                          >
                            {item.title}
                          </span>

                          {item.archived && (
                            <span className="shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded bg-surface-container-high text-secondary">
                              Lưu trữ
                            </span>
                          )}

                          {item.blockerAlert && (
                            <span aria-hidden="true"
                              className="material-symbols-outlined [--icon-size:15px] text-error shrink-0"
                              title={item.blockerAlert}
                            >
                              warning
                            </span>
                          )}
                        </div>

                        {/* Owner */}
                        <div className="w-28 flex items-center gap-1.5 shrink-0">
                          <Avatar name={item.owner.name} src={item.owner.avatar} className="w-5 h-5 text-xs shrink-0" />
                          <span className="text-sm text-on-surface truncate">
                            {item.owner.name}
                          </span>
                        </div>

                        {/* Deadline */}
                        <div
                          className={`w-24 text-center font-mono text-xs shrink-0 ${
                            item.blockerAlert ? 'text-error font-semibold' : 'text-on-surface-variant'
                          }`}
                        >
                          {item.endDate}
                        </div>

                        {/* Progress */}
                        <div className="w-28 px-1.5 shrink-0">
                          <div className="flex items-center justify-between text-xs mb-0.5">
                            <span className="font-mono text-secondary">
                              {item.tier === 1
                                ? 'Tổng'
                                : item.tier === 2
                                ? `GD ${item.code.replace('GD-', '')}`
                                : item.code}
                            </span>
                            <span
                              className={`font-bold font-mono ${
                                item.progress === 100
                                  ? 'text-tertiary'
                                  : item.blockerAlert
                                  ? 'text-warning'
                                  : 'text-primary'
                              }`}
                            >
                              {item.progress}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-surface-container-low rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                item.progress === 100
                                  ? 'bg-tertiary'
                                  : item.blockerAlert
                                  ? 'bg-warning-fixed'
                                  : 'bg-primary'
                              }`}
                              style={{ width: `${item.progress}%` }}
                            ></div>
                          </div>
                        </div>

                        {/* Status */}
                        <div className="w-24 text-center shrink-0">
                          {item.progress === 100 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-tertiary">
                              <span aria-hidden="true" className="material-symbols-outlined [--icon-size:15px]">
                                check_circle
                              </span>
                              <span>Đã xong</span>
                            </span>
                          ) : item.status === 'Đang vướng' ? (
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-error-container text-on-error-container">
                              Đang vướng
                            </span>
                          ) : (
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-surface-container-low text-primary">
                              {item.status}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Cell: Gantt Bar Timeline (50%) */}
                      <div className="w-[50%] relative flex items-center px-1.5 bg-surface-container-low/15">
                        {/* Timeline Grid vertical guides — day-based columns */}
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${timeline.columnsCount}, minmax(20px, 1fr))`,
                          }}
                        >
                          {Array.from({ length: timeline.columnsCount }, (_, i) => {
                            const weekday = timeline.weekdayMask[i];
                            const isWeekend = weekday === 0 || weekday === 6;
                            return (
                              <div
                                key={i}
                                className={`border-r border-dashed border-surface-container-high ${
                                  i === todayCol ? 'bg-primary/[0.015]' :
                                  isWeekend ? 'bg-surface-container-high/40' : ''
                                }`}
                              />
                            );
                          })}
                        </div>

                        {/* Thanh Gantt: vị trí/độ dài tính từ startDate/endDate theo ngày */}
                        {(() => {
                          // Tính bar position/width từ startDate/endDate trực tiếp (đơn vị ngày).
                          // Không dùng week index nữa.
                          const parseDate = (s: string): number | null => {
                            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
                              ?? /^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/.exec(s);
                            if (!m) return null;
                            let yyyy: number, mm: number, dd: number;
                            if (m[1].length === 4) {
                              yyyy = Number(m[1]); mm = Number(m[2]) - 1; dd = Number(m[3]);
                            } else {
                              dd = Number(m[1]); mm = Number(m[2]) - 1;
                              yyyy = m[3] ? Number(m[3]) : new Date().getFullYear();
                            }
                            return Math.floor((new Date(yyyy, mm, dd).getTime() - timeline.rangeStart.getTime()) / 86400000);
                          };
                          const startDay = parseDate(item.startDate) ?? 0;
                          const endDay = parseDate(item.endDate) ?? startDay;
                          if (endDay < 0 || startDay >= timeline.unitDays) {
                            const before = endDay < 0;
                            return (
                              <span
                                className={`absolute ${before ? 'left-1' : 'right-1'} text-xs text-outline whitespace-nowrap`}
                                title={`${item.startDate} → ${item.endDate}`}
                              >
                                {before ? `← kết thúc ${item.endDate.split('-').reverse().slice(0, 2).join('/')}` : `bắt đầu ${item.startDate.split('-').reverse().slice(0, 2).join('/')} →`}
                              </span>
                            );
                          }
                          const startPct = Math.max(0, Math.min(100, (startDay / timeline.unitDays) * 100));
                          const endPct = Math.max(0, Math.min(100, ((endDay + 1) / timeline.unitDays) * 100));
                          // Nếu endDate trước startDate (data lỗi), fallback về 1 ngày duration
                          const leftPct = startPct;
                          const widthPct = endPct > startPct
                            ? endPct - startPct
                            : Math.max(0.5, (1 / timeline.unitDays) * 100);
                          const isBlocked = item.status === 'Đang vướng';
                          // isBlocked ưu tiên tier color — T1/T2/T3 nghẽn cũng đỏ.
                          const barColor = GANTT_COLOR[readonlyCtx ? 'readonly' : isBlocked ? 'blocked' : (`t${item.tier}` as const)];
                          const height = item.tier === 1 ? 'h-5' : item.tier === 2 ? 'h-4' : item.tier === 3 ? 'h-3.5' : 'h-3';
                          // width < 2% (≈ < 1 ngày) → milestone (◆ diamond) thay vì clamp bar
                          // quá rộng khiến task ngắn bị "phóng to" trực quan.
                          const isMilestone = widthPct < 2 && item.tier >= 2;
                          return (
                            <>
                              {isMilestone ? (
                                // Milestone: diamond shape, anchored at leftPct
                                <div
                                  className={`absolute ${height} w-3.5 -translate-x-1/2 rotate-45 transition-all duration-150 cursor-pointer ${
                                    isHovered
                                      ? 'shadow-xl ring-2 ring-primary/50 z-10 brightness-110 scale-110'
                                      : 'shadow-sm'
                                  } ${isBlocked ? 'ring-2 ring-error/60' : ''}`}
                                  style={{
                                    left: `${leftPct}%`,
                                    backgroundColor: barColor,
                                  }}
                                  title={`${item.title} — ${item.endDate}`}
                                />
                              ) : (
                                <div
                                  className={`absolute ${height} rounded flex items-center overflow-hidden transition-all duration-150 ${
                                    isHovered
                                      ? 'shadow-xl ring-2 ring-primary/50 z-10 brightness-110'
                                      : 'shadow-sm'
                                  } ${isBlocked ? 'ring-2 ring-error/60 ring-offset-1' : ''}`}
                                  style={{
                                    left: `${leftPct}%`,
                                    width: `${Math.max(widthPct, 3)}%`,
                                    backgroundColor: barColor,
                                  }}
                                >
                                  {item.tier <= 3 && !isMilestone && (
                                    <span className="font-mono text-xs px-1.5 text-white truncate">
                                      {item.progress}%
                                    </span>
                                  )}
                                  {item.tier === 1 && (
                                    <span className="font-mono text-xs font-bold text-white shrink-0 ml-auto mr-1.5">
                                      {item.progress}%
                                    </span>
                                  )}
                                  {/* Blocked: thay animate-ping bằng icon warning tĩnh — pro hơn, không gây mỏi mắt */}
                                  {isBlocked && (
                                    <span aria-hidden="true"
                                      className="material-symbols-outlined text-white [--icon-size:12px] ml-auto mr-1 shrink-0"
                                      style={{ fontVariationSettings: "'wght' 700, 'FILL' 1" }}
                                    >
                                      priority_high
                                    </span>
                                  )}
                                  {/* Đánh dấu việc ưu tiên Cao / Khẩn cấp */}
                                  {(item.priority === 'critical' || item.priority === 'high') && !isBlocked && (
                                    <span
                                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full ring-1 ring-white"
                                      style={{ backgroundColor: GANTT_COLOR.critical }}
                                      title={`Ưu tiên ${PRIORITY_VI[item.priority].toLowerCase()}`}
                                    />
                                  )}
                                </div>
                              )}

                              {/* Custom Tooltip — hiện khi hover bar */}
                              {isHovered && (
                                <div
                                  className="absolute z-30 pointer-events-none"
                                  style={{
                                    // milestone anchor tại leftPct (center diamond),
                                    // bar center vẫn dùng leftPct + widthPct/2.
                                    left: `${Math.min(95, Math.max(5, isMilestone ? leftPct : leftPct + widthPct / 2))}%`,
                                    bottom: 'calc(100% + 10px)',
                                    transform: 'translateX(-50%)',
                                  }}
                                >
                                  <div className="bg-inverse-surface text-white text-xs rounded-lg shadow-2xl px-3 py-2 min-w-[200px] max-w-[260px]">
                                    <div className="font-bold text-xs mb-1.5 text-white leading-tight">
                                      {item.title}
                                    </div>
                                    <div className="flex justify-between gap-3 mb-0.5">
                                      <span className="text-outline">Mã:</span>
                                      <span className="font-mono font-semibold">{item.code}</span>
                                    </div>
                                    <div className="flex justify-between gap-3 mb-0.5">
                                      <span className="text-outline">Phụ trách:</span>
                                      <span className="font-medium truncate max-w-[120px]">{item.owner.name}</span>
                                    </div>
                                    <div className="flex justify-between gap-3 mb-0.5">
                                      <span className="text-outline">Hạn:</span>
                                      <span className="font-mono">{item.endDate}</span>
                                    </div>
                                    <div className="flex justify-between gap-3 mb-0.5">
                                      <span className="text-outline">Trạng thái:</span>
                                      <span className="font-medium">{item.status}</span>
                                    </div>
                                    <div className="flex justify-between gap-3 pt-1 border-t border-on-surface-variant">
                                      <span className="text-outline">Tiến độ:</span>
                                      <span
                                        className="font-bold font-mono"
                                        style={{ color: item.progress === 100 ? 'var(--color-tertiary-fixed)' : 'var(--color-primary-fixed-dim)' }}
                                      >
                                        {item.progress}%
                                      </span>
                                    </div>
                                    {item.blockerAlert && (
                                      <div className="mt-1.5 pt-1.5 border-t border-on-surface-variant text-warning-fixed text-xs leading-snug">
                                        <span className="font-semibold">⚠ Vướng mắc: </span>
                                        {item.blockerAlert}
                                      </div>
                                    )}
                                  </div>
                                  {/* Arrow pointing to bar */}
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                                    <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-slate-900" />
                                  </div>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
