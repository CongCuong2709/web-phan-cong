import React, { useState, useMemo, useEffect } from 'react';
import { TierItem, User } from '../types';

interface Gantt4TangViewProps {
  tierItems: TierItem[];
  currentUser?: User;
  onSelectItem: (item: TierItem) => void;
  onOpenNewModal: () => void;
}

/** Format dd/MM (Fix UI-05 helper). */
function fmtDdMm(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Format "Tháng N/YYYY". */
function fmtMonthYear(d: Date): string {
  return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
}

interface Timeline {
  columns: string[];
  columnsCount: number;
  todayLeftPct: number;
  rangeStart: Date;
  rangeEnd: Date;
  label: string;
  unitDays: number;
  /** Thứ trong tuần 0=CN..6=T7 cho mỗi cột (dùng để tô màu cuối tuần). */
  weekdayMask: number[];
  /** True nếu ngày đó là ngày đầu tháng (dùng để highlight ranh giới tháng). */
  monthBoundaryMask: boolean[];
}

/** Tính timeline theo đơn vị NGÀY (không phải tuần).
 *  - 'month'  → 30-31 cột, 1 cột/ngày trong tháng hiện tại
 *  - 'quarter'→ 91 cột, 1 cột/ngày trong 13 tuần (~3 tháng) từ hôm nay
 *  - 'year'   → 365 cột, 1 cột/ngày trong năm hiện tại
 */
function buildTimeline(timeFilter: 'month' | 'quarter' | 'year', today: Date): Timeline {
  if (timeFilter === 'month') {
    // Range: từ ngày 1 tháng hiện tại → ngày cuối tháng hiện tại (inclusive).
    const rangeStart = new Date(today.getFullYear(), today.getMonth(), 1);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    rangeEnd.setHours(0, 0, 0, 0);
    const totalDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1;
    const columns: string[] = [];
    const weekdayMask: number[] = []; // 0=CN, 1=T2..6=T7
    const monthBoundaryMask: boolean[] = []; // true nếu là ngày đầu tháng
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(rangeStart);
      d.setDate(d.getDate() + i);
      columns.push(String(d.getDate()).padStart(2, '0')); // "01".."31"
      weekdayMask.push(d.getDay());
      monthBoundaryMask.push(d.getDate() === 1);
    }
    const todayLeftPct =
      ((today.getTime() - rangeStart.getTime()) / 86400000) / totalDays * 100;
    return {
      columns,
      columnsCount: totalDays,
      todayLeftPct: Math.max(0, Math.min(100, todayLeftPct)),
      rangeStart,
      rangeEnd,
      label: fmtMonthYear(today),
      unitDays: totalDays,
      weekdayMask,
      monthBoundaryMask,
    };
  }

  if (timeFilter === 'quarter') {
    // Range: 91 ngày (13 tuần) bắt đầu từ thứ 2 của tuần hiện tại.
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - (dayOfWeek - 1));
    rangeStart.setHours(0, 0, 0, 0);
    const totalDays = 91;
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + totalDays - 1);
    const columns: string[] = [];
    const weekdayMask: number[] = [];
    const monthBoundaryMask: boolean[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(rangeStart);
      d.setDate(d.getDate() + i);
      columns.push(fmtDdMm(d));
      weekdayMask.push(d.getDay());
      monthBoundaryMask.push(d.getDate() === 1);
    }
    const todayLeftPct =
      ((today.getTime() - rangeStart.getTime()) / 86400000) / totalDays * 100;
    return {
      columns,
      columnsCount: totalDays,
      todayLeftPct: Math.max(0, Math.min(100, todayLeftPct)),
      rangeStart,
      rangeEnd,
      label: `91 ngày từ ${fmtDdMm(rangeStart)} - ${fmtDdMm(rangeEnd)}`,
      unitDays: totalDays,
      weekdayMask,
      monthBoundaryMask,
    };
  }

  // 'year' — 365 (hoặc 366) ngày trong năm hiện tại.
  const year = today.getFullYear();
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const rangeStart = new Date(year, 0, 1);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(year, 11, 31);
  rangeEnd.setHours(0, 0, 0, 0);
  const totalDays = isLeap ? 366 : 365;
  const columns: string[] = [];
  const weekdayMask: number[] = [];
  const monthBoundaryMask: boolean[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + i);
    // Compact: chỉ show "dd/MM" khi là ngày đầu tháng, các ngày khác rỗng (rất nhiều cột).
    columns.push(d.getDate() === 1 ? fmtDdMm(d) : '');
    weekdayMask.push(d.getDay());
    monthBoundaryMask.push(d.getDate() === 1);
  }
  const todayLeftPct =
    ((today.getTime() - rangeStart.getTime()) / 86400000) / totalDays * 100;
  return {
    columns,
    columnsCount: totalDays,
    todayLeftPct: Math.max(0, Math.min(100, todayLeftPct)),
    rangeStart,
    rangeEnd,
    label: `${totalDays} ngày năm ${year}`,
    unitDays: totalDays,
    weekdayMask,
    monthBoundaryMask,
  };
}

export const Gantt4TangView: React.FC<Gantt4TangViewProps> = ({
  tierItems,
  currentUser,
  onSelectItem,
  onOpenNewModal,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  // Fix #15: searchTermRaw lưu giá trị input ngay, debounce 300ms xuống searchTerm
  const [searchTermRaw, setSearchTermRaw] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setSearchTerm(searchTermRaw), 300);
    return () => clearTimeout(handle);
  }, [searchTermRaw]);
  const [timeFilter, setTimeFilter] = useState<'month' | 'quarter' | 'year'>('month');
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  // Fix UI-05: timeline tính động từ timeFilter + Date.now()
  const timeline = useMemo(() => buildTimeline(timeFilter, new Date()), [timeFilter]);
  // Tính today column index cho cả 3 view (month/quarter/year), clamp về [0, columnsCount-1]
  const todayCol = Math.max(
    0,
    Math.min(timeline.columnsCount - 1, Math.floor((timeline.todayLeftPct / 100) * timeline.columnsCount))
  );

  // Dynamic filter + DFS tree order (filter mà vẫn giữ thứ tự cây).
  // push của mảng gốc → T1, hết T2, hết T3, hết T4. Giờ sort theo cây: T1 → T2 con →
  // T3 con → T4 con).
  const filteredItems = useMemo(() => {
    const filtered = tierItems.filter((item) => {
      const matchSearch =
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.owner.name.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchSearch) return false;
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
  }, [tierItems, searchTerm, allCollapsed, collapsedMap]);

  const toggleCollapseAll = () => {
    setAllCollapsed(!allCollapsed);
  };

  const toggleRowCollapse = (e: React.MouseEvent, id: string) => {
    // Fix #16: chặn cả bubble (click) và capture (mousedown) để chắc chắn
    // row's onClick (DetailsDrawer) không trigger khi click toggle.
    e.stopPropagation();
    e.preventDefault();
    setCollapsedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Counts
  const t1Count = tierItems.filter((i) => i.tier === 1).length;
  const t2Count = tierItems.filter((i) => i.tier === 2).length;
  const t3Count = tierItems.filter((i) => i.tier === 3).length;
  const t4Count = tierItems.filter((i) => i.tier === 4).length;

  // Read-only context: T1 project mà currentUser không thể edit.
  // - Admin/director: không bao giờ read-only (full quyền)
  // - Manager: T1 ngoài dept của mình → read-only
  // - Employee: TẤT CẢ T1 đều read-only (chỉ xem để biết project context)
  const userDepts = currentUser?.departments ?? [];
  const isReadOnlyContext = (item: TierItem): boolean => {
    if (item.tier !== 1) return false;
    const role = currentUser?.role;
    if (role === 'admin' || role === 'director') return false;
    if (role === 'employee') return true; // mọi T1 đều read-only
    // manager
    if (!item.department) return false;
    return !userDepts.includes(item.department as never);
  };
  // True nếu có ít nhất 1 T1 read-only trong data → hiện chú thích ở legend
  const hasReadOnlyContext = tierItems.some(isReadOnlyContext);

  // --- Dynamic KPI calculations ---
  const avgAll =
    tierItems.length === 0
      ? 0
      : Math.round(tierItems.reduce((s, i) => s + i.progress, 0) / tierItems.length);

  const blockedItems = tierItems.filter(
    (i) => i.status === 'Đang nghẽn' || i.status === 'Điểm nghẽn' || i.blockerAlert
  );

  // On-time rate for T3: non-blocked items
  const t3Items = tierItems.filter((i) => i.tier === 3);
  const t3OnTime = t3Items.filter(
    (i) => i.status !== 'Đang nghẽn' && i.status !== 'Điểm nghẽn'
  ).length;
  const t3OnTimePct =
    t3Items.length === 0 ? 0 : Math.round((t3OnTime / t3Items.length) * 100);

  // Segmented bar helpers
  const filledSegs = (pct: number) => Math.round(pct / 10);

  return (
    <div className="flex flex-col w-full">
      {/* Top Minimalist Sub-Header */}
      <div className="w-full px-4 sm:px-6 py-5 bg-white border-b border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="max-w-[1720px] mx-auto flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-[22px] sm:text-[26px] font-bold text-[#0b1c30] tracking-tight">
              Hệ thống công việc và báo cáo TAG
            </h1>
            <p className="text-[13px] text-[#434655] flex items-center gap-2 flex-wrap">
              <span>Dự án</span>
              <span className="material-symbols-outlined text-[13px] text-[#737686]">arrow_forward</span>
              <span>Giai đoạn</span>
              <span className="material-symbols-outlined text-[13px] text-[#737686]">arrow_forward</span>
              <span>Hạng mục</span>
              <span className="material-symbols-outlined text-[13px] text-[#737686]">arrow_forward</span>
              <span>Đầu việc</span>
            </p>
          </div>

          {/* Action & View Controls */}
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            {/* Time Filter Segmented — Fix UI-05: labels động theo current month/quarter/year */}
            <div className="flex items-center bg-[#eff4ff] p-1 rounded-md">
              {(['month', 'quarter', 'year'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeFilter(tf)}
                  className={`px-3 py-1 text-[12px] font-semibold rounded transition-colors ${
                    timeFilter === tf
                      ? 'bg-white shadow-sm text-[#004ac6]'
                      : 'text-[#565e74] hover:text-[#0b1c30]'
                  }`}
                  type="button"
                >
                  {tf === 'month' && fmtMonthYear(new Date())}
                  {tf === 'quarter' &&
                    `Quý ${Math.floor(new Date().getMonth() / 3) + 1}/${new Date().getFullYear()}`}
                  {tf === 'year' && `Cả năm ${new Date().getFullYear()}`}
                </button>
              ))}
            </div>

            {/* Tree Controls */}
            <button
              onClick={toggleCollapseAll}
              className="h-8 px-3 bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-semibold rounded flex items-center gap-1.5 transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">
                {allCollapsed ? 'unfold_more' : 'unfold_less'}
              </span>
              <span>{allCollapsed ? 'Mở rộng tất cả' : 'Thu gọn tất cả'}</span>
            </button>

            <button
              onClick={onOpenNewModal}
              className="h-8 px-3.5 bg-[#004ac6] hover:bg-[#2563eb] text-white text-[12px] font-semibold rounded flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
              type="button"
            >
              <span className="material-symbols-outlined text-[17px]">add</span>
              <span>+ Thêm mới</span>
            </button>
          </div>
        </div>
      </div>

      {/* Segmented KPI Strip — tính động từ tierItems */}
      <div className="w-full px-4 sm:px-6 py-4 bg-[#f8f9ff]">
        <div className="max-w-[1720px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Tổng tiến độ */}
          <div className="bg-white p-4 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                Tổng tiến độ
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-[32px] font-bold text-[#0b1c30] tabular-nums tracking-tight">
                {avgAll}%
              </span>
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    i < filledSegs(avgAll) ? 'bg-[#004ac6]' : 'bg-[#e5eeff]'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* KPI 2: Dự án Tầng 1 */}
          <div className="bg-white p-4 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                Dự án
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-[32px] font-bold text-[#0b1c30] tabular-nums tracking-tight">
                {t1Count}
              </span>
              <span className="text-[12px] text-[#565e74]">
                dự án đang kích hoạt
              </span>
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    i < Math.min(t1Count, 10) ? 'bg-[#004ac6]' : 'bg-[#e5eeff]'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* KPI 3: Hạng mục T3 */}
          <div className="bg-white p-4 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                Hạng mục giao &amp; Gói việc
              </span>
              <span className="text-[11px] font-semibold text-[#006243]">
                {t3OnTimePct}% đúng hạn
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-[32px] font-bold text-[#0b1c30] tabular-nums tracking-tight">
                {t3Count}
              </span>
              <span className="text-[12px] text-[#565e74]">
                hạng mục (Tầng 3)
              </span>
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    i < filledSegs(t3OnTimePct) ? 'bg-[#007d57]' : 'bg-[#e5eeff]'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* KPI 4: Điểm nghẽn */}
          <div className="bg-white p-4 rounded-lg border border-[#e5eeff] shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider">
                Điểm nghẽn
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span
                className={`text-[32px] font-bold tabular-nums tracking-tight ${
                  blockedItems.length > 0 ? 'text-[#ba1a1a]' : 'text-[#006243]'
                }`}
              >
                {blockedItems.length}
              </span>
              <span className="text-[12px] text-[#565e74]">
                {blockedItems.length > 0 ? 'điểm nghẽn phụ thuộc' : 'không có vướng mắc'}
              </span>
            </div>
            <div className="flex items-center gap-[3px] pt-1">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    blockedItems.length > 0 && i < Math.min(blockedItems.length, 10)
                      ? 'bg-[#ba1a1a]'
                      : blockedItems.length === 0 && i < 10
                      ? 'bg-[#006243]'
                      : 'bg-[#e5eeff]'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Unified Workspace: Tree Table + Gantt Timeline */}
      <div className="w-full px-4 sm:px-6 pb-10">
        <div className="max-w-[1720px] mx-auto bg-white rounded-lg border border-[#e5eeff] shadow-sm overflow-hidden flex flex-col">
          {/* Top Search & Timeline Legend Bar */}
          <div className="h-12 px-4 bg-white flex items-center justify-between gap-4 border-b border-[#eff4ff]">
            <div className="flex items-center gap-4">
              <div className="relative w-64 sm:w-72">
                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[#737686]">
                  search
                </span>
                <input
                  value={searchTermRaw}
                  onChange={(e) => setSearchTermRaw(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 text-[13px] bg-[#eff4ff] text-[#0b1c30] placeholder:text-[#737686] rounded focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  placeholder="Lọc dự án, gói việc, mã..."
                  type="text"
                />
              </div>
              <span className="text-[12px] text-[#565e74] hidden md:inline-block">
                Hiển thị <strong className="text-[#0b1c30]">{t1Count} Dự án</strong> ·{' '}
                {t2Count} Giai đoạn · {t3Count} Hạng mục · {t4Count} Đầu việc
              </span>
            </div>

            {/* Timeline Legend */}
            <div className="hidden xl:flex items-center gap-4 text-[11px] font-semibold text-[#565e74]">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#0F172A]"></span>
                <span>T1: Dự án</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#004ac6]"></span>
                <span>T2: Giai đoạn</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#0284c7]"></span>
                <span>T3: Hạng mục</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#006243]"></span>
                <span>T4: Đầu việc</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#f59e0b]"></span>
                <span>T4: Nghẽn</span>
              </div>
              {hasReadOnlyContext && (
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-sm bg-[#94a3b8]"></span>
                  <span>Chỉ đọc</span>
                </div>
              )}
            </div>
          </div>

          {/* Split Layout Container */}
          <div className="w-full overflow-x-auto no-scrollbar">
            <div className="min-w-[1280px] flex flex-col">
              {/* Table Column Headers */}
              <div className="flex items-stretch bg-[#eff4ff] text-[#565e74] text-[11px] font-bold uppercase tracking-wider h-10 select-none border-b border-[#dce9ff]">
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
                    horizontal scroll nếu nhiều ngày (quarter 91 / year 365). */}
                <div
                  className="w-[50%] bg-[#e5eeff] text-center font-mono text-[10px] relative font-semibold text-[#434655]"
                  style={{ display: 'grid', gridTemplateColumns: `repeat(${timeline.columnsCount}, minmax(20px, 1fr))` }}
                >
                  {timeline.columns.map((label, idx) => {
                    const isTodayCol = idx === todayCol;
                    const weekday = timeline.weekdayMask[idx];
                    const isWeekend = weekday === 0 || weekday === 6; // CN hoặc T7
                    const isMonthStart = timeline.monthBoundaryMask[idx];
                    return (
                      <div
                        key={idx}
                        className={`py-1 flex flex-col items-center justify-center border-l border-[#dce9ff] ${
                          isTodayCol ? 'bg-[#004ac6] text-white' : isWeekend ? 'bg-[#dce9ff]/50 text-[#737686]' : ''
                        }`}
                        title={isMonthStart ? `Ngày đầu tháng` : undefined}
                      >
                        {timeFilter === 'month' && (
                          <span className={`text-[8px] font-medium ${isTodayCol ? 'text-white/80' : 'text-[#737686]'}`}>
                            T{weekday === 0 ? 7 : weekday}
                          </span>
                        )}
                        <span className="text-[10px] font-bold leading-none">{label}</span>
                        {isTodayCol && (
                          <span className="text-[8px] font-bold mt-0.5">HÔM NAY</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* DATA ROWS LIST */}
              <div className="flex flex-col relative divide-y divide-[#eff4ff]">
                {/* Fix #4: today marker nằm trong timeline column (50% phải), không phải full width.
                    Position = 50% (offset của timeline column) + todayLeftPct * 50% (tỷ lệ trong timeline). */}
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-[#004ac6] z-20 pointer-events-none"
                  style={{ left: `calc(50% + ${timeline.todayLeftPct / 2}%)` }}
                >
                  <div className="sticky top-10 -ml-1.5 w-3.5 h-3.5 rounded-full bg-[#004ac6] flex items-center justify-center shadow-md">
                    <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                  </div>
                </div>

                {filteredItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                    <span className="material-symbols-outlined text-[#c3c6d7] text-[48px] mb-2">
                      {currentUser?.role === 'employee' ? 'task_alt' : 'inbox'}
                    </span>
                    <h3 className="text-[15px] font-semibold text-[#0b1c30] mb-1">
                      {currentUser?.role === 'employee'
                        ? 'Bạn chưa có task nào được giao'
                        : 'Chưa có dữ liệu để hiển thị'}
                    </h3>
                    <p className="text-[12px] text-[#737686] max-w-md">
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
                  const zebraBase = idx % 2 === 0 ? 'bg-white' : 'bg-[#f8faff]';

                  // Indentation calculation based on Tier
                  const indentClass =
                    item.tier === 1
                      ? 'pl-2'
                      : item.tier === 2
                      ? 'pl-6'
                      : item.tier === 3
                      ? 'pl-10'
                      : 'pl-16';

                  const rowBg = readonlyCtx
                    ? 'bg-slate-50/70 hover:bg-slate-100/80'
                    : item.blockerAlert
                    ? 'bg-amber-50/60 hover:bg-amber-100/70'
                    : item.tier === 1
                    ? `${zebraBase} hover:bg-[#eff4ff]/80`
                    : `${zebraBase} hover:bg-[#eff4ff]/70`;

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      // Fix #9: hover state trigger từ row để bắt tooltip cả khi di chuột vào phần tree (left 50%)
                      onMouseEnter={() => setHoveredItemId(item.id)}
                      onMouseLeave={() => setHoveredItemId(null)}
                      className={`flex items-stretch transition-colors cursor-pointer group ${rowBg}`}
                    >
                      {/* Left Cell (50%) */}
                      <div
                        className={`w-[50%] flex items-center px-4 py-2 ${indentClass} border-r border-[#eff4ff]`}
                      >
                        <div className="flex-1 flex items-center gap-1.5 min-w-0 pr-3">
                          {readonlyCtx ? (
                            <span
                              className="w-5 h-5 flex items-center justify-center text-slate-400 shrink-0"
                              title="Dự án do phòng ban khác phụ trách — bạn chỉ có thể xem, không sửa"
                            >
                              <span className="material-symbols-outlined text-[16px]">lock</span>
                            </span>
                          ) : isCollapsible ? (
                            <button
                              onClick={(e) => toggleRowCollapse(e, item.id)}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="w-5 h-5 flex items-center justify-center text-[#565e74] hover:bg-[#e5eeff] rounded"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[17px]">
                                {isCollapsed ? 'chevron_right' : 'keyboard_arrow_down'}
                              </span>
                            </button>
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#737686] shrink-0 mr-1.5"></span>
                          )}

                          {/* Tier Badge */}
                          {item.tier === 1 && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wider ${
                                readonlyCtx
                                  ? 'bg-slate-300 text-slate-700'
                                  : 'bg-[#0F172A] text-white'
                              }`}
                            >
                              DỰ ÁN T1
                            </span>
                          )}
                          {readonlyCtx && (
                            <span
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 shrink-0 uppercase tracking-wider flex items-center gap-0.5"
                              title={`Dự án thuộc phòng ban "${item.department}" — không thuộc phòng ban của bạn. Bạn có thể xem nhưng không thể sửa.`}
                            >
                              <span className="material-symbols-outlined text-[11px]">visibility</span>
                              <span>Chỉ đọc</span>
                            </span>
                          )}
                          {item.tier === 2 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#dbe1ff] text-[#00174b] shrink-0 uppercase tracking-wider">
                              GIAI ĐOẠN T2
                            </span>
                          )}
                          {item.tier === 3 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 shrink-0 uppercase tracking-wider">
                              HẠNG MỤC T3
                            </span>
                          )}
                          {item.tier === 4 && (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[#eff4ff] text-[#434655] shrink-0 uppercase tracking-wider">
                              VIỆC T4
                            </span>
                          )}

                          <span
                            className={`truncate ${
                              readonlyCtx
                                ? 'font-bold text-[14px] text-slate-500'
                                : item.tier === 1
                                ? 'font-bold text-[14px] text-[#0b1c30]'
                                : item.tier === 2
                                ? 'font-semibold text-[13px] text-[#0b1c30]'
                                : item.tier === 3
                                ? 'font-medium text-[13px] text-[#0b1c30]'
                                : 'text-[13px] text-[#434655] group-hover:text-[#0b1c30]'
                            }`}
                          >
                            {item.title}
                          </span>

                          {item.blockerAlert && (
                            <span
                              className="material-symbols-outlined text-[15px] text-[#ba1a1a] shrink-0"
                              title={item.blockerAlert}
                            >
                              warning
                            </span>
                          )}
                        </div>

                        {/* Owner */}
                        <div className="w-28 flex items-center gap-1.5 shrink-0">
                          {item.owner.avatar ? (
                            <img
                              src={item.owner.avatar}
                              alt={item.owner.name}
                              className="w-5 h-5 rounded-full object-cover ring-1 ring-slate-200"
                            />
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-[#dae2fd] text-[#131b2e] text-[10px] flex items-center justify-center font-bold">
                              {item.owner.initial}
                            </span>
                          )}
                          <span className="text-[13px] text-[#0b1c30] truncate">
                            {item.owner.name}
                          </span>
                        </div>

                        {/* Deadline */}
                        <div
                          className={`w-24 text-center font-mono text-[12px] shrink-0 ${
                            item.blockerAlert ? 'text-[#ba1a1a] font-semibold' : 'text-[#434655]'
                          }`}
                        >
                          {item.endDate}
                        </div>

                        {/* Progress */}
                        <div className="w-28 px-1.5 shrink-0">
                          <div className="flex items-center justify-between text-[11px] mb-0.5">
                            <span className="font-mono text-[#565e74]">
                              {item.tier === 1
                                ? 'Tổng'
                                : item.tier === 2
                                ? `GD ${item.code.replace('GD-', '')}`
                                : item.code}
                            </span>
                            <span
                              className={`font-bold font-mono ${
                                item.progress === 100
                                  ? 'text-[#006243]'
                                  : item.blockerAlert
                                  ? 'text-amber-700'
                                  : 'text-[#004ac6]'
                              }`}
                            >
                              {item.progress}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-[#eff4ff] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                item.progress === 100
                                  ? 'bg-[#006243]'
                                  : item.blockerAlert
                                  ? 'bg-amber-500'
                                  : 'bg-[#004ac6]'
                              }`}
                              style={{ width: `${item.progress}%` }}
                            ></div>
                          </div>
                        </div>

                        {/* Status */}
                        <div className="w-24 text-center shrink-0">
                          {item.progress === 100 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#006243]">
                              <span className="material-symbols-outlined text-[15px]">
                                check_circle
                              </span>
                              <span>Đã xong</span>
                            </span>
                          ) : item.status === 'Đang nghẽn' ? (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-[#ba1a1a]">
                              Đang nghẽn
                            </span>
                          ) : item.status === 'Điểm nghẽn' ? (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                              Cần gỡ
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#eff4ff] text-[#004ac6]">
                              {item.status}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Cell: Gantt Bar Timeline (50%) */}
                      <div className="w-[50%] relative flex items-center px-1.5 bg-[#eff4ff]/15">
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
                            const isMonthStart = timeline.monthBoundaryMask[i];
                            return (
                              <div
                                key={i}
                                className={`border-r border-dashed border-[#dce9ff] ${
                                  i === todayCol ? 'bg-[#004ac6]/[0.015]' :
                                  isWeekend ? 'bg-[#dce9ff]/40' : ''
                                } ${isMonthStart ? 'border-r-2 border-r-[#004ac6]/40' : ''}`}
                              />
                            );
                          })}
                        </div>

                        {/* Dynamic Gantt Bar — Fix UI-05:
                            month view: dùng gantt.startWeek/endWeek (1..N tuần)
                            year view: dùng deadline để suy ra vị trí */}
                        {(() => {
                          // Tính bar position/width từ startDate/endDate trực tiếp (đơn vị ngày).
                          // Không dùng week index nữa — fix #17 sau refactor day-based.
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
                          const startPct = Math.max(0, Math.min(100, (startDay / timeline.unitDays) * 100));
                          const endPct = Math.max(0, Math.min(100, ((endDay + 1) / timeline.unitDays) * 100));
                          // Nếu endDate trước startDate (data lỗi), fallback về 1 ngày duration
                          const leftPct = startPct;
                          const widthPct = endPct > startPct
                            ? endPct - startPct
                            : Math.max(0.5, (1 / timeline.unitDays) * 100);
                          const isBlocked = item.status === 'Đang nghẽn' || item.status === 'Điểm nghẽn';
                          // Fix #6: isBlocked ưu tiên tier color — T1/T2/T3 nghẽn cũng đỏ.
                          const barColor =
                            readonlyCtx ? '#94a3b8' :
                            isBlocked ? '#ba1a1a' :
                            item.tier === 1 ? '#0F172A'
                            : item.tier === 2 ? '#004ac6'
                            : item.tier === 3 ? '#0284c7'
                            : '#006243';
                          const height = item.tier === 1 ? 'h-5' : item.tier === 2 ? 'h-4' : item.tier === 3 ? 'h-3.5' : 'h-3';
                          // Fix #3: width < 2% (≈ < 1 ngày trong month view, < 2 ngày trong quarter,
                          // < 1 tuần trong year) → milestone (◆ diamond) thay vì clamp bar
                          // quá rộng khiến task ngắn bị "phóng to" trực quan.
                          const isMilestone = widthPct < 2 && item.tier >= 2;
                          return (
                            <>
                              {isMilestone ? (
                                // Milestone: diamond shape, anchored at leftPct
                                <div
                                  className={`absolute ${height} w-3.5 -translate-x-1/2 rotate-45 transition-all duration-150 cursor-pointer ${
                                    isHovered
                                      ? 'shadow-xl ring-2 ring-[#004ac6]/50 z-10 brightness-110 scale-110'
                                      : 'shadow-sm'
                                  } ${isBlocked ? 'ring-2 ring-[#ba1a1a]/60' : ''}`}
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
                                      ? 'shadow-xl ring-2 ring-[#004ac6]/50 z-10 brightness-110'
                                      : 'shadow-sm'
                                  } ${isBlocked ? 'ring-2 ring-[#ba1a1a]/60 ring-offset-1' : ''}`}
                                  style={{
                                    left: `${leftPct}%`,
                                    width: `${Math.max(widthPct, 3)}%`,
                                    backgroundColor: barColor,
                                  }}
                                >
                                  {item.tier <= 3 && !isMilestone && (
                                    <span className="font-mono text-[9px] px-1.5 text-white truncate">
                                      {item.progress}%
                                    </span>
                                  )}
                                  {item.tier === 1 && (
                                    <span className="font-mono text-[11px] font-bold text-white shrink-0 ml-auto mr-1.5">
                                      {item.progress}%
                                    </span>
                                  )}
                                  {/* Blocked: thay animate-ping bằng icon warning tĩnh — pro hơn, không gây mỏi mắt */}
                                  {isBlocked && (
                                    <span
                                      className="material-symbols-outlined text-white text-[12px] ml-auto mr-1 shrink-0"
                                      style={{ fontVariationSettings: "'wght' 700, 'FILL' 1" }}
                                    >
                                      priority_high
                                    </span>
                                  )}
                                  {/* Fix #11: critical path marker */}
                                  {item.priority === 'Cao (Critical Path)' && !isBlocked && (
                                    <span
                                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#f59e0b] ring-1 ring-white"
                                      title="Critical path"
                                    />
                                  )}
                                </div>
                              )}

                              {/* Custom Tooltip — hiện khi hover bar */}
                              {isHovered && (
                                <div
                                  className="absolute z-30 pointer-events-none"
                                  style={{
                                    // Fix #8: milestone anchor tại leftPct (center diamond),
                                    // bar center vẫn dùng leftPct + widthPct/2.
                                    left: `${Math.min(95, Math.max(5, isMilestone ? leftPct : leftPct + widthPct / 2))}%`,
                                    bottom: 'calc(100% + 10px)',
                                    transform: 'translateX(-50%)',
                                  }}
                                >
                                  <div className="bg-slate-900 text-white text-[11px] rounded-lg shadow-2xl px-3 py-2 min-w-[200px] max-w-[260px]">
                                    <div className="font-bold text-[12px] mb-1.5 text-white leading-tight">
                                      {item.title}
                                    </div>
                                    <div className="flex justify-between gap-3 mb-0.5">
                                      <span className="text-slate-400">Mã:</span>
                                      <span className="font-mono font-semibold">{item.code}</span>
                                    </div>
                                    <div className="flex justify-between gap-3 mb-0.5">
                                      <span className="text-slate-400">Phụ trách:</span>
                                      <span className="font-medium truncate max-w-[120px]">{item.owner.name}</span>
                                    </div>
                                    <div className="flex justify-between gap-3 mb-0.5">
                                      <span className="text-slate-400">Hạn:</span>
                                      <span className="font-mono">{item.endDate}</span>
                                    </div>
                                    <div className="flex justify-between gap-3 mb-0.5">
                                      <span className="text-slate-400">Trạng thái:</span>
                                      <span className="font-medium">{item.status}</span>
                                    </div>
                                    <div className="flex justify-between gap-3 pt-1 border-t border-slate-700">
                                      <span className="text-slate-400">Tiến độ:</span>
                                      <span
                                        className="font-bold font-mono"
                                        style={{ color: item.progress === 100 ? '#86efac' : '#bfdbfe' }}
                                      >
                                        {item.progress}%
                                      </span>
                                    </div>
                                    {item.blockerAlert && (
                                      <div className="mt-1.5 pt-1.5 border-t border-slate-700 text-amber-300 text-[10px] leading-snug">
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
