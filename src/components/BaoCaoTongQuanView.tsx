import React from 'react';
import { TierItem, TeamMember, TeamLeadTask } from '../types';

interface BaoCaoTongQuanViewProps {
  tierItems: TierItem[];
  teamMembers: TeamMember[];
  teamTasks: TeamLeadTask[];
  onExport: () => void;
}

export const BaoCaoTongQuanView: React.FC<BaoCaoTongQuanViewProps> = ({
  tierItems,
  teamMembers,
  teamTasks,
  onExport,
}) => {
  const completedTierItems = tierItems.filter((i) => i.progress === 100).length;
  const inProgressTierItems = tierItems.filter((i) => i.progress > 0 && i.progress < 100).length;
  const blockedItems = tierItems.filter((i) => i.status === 'Đang nghẽn' || i.status === 'Điểm nghẽn');

  // --- Dynamic KPI calculations (replacing all hardcoded values) ---
  const tier1Items = tierItems.filter((i) => i.tier === 1);
  const tier2Items = tierItems.filter((i) => i.tier === 2);
  const tier3Items = tierItems.filter((i) => i.tier === 3);

  const avgProgress = (items: typeof tierItems) =>
    items.length === 0 ? 0 : Math.round(items.reduce((s, i) => s + i.progress, 0) / items.length);

  const kpiT1 = avgProgress(tier1Items);
  const kpiT2 = avgProgress(tier2Items);
  const kpiT3 = avgProgress(tier3Items);

  // Tier-2 sub-labels: list each phase's progress
  const tier2SubLabel = tier2Items
    .map((i) => `${i.code}: ${i.progress}%`)
    .join(' • ') || 'Chưa có giai đoạn';

  // Tier-3 on-time rate: items not blocked & deadline-wise OK
  const tier3OnTime = tier3Items.filter((i) => i.status !== 'Đang nghẽn' && i.status !== 'Điểm nghẽn').length;
  const tier3OnTimePct = tier3Items.length === 0 ? 0 : Math.round((tier3OnTime / tier3Items.length) * 100);

  // Bottleneck summary
  const blockedCount = blockedItems.length;
  const firstBlocker = blockedItems[0];

  return (
    <div className="flex flex-col w-full">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Sub Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-xl border border-[#e5eeff] shadow-sm">
          <div>
            <div className="flex items-center gap-1.5 text-[#565e74] text-[11px] font-semibold uppercase tracking-wider mb-1">
              <span>Báo cáo điều hành</span>
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              <span className="text-[#004ac6] font-bold">Tổng quan tiến độ 4 tầng</span>
            </div>
            <h1 className="text-[22px] sm:text-[26px] font-bold text-[#0b1c30] tracking-tight">
              Báo cáo & Phân tích Đa Tầng Q4/2026
            </h1>
            <p className="text-[13px] text-[#434655]">
              Cộng dồn tự động (Auto-Rollup) dữ liệu từ 5 thành viên và 4 tầng quản trị chiến lược.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => window.print()}
              className="px-3.5 py-2 bg-[#eff4ff] hover:bg-[#dce9ff] text-[#0b1c30] text-[13px] font-semibold rounded-lg flex items-center gap-1.5 border border-[#dce9ff] shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">print</span>
              <span>In báo cáo</span>
            </button>
            <button
              onClick={onExport}
              className="px-4 py-2 bg-[#004ac6] hover:bg-[#2563eb] text-white text-[13px] font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span>Xuất PDF / Excel</span>
            </button>
          </div>
        </div>

        {/* Executive Rollup 4-Tier Matrix — tính động từ tierItems */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-[#e5eeff] shadow-sm">
            <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider block mb-1">
              Tầng 1: Dự án chiến lược
            </span>
            <div className="text-[28px] font-bold text-[#0b1c30] tabular-nums">
              {kpiT1}%
            </div>
            <div className="w-full h-2 bg-[#eff4ff] rounded-full overflow-hidden my-2">
              <div className="h-full bg-[#0F172A] rounded-full" style={{ width: `${kpiT1}%` }}></div>
            </div>
            <span className="text-[12px] text-[#565e74]">
              {tier1Items.length} Dự án trọng điểm đang kích hoạt
            </span>
          </div>

          <div className="bg-white p-5 rounded-xl border border-[#e5eeff] shadow-sm">
            <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider block mb-1">
              Tầng 2: Giai đoạn triển khai
            </span>
            <div className="text-[28px] font-bold text-[#004ac6] tabular-nums">
              {kpiT2}%
            </div>
            <div className="w-full h-2 bg-[#eff4ff] rounded-full overflow-hidden my-2">
              <div className="h-full bg-[#004ac6] rounded-full" style={{ width: `${kpiT2}%` }}></div>
            </div>
            <span className="text-[12px] text-[#565e74]">
              {tier2SubLabel}
            </span>
          </div>

          <div className="bg-white p-5 rounded-xl border border-[#e5eeff] shadow-sm">
            <span className="text-[11px] font-bold text-[#565e74] uppercase tracking-wider block mb-1">
              Tầng 3: Gói việc giao
            </span>
            <div className="text-[28px] font-bold text-[#006243] tabular-nums">
              {kpiT3}%
            </div>
            <div className="w-full h-2 bg-[#eff4ff] rounded-full overflow-hidden my-2">
              <div className="h-full bg-[#006243] rounded-full" style={{ width: `${kpiT3}%` }}></div>
            </div>
            <span className="text-[12px] text-[#565e74]">
              {tier3OnTime}/{tier3Items.length} hạng mục đúng hạn ({tier3OnTimePct}%)
            </span>
          </div>

          <div className="bg-white p-5 rounded-xl border border-[#e5eeff] shadow-sm">
            <span
              className={`text-[11px] font-bold uppercase tracking-wider block mb-1 ${
                blockedCount > 0 ? 'text-[#ba1a1a]' : 'text-[#006243]'
              }`}
            >
              Điểm nghẽn Critical Path
            </span>
            <div
              className={`text-[28px] font-bold tabular-nums ${
                blockedCount > 0 ? 'text-[#ba1a1a]' : 'text-[#006243]'
              }`}
            >
              {blockedCount > 0 ? `${blockedCount} Điểm` : 'Thông suốt'}
            </div>
            <div className="w-full h-2 bg-[#eff4ff] rounded-full overflow-hidden my-2">
              <div
                className={`h-full rounded-full ${
                  blockedCount > 0 ? 'bg-[#ba1a1a]' : 'bg-[#006243]'
                }`}
                style={{ width: blockedCount > 0 ? `${Math.min(blockedCount * 25, 100)}%` : '100%' }}
              ></div>
            </div>
            <span
              className={`text-[12px] font-semibold ${
                blockedCount > 0 ? 'text-[#ba1a1a]' : 'text-[#006243]'
              }`}
            >
              {blockedCount > 0
                ? (firstBlocker?.blockerAlert || firstBlocker?.title || 'Xem chi tiết bên dưới')
                : 'Không có điểm nghẽn'}
            </span>
          </div>
        </div>

        {/* Detailed Breakdown Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Table: 4-Tier Items Progress Overview */}
          <div className="bg-white p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-[#0b1c30]">
                Tiến độ chi tiết từng cấp độ
              </h3>
              <span className="text-[12px] text-[#565e74]">
                {completedTierItems}/{tierItems.length} hoàn tất
              </span>
            </div>

            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#e5eeff] text-[#565e74] text-[11px] font-bold uppercase">
                    <th className="pb-2.5">Mã & Hạng mục</th>
                    <th className="pb-2.5">Người làm</th>
                    <th className="pb-2.5 text-center">Tiến độ</th>
                    <th className="pb-2.5 text-right">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {tierItems.map((item) => (
                    <tr key={item.id} className="hover:bg-[#eff4ff]/40 transition-colors">
                      <td className="py-2.5 pr-2">
                        <div className="font-semibold text-[#0b1c30] truncate max-w-[200px]">
                          {item.title}
                        </div>
                        <span className="text-[11px] text-[#565e74] font-mono">
                          {item.code} · {item.tierName}
                        </span>
                      </td>
                      <td className="py-2.5 text-[#0b1c30]">
                        {item.owner.name}
                      </td>
                      <td className="py-2.5 text-center font-mono font-bold">
                        <span
                          className={
                            item.progress === 100
                              ? 'text-[#006243]'
                              : item.blockerAlert
                              ? 'text-amber-700'
                              : 'text-[#004ac6]'
                          }
                        >
                          {item.progress}%
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                            item.progress === 100
                              ? 'bg-emerald-100 text-[#006243]'
                              : item.blockerAlert
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-[#eff4ff] text-[#004ac6]'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Section: Team Workload & Bottleneck Resolution */}
          <div className="bg-white p-5 rounded-xl border border-[#e5eeff] shadow-sm flex flex-col gap-4">
            <h3 className="text-[16px] font-bold text-[#0b1c30]">
              Tải công việc & Điểm nghẽn cần tháo gỡ
            </h3>

            {/* Blocked Items Card */}
            {blockedItems.length > 0 && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                <div className="flex items-center gap-2 text-[#ba1a1a] font-bold text-[13px] mb-1">
                  <span className="material-symbols-outlined text-[18px]">
                    error
                  </span>
                  <span>Cần hành động ngay: {blockedItems.length} hạng mục bị nghẽn</span>
                </div>
                {blockedItems.map((b) => (
                  <p key={b.id} className="text-[12px] text-[#93000a] leading-relaxed mt-1">
                    • <strong>{b.title}</strong>: {b.managementNotes}
                  </p>
                ))}
              </div>
            )}

            {/* Member load bars */}
            <div className="space-y-3 pt-2">
              <div className="text-[12px] font-bold text-[#565e74] uppercase tracking-wider">
                Phân bổ nguồn lực đội ngũ:
              </div>
              {teamMembers.map((member) => (
                <div key={member.id} className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-[#0b1c30]">
                      {member.name} ({member.role})
                    </span>
                    <span
                      className={`font-semibold ${
                        member.needHelp ? 'text-[#ba1a1a]' : 'text-[#006243]'
                      }`}
                    >
                      {member.onTimeRate}
                    </span>
                  </div>
                  <div className="w-full bg-[#eff4ff] rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        member.needHelp ? 'bg-[#ba1a1a]' : 'bg-[#004ac6]'
                      }`}
                      style={{ width: `${member.workloadPercent}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
