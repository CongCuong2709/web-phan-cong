import React, { useState, useMemo } from 'react';
import { TierItem } from '../types';

interface Gantt4TangViewProps {
  tierItems: TierItem[];
  onSelectItem: (item: TierItem) => void;
  onOpenNewModal: () => void;
  onExport: () => void;
}

/** Format dd/MM (Fix UI-05 helper). */
function fmtDdMm(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Format "Tháng N/YYYY". */
function fmtMonthYear(d: Date): string {
  return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
}

/** Tính timeline header theo timeFilter. Trả về:
 *  - columns: danh sách nhãn hiển thị (4 tuần / 13 tuần / 12 tháng)
 *  - columnsCount: số cột
 *  - todayLeftPct: vị trí % của "hôm nay" trong timeline (0..100)
 *  - rangeStart/End: Date đầu/cuối timeline (cho Gantt bar mapping)
 *
 * Logic:
 *  - 'month'  → 4 tuần của tháng hiện tại (week starts Monday)
 *  - 'quarter'→ 13 tuần (~3 tháng) bắt đầu từ tuần hiện tại
 *  - 'year'   → 12 tháng của năm hiện tại
 */
function buildTimeline(timeFilter: 'month' | 'quarter' | 'year', today: Date) {
  const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // CN=0 → 7
  const monday = new Date(today);
  monday.setDate(monday.getDate() - (dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);

  if (timeFilter === 'month') {
    // 4 tuần của tháng hiện tại: tuần chứa ngày 1 tháng → ngày cuối tháng
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const startMonday = new Date(firstOfMonth);
    const sw = startMonday.getDay() === 0 ? 7 : startMonday.getDay();
    startMonday.setDate(startMonday.getDate() - (sw - 1));
    const totalDays = Math.ceil((lastOfMonth.getTime() - startMonday.getTime()) / 86400000) + 1;
    const numWeeks = Math.ceil(totalDays / 7);
    const columns: string[] = [];
    for (let i = 0; i < numWeeks; i++) {
      const ws = new Date(startMonday);
      ws.setDate(ws.getDate() + i * 7);
      const we = new Date(ws);
      we.setDate(we.getDate() + 6);
      columns.push(`Tuần ${i + 1} (${fmtDdMm(ws)} - ${fmtDdMm(we)})`);
    }
    const todayLeftPct = ((today.getTime() - startMonday.getTime()) / 86400000) / totalDays * 100;
    return {
      columns,
      columnsCount: numWeeks,
      todayLeftPct: Math.max(0, Math.min(100, todayLeftPct)),
      rangeStart: startMonday,
      rangeEnd: lastOfMonth,
      label: fmtMonthYear(today),
      unitDays: totalDays,
    };
  }

  if (timeFilter === 'quarter') {
    const numWeeks = 13;
    const start = new Date(monday);
    const columns: string[] = [];
    for (let i = 0; i < numWeeks; i++) {
      const ws = new Date(start);
      ws.setDate(ws.getDate() + i * 7);
      const we = new Date(ws);
      we.setDate(we.getDate() + 6);
      columns.push(`T${i + 1} (${fmtDdMm(ws)}-${fmtDdMm(we)})`);
    }
    const totalDays = numWeeks * 7;
    const todayLeftPct = ((today.getTime() - start.getTime()) / 86400000) / totalDays * 100;
    const end = new Date(start);
    end.setDate(end.getDate() + totalDays - 1);
    return {
      columns,
      columnsCount: numWeeks,
      todayLeftPct: Math.max(0, Math.min(100, todayLeftPct)),
      rangeStart: start,
      rangeEnd: end,
      label: `Quý ${Math.floor(today.getMonth() / 3) + 1}/${today.getFullYear()}`,
      unitDays: totalDays,
    };
  }

  // 'year'
  const year = today.getFullYear();
  const columns: string[] = [];
  for (let m = 0; m < 12; m++) {
    columns.push(`T${m + 1}/${year}`);
  }
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const totalDays = 365 + (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0);
  const todayLeftPct = ((today.getTime() - start.getTime()) / 86400000) / totalDays * 100;
  return {
    columns,
    columnsCount: 12,
    todayLeftPct: Math.max(0, Math.min(100, todayLeftPct)),
    rangeStart: start,
    rangeEnd: end,
    label: `Cả năm ${year}`,
    unitDays: totalDays,
  };
}

export const Gantt4TangView: React.FC<Gantt4TangViewProps> = ({
  tierItems,
  onSelectItem,
  onOpenNewModal,
  onExport,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
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

  // Dynamic filter + DFS tree order (Fix: trước đây chỉ filter nên render theo thứ tự
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
    e.stopPropagation();
    setCollapsedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Counts
  const t1Count = tierItems.filter((i) => i.tier === 1).length;
  const t2Count = tierItems.filter((i) => i.tier === 2).length;
  const t3Count = tierItems.filter((i) => i.tier === 3).length;
  const t4Count = tierItems.filter((i) => i.tier === 4).length;

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
            <div className="flex items-center gap-1.5 text-[#565e74] text-[11px] font-semibold uppercase tracking-wider">
              <span>Tiến độ tổ chức</span>
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              <span className="text-[#004ac6] font-bold">Khung điều hành 4 tầng</span>
            </div>
            <h1 className="text-[22px] sm:text-[26px] font-bold text-[#0b1c30] tracking-tight">
              Tiến độ & Cây Gantt 4 Tầng
            </h1>
            <p className="text-[13px] text-[#434655] flex items-center gap-2 flex-wrap">
              <span>Dự án (Tầng 1)</span>
              <span className="material-symbols-outlined text-[13px] text-[#737686]">arrow_forward</span>
              <span>Giai đoạn (Tầng 2)</span>
              <span className="material-symbols-outlined text-[13px] text-[#737686]">arrow_forward</span>
              <span>Hạng mục giao (Tầng 3)</span>
              <span className="material-symbols-outlined text-[13px] text-[#737686]">arrow_forward</span>
              <span>Đầu việc (Tầng 4)</span>
              <span className="font-mono text-[11px] font-semibold px-2 py-0.5 bg-[#eff4ff] text-[#004ac6] rounded">
                Cộng dồn tự động (Auto-Rollup)
              </span>
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
                Tổng tiến độ toàn diện
              </span>
              <span className="font-mono text-[11px] text-[#004ac6] font-semibold">
                Tự động tính
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
                Dự án trọng điểm
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#eff4ff] text-[#004ac6] uppercase">
                Tầng 1 Active
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
                Điểm nghẽn cần tháo gỡ
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ffdad6] text-[#ba1a1a] uppercase">
                Critical Path
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
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
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
                <span>T1: Dự án (Executive)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#004ac6]"></span>
                <span>T2: Giai đoạn</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#0284c7]"></span>
                <span>T3: Hạng mục giao</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#006243]"></span>
                <span>T4: Đầu việc hoàn thành</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[#f59e0b]"></span>
                <span>T4: Điểm nghẽn/Chờ duyệt</span>
              </div>
            </div>
          </div>

          {/* Split Layout Container */}
          <div className="w-full overflow-x-auto no-scrollbar">
            <div className="min-w-[1280px] flex flex-col">
              {/* Table Column Headers */}
              <div className="flex items-stretch bg-[#eff4ff] text-[#565e74] text-[11px] font-bold uppercase tracking-wider h-10 select-none border-b border-[#dce9ff]">
                {/* Left 50% Tree Grid Header */}
                <div className="w-[50%] flex items-center px-4">
                  <span className="flex-1">Cấu trúc cây 4 tầng & Tên công việc</span>
                  <span className="w-28 text-left">Phụ trách</span>
                  <span className="w-24 text-center">Hạn chót</span>
                  <span className="w-28 text-center">Tiến độ</span>
                  <span className="w-24 text-center">Trạng thái</span>
                </div>

                {/* Right 50% Timeline Axis — Fix UI-05: columns + highlight column chứa today (đủ 3 view) */}
                <div
                  className="w-[50%] bg-[#e5eeff] text-center font-mono text-[11px] relative font-semibold text-[#434655]"
                  style={{ display: 'grid', gridTemplateColumns: `repeat(${timeline.columnsCount}, minmax(0, 1fr))` }}
                >
                  {timeline.columns.map((label, idx) => {
                    const isTodayCol = idx === todayCol;
                    return (
                      <div
                        key={idx}
                        className={`py-1 flex items-center justify-center gap-1.5 border-l border-[#dce9ff] ${
                          isTodayCol ? 'bg-[#004ac6]/10 text-[#004ac6]' : ''
                        }`}
                      >
                        <span className="truncate px-1">{label}</span>
                        {isTodayCol && (
                          <span className="px-1.5 py-0.5 rounded bg-[#004ac6] text-white text-[9px] font-bold shrink-0">
                            HÔM NAY
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* DATA ROWS LIST */}
              <div className="flex flex-col relative divide-y divide-[#eff4ff]">
                {/* Fix UI-05: today marker line ở vị trí % tính từ ngày thực, không hardcode */}
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-[#004ac6] z-20 pointer-events-none"
                  style={{ left: `${timeline.todayLeftPct}%` }}
                >
                  <div className="sticky top-10 -ml-1.5 w-3.5 h-3.5 rounded-full bg-[#004ac6] flex items-center justify-center shadow-md">
                    <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                  </div>
                </div>

                {filteredItems.map((item, idx) => {
                  const isCollapsible = item.tier === 1 || item.tier === 2 || item.tier === 3;
                  const isCollapsed = collapsedMap[item.id];
                  const isHovered = hoveredItemId === item.id;

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

                  const rowBg = item.blockerAlert
                    ? 'bg-amber-50/60 hover:bg-amber-100/70'
                    : item.tier === 1
                    ? `${zebraBase} hover:bg-[#eff4ff]/80`
                    : `${zebraBase} hover:bg-[#eff4ff]/70`;

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      className={`flex items-stretch transition-colors cursor-pointer group ${rowBg}`}
                    >
                      {/* Left Cell (50%) */}
                      <div
                        className={`w-[50%] flex items-center px-4 py-2 ${indentClass} border-r border-[#eff4ff]`}
                      >
                        <div className="flex-1 flex items-center gap-1.5 min-w-0 pr-3">
                          {isCollapsible ? (
                            <button
                              onClick={(e) => toggleRowCollapse(e, item.id)}
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
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0F172A] text-white shrink-0 uppercase tracking-wider">
                              DỰ ÁN T1
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
                              item.tier === 1
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
                          {item.deadline}
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
                        {/* Timeline Grid vertical guides — số cột động theo timeFilter */}
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${timeline.columnsCount}, minmax(0, 1fr))`,
                          }}
                        >
                          {Array.from({ length: timeline.columnsCount }, (_, i) => (
                            <div
                              key={i}
                              className={`border-r border-dashed border-[#dce9ff] ${
                                timeFilter === 'month' && i === todayCol
                                  ? 'bg-[#004ac6]/[0.015]'
                                  : ''
                              }`}
                            />
                          ))}
                        </div>

                        {/* Dynamic Gantt Bar — Fix UI-05:
                            month view: dùng gantt.startWeek/endWeek (1..N tuần)
                            year view: dùng deadline để suy ra vị trí */}
                        {(() => {
                          let leftPct = 0;
                          let widthPct = 0;
                          if (timeFilter === 'month') {
                            const WEEKS = timeline.columnsCount;
                            const sw = Math.max(1, Math.min(WEEKS, item.gantt.startWeek ?? 1));
                            const ew = Math.max(sw + 0.1, Math.min(WEEKS, item.gantt.endWeek ?? sw + 0.5));
                            leftPct = ((sw - 1) / WEEKS) * 100;
                            widthPct = ((ew - sw) / WEEKS) * 100;
                          } else {
                            // quarter / year: parse deadline (dd/MM/yyyy hoặc ISO 'YYYY-MM-DD')
                            const dMatch = /(\d{2})\/(\d{2})\/(\d{4})/.exec(item.deadline)
                              ?? /^(\d{4})-(\d{2})-(\d{2})/.exec(item.deadline);
                            if (dMatch) {
                              let dayNum: number;
                              if (dMatch[1].length === 2) {
                                // dd/MM/yyyy
                                const dd = Number(dMatch[1]);
                                const mm = Number(dMatch[2]) - 1;
                                const yyyy = Number(dMatch[3]);
                                dayNum = Math.floor((new Date(yyyy, mm, dd).getTime() - timeline.rangeStart.getTime()) / 86400000);
                              } else {
                                // yyyy-MM-dd
                                const yyyy = Number(dMatch[1]);
                                const mm = Number(dMatch[2]) - 1;
                                const dd = Number(dMatch[3]);
                                dayNum = Math.floor((new Date(yyyy, mm, dd).getTime() - timeline.rangeStart.getTime()) / 86400000);
                              }
                              leftPct = Math.max(0, Math.min(100, (dayNum / timeline.unitDays) * 100));
                              // Width ước lượng = ~7% (1 tuần) hoặc 8% (year view)
                              widthPct = timeFilter === 'quarter' ? 7 : 8;
                            } else {
                              leftPct = 0;
                              widthPct = 3;
                            }
                          }
                          const barColor = item.gantt.barColor || (
                            item.tier === 1 ? '#0F172A'
                            : item.tier === 2 ? '#004ac6'
                            : item.tier === 3 ? '#0284c7'
                            : item.status === 'Đang nghẽn' || item.status === 'Điểm nghẽn'
                            ? '#ba1a1a' : '#006243'
                          );
                          const height = item.tier === 1 ? 'h-5' : item.tier === 2 ? 'h-4' : item.tier === 3 ? 'h-3.5' : 'h-2';
                          const isBlocked = item.status === 'Đang nghẽn' || item.status === 'Điểm nghẽn';
                          return (
                            <>
                              <div
                                onMouseEnter={() => setHoveredItemId(item.id)}
                                onMouseLeave={() => setHoveredItemId(null)}
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
                                {item.tier <= 3 && (
                                  <span className="font-mono text-[9px] px-1.5 text-white truncate">
                                    {item.gantt.label || `${item.progress}%`}
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
                              </div>

                              {/* Custom Tooltip — hiện khi hover bar */}
                              {isHovered && (
                                <div
                                  className="absolute z-30 pointer-events-none"
                                  style={{
                                    left: `${Math.min(95, Math.max(5, leftPct + widthPct / 2))}%`,
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
                                      <span className="font-mono">{item.deadline}</span>
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

          {/* Quick Summary Footer */}
          <div className="p-3 bg-[#eff4ff] flex flex-col sm:flex-row items-center justify-between text-[12px] text-[#565e74] gap-2 border-t border-[#dce9ff]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-[#004ac6]">
                sync
              </span>
              <span>
                Dữ liệu tiến độ tự động cộng dồn từ <strong>Tầng 4</strong> lên{' '}
                <strong>Tầng 1</strong> theo thời gian thực (Cập nhật 2 phút trước).
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onExport}
                className="text-[#004ac6] hover:underline font-semibold flex items-center gap-1"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>Xuất báo cáo PDF / Excel</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
