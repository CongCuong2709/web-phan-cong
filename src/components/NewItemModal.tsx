import React, { useState, useEffect } from 'react';
import { TierItem, TierLevel, User } from '../types';

interface NewItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddItem: (item: Partial<TierItem>) => void;
  parents: { id: string; title: string; tier: TierLevel }[];
  currentUser: User;
  /** Danh sách users cùng phòng ban (dùng cho dropdown owner) */
  deptUsers?: { username: string; fullname: string }[];
}

export const NewItemModal: React.FC<NewItemModalProps> = ({
  isOpen,
  onClose,
  onAddItem,
  parents,
  currentUser,
  deptUsers = [],
}) => {
  // Xác định tầng được phép tạo theo nghiệp vụ:
  // Admin = tất cả | Director (BGĐ) = T1 Dự án + T2 Giai đoạn
  // Manager (TP) = T3 Hạng mục + T4 Đầu việc | Employee = T4 đầu việc
  const allowedTiers: TierLevel[] =
    currentUser.role === 'admin'
      ? [1, 2, 3, 4]
      : currentUser.role === 'director'
      ? [1, 2]
      : currentUser.role === 'manager'
      ? [3, 4]
      : [4];

  const defaultTier = allowedTiers[allowedTiers.length - 1]; // lowest allowed

  const [tier, setTier] = useState<TierLevel>(defaultTier);
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [ownerUsername, setOwnerUsername] = useState(currentUser.username);
  // MI-03: default 30 ngày tới, format ISO YYYY-MM-DD để native date picker hoạt động.
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TierItem['priority']>('Trung bình');

  // A11 fix: reset toàn bộ form state mỗi khi modal đóng/mở.
  // Trước đây modal đóng → state giữ nguyên → lần mở sau hiển thị tier cũ,
  // dễ chọn nhầm tier (vd: BGĐ từng tạo T1, mở lại modal mà quên chọn lại).
  useEffect(() => {
    if (isOpen) {
      setTier(defaultTier);
      setTitle('');
      setParentId('');
      setOwnerUsername(currentUser.username);
      setDeadline(() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      setDescription('');
      setPriority('Trung bình');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    // Resolve owner from selected username
    const ownerUser = deptUsers.find((u) => u.username === ownerUsername) ??
      { username: currentUser.username, fullname: currentUser.fullname };

    const tierName =
      tier === 1 ? 'Tầng 1: Dự án'
      : tier === 2 ? 'Tầng 2: Giai đoạn'
      : tier === 3 ? 'Tầng 3: Hạng mục giao'
      : 'Tầng 4: Đầu việc';

    const tierBadge =
      tier === 1 ? 'DỰ ÁN T1'
      : tier === 2 ? 'GIAI ĐOẠN T2'
      : tier === 3 ? 'HẠNG MỤC T3'
      : 'VIỆC T4';

    const code =
      tier === 1 ? `DA-${Math.floor(100 + Math.random() * 900)}`
      : tier === 2 ? `GD-${Math.floor(10 + Math.random() * 90)}`
      : tier === 3 ? `GOI-${Math.floor(10 + Math.random() * 90)}`
      : `NV-${Math.floor(100 + Math.random() * 900)}`;

    onAddItem({
      code,
      tier,
      tierName,
      tierBadge,
      title,
      parentId: tier > 1 ? parentId : undefined,
      owner: {
        name: ownerUser.fullname,
        role: 'Phụ trách thực thi',
        initial: ownerUser.fullname.charAt(0),
      },
      ownerUsername: ownerUser.username,
      department: currentUser.departments[0],
      deadline,
      progress: 0,
      status: 'Chuẩn bị',
      priority,
      description,
      deliverables: [{ id: `del-${Date.now()}`, title: 'Hoàn tất bàn giao', completed: false }],
      managementNotes: `Mới tạo bởi ${currentUser.fullname}, đang chờ phân bổ chi tiết.`,
      gantt: {
        startWeek: 2,
        endWeek: 3.5,
        barColor: tier === 1 ? '#0F172A' : tier === 2 ? '#004ac6' : tier === 3 ? '#0284c7' : '#006243',
      },
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-[#e5eeff] overflow-hidden flex flex-col animate-scaleUp">
        <div className="p-4 bg-[#eff4ff] flex items-center justify-between border-b border-[#dce9ff]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#004ac6] text-[22px]">
              add_task
            </span>
            <h4 className="text-[17px] font-bold text-[#0b1c30]">
              Thêm công việc mới
            </h4>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#565e74] hover:bg-[#dce9ff] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {/* Tier Selection — filtered by role */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-bold text-[#0b1c30]">
              Chọn cấp tầng quản lý *
            </label>
            <div className={`grid gap-1.5 p-1 bg-[#eff4ff] rounded-lg grid-cols-${allowedTiers.length}`}>
              {([
                { lvl: 1 as TierLevel, label: 'Dự án', code: 'T1' },
                { lvl: 2 as TierLevel, label: 'Giai đoạn', code: 'T2' },
                { lvl: 3 as TierLevel, label: 'Hạng mục', code: 'T3' },
                { lvl: 4 as TierLevel, label: 'Đầu việc', code: 'T4' },
              ]).filter((opt) => allowedTiers.includes(opt.lvl)).map((opt) => (
                <button
                  key={opt.lvl}
                  type="button"
                  onClick={() => setTier(opt.lvl)}
                  title={`${opt.code} – ${opt.label}`}
                  className={`py-1.5 px-1 text-[11px] font-bold rounded transition-colors flex flex-col items-center leading-tight ${
                    tier === opt.lvl
                      ? 'bg-white text-[#004ac6] shadow-sm'
                      : 'text-[#565e74] hover:text-[#0b1c30]'
                  }`}
                >
                  <span className="text-[9px] opacity-70">{opt.code}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            </div>

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-bold text-[#0b1c30]">
              Tên công việc / Hạng mục *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ví dụ: Triển khai kiểm thử bảo mật..."
              className="w-full h-10 px-3 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
            />
          </div>

          {/* Parent selection if tier > 1 */}
          {tier > 1 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-[#0b1c30]">
                Thuộc mục cấp trên (Tầng {tier - 1})
              </label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
              >
                <option value="">-- Chọn mục cha --</option>
                {parents
                  .filter((p) => p.tier === tier - 1)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Owner & Deadline */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-[#0b1c30]">
                Người phụ trách
              </label>
              {deptUsers.length > 1 ? (
                <select
                  value={ownerUsername}
                  onChange={(e) => setOwnerUsername(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
                >
                  {deptUsers.map((u) => (
                    <option key={u.username} value={u.username}>{u.fullname}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={currentUser.fullname}
                  readOnly
                  className="w-full h-10 px-3 rounded-lg bg-[#f0f0f0] text-[#565e74] text-[13px] border border-[#dce9ff] cursor-not-allowed"
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-[#0b1c30]">
                Hạn hoàn thành
              </label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
              />
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-bold text-[#0b1c30]">
              Mô tả & Phạm vi
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mục tiêu bàn giao chính..."
              className="w-full p-2.5 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#eff4ff]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[#565e74] hover:bg-[#eff4ff] rounded-lg text-[13px] font-semibold"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#004ac6] hover:bg-[#2563eb] text-white text-[13px] font-bold rounded-lg shadow-sm"
            >
              Lưu công việc
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};