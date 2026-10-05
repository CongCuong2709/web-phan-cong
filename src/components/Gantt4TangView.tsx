import React, { useState, useMemo } from 'react';
import { TierItem } from '../types';

interface Gantt4TangViewProps {
  tierItems: TierItem[];
  onSelectItem: (item: TierItem) => void;
  onOpenNewModal: () => void;
  onExport: () => void;
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

  // Dynamic filter
  const filteredItems = useMemo(() => {
    return tierItems.filter((item) => {
      const matchSearch =
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.owner.name.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchSearch) return false;

      // Check if any ancestor is collapsed
      if (allCollapsed && (item.tier === 3 || item.tier === 4)) {
        return false;
      }

      if (item.parentId && collapsedMap[item.parentId]) {
        return false;
      }

      return true;
    });
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
            {/* Time Filter Segmented */}
            <div className="flex items-center bg-[#eff4ff] p-1 rounded-md">
              <button
                onClick={() => setTimeFilter('month')}
                className={`px-3 py-1 text-[12px] font-semibold rounded transition-colors ${
                  timeFilter === 'month'
                    ? 'bg-white shadow-sm text-[#004ac6]'
                    : 'text-[#565e74] hover:text-[#0b1c30]'
                }`}
                type="button"
              >
                Tháng 10/2026
              </button>
              <button
                onClick={() => setTimeFilter('quarter')}
                className={`px-3 py-1 text-[12px] font-semibold rounded transition-colors ${
                  timeFilter === 'quarter'
                    ? 'bg-white shadow-sm text-[#004ac6]'
                    : 'text-[#565e74] hover:text-[#0b1c30]'
                }`}
                type="button"
              >
                Quý 4/2026
              </button>
              <button
                onClick={() => setTimeFilter('year')}
                className={`px-3 py-1 text-[12px] font-semibold rounded transition-colors ${
                  timeFilter === 'year'
                    ? 'bg-white shadow-sm text-[#004ac6]'
                    : 'text-[#565e74] hover:text-[#0b1c30]'
                }`}
                type="button"
              >
                Cả năm
              </button>
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

                {/* Right 50% Timeline Axis */}
                <div className="w-[50%] grid grid-cols-4 items-center bg-[#e5eeff] text-center font-mono text-[12px] relative font-semibold text-[#434655]">
                  <div className="py-1">Tuần 1 (01 - 07/10)</div>
                  <div className="py-1 bg-[#004ac6]/10 text-[#004ac6] flex items-center justify-center gap-1.5">
                    <span>Tuần 2 (08 - 14/10)</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#004ac6] text-white text-[9px] font-bold">
                      HÔM NAY
                    </span>
                  </div>
                  <div className="py-1">Tuần 3 (15 - 21/10)</div>
                  <div className="py-1">Tuần 4 (22 - 31/10)</div>
                </div>
              </div>

              {/* DATA ROWS LIST */}
              <div className="flex flex-col relative divide-y divide-[#eff4ff]">
                {/* RED TODAY MARKER LINE (spanning entire timeline height in Week 2) */}
                <div className="absolute top-0 bottom-0 left-[62.5%] w-[2px] bg-[#004ac6] z-20 pointer-events-none">
                  <div className="sticky top-10 -ml-1.5 w-3.5 h-3.5 rounded-full bg-[#004ac6] flex items-center justify-center shadow-md">
                    <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                  </div>
                </div>

                {filteredItems.map((item) => {
                  const isCollapsible = item.tier === 1 || item.tier === 2 || item.tier === 3;
                  const isCollapsed = collapsedMap[item.id];

                  // Indentation calculation based on Tier
                  const indentClass =
                    item.tier === 1
                      ? 'pl-2'
                      : item.tier === 2
                      ? 'pl-6'
                      : item.tier === 3
                      ? 'pl-10'
                      : 'pl-16';

                  const rowBg =
                    item.blockerAlert
                      ? 'bg-amber-50/40 hover:bg-amber-100/40'
                      : item.tier === 1
                      ? 'bg-white hover:bg-[#eff4ff]/60'
                      : item.tier === 2
                      ? 'bg-white/90 hover:bg-[#eff4ff]/60'
                      : 'bg-white hover:bg-[#eff4ff]/60';

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
                        {/* Timeline Grid vertical guides */}
                        <div className="absolute inset-0 grid grid-cols-4 pointer-events-none">
                          <div className="border-r border-dashed border-[#dce9ff]"></div>
                          <div className="border-r border-dashed border-[#dce9ff] bg-[#004ac6]/[0.015]"></div>
                          <div className="border-r border-dashed border-[#dce9ff]"></div>
                          <div></div>
                        </div>

                        {/* Dynamic Gantt Bar — tính từ item.gantt.startWeek / endWeek (1–4 tuần) */}
                        {(() => {
                          const WEEKS = 4; // tổng số cột tuần
                          const sw = Math.max(1, Math.min(WEEKS, item.gantt.startWeek ?? 1));
                          const ew = Math.max(sw + 0.1, Math.min(WEEKS, item.gantt.endWeek ?? sw + 0.5));
                          const leftPct = ((sw - 1) / WEEKS) * 100;
                          const widthPct = ((ew - sw) / WEEKS) * 100;
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
                            <div
                              className={`absolute ${height} rounded shadow-sm flex items-center overflow-hidden`}
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
                              {isBlocked && (
                                <div className="w-1.5 h-1.5 rounded-full bg-white ml-0.5 animate-ping shrink-0" />
                              )}
                            </div>
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
