import React from 'react';
import { TeamLeadTask } from '../types';

interface DeliverablePreviewModalProps {
  task: TeamLeadTask | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (taskId: string) => void;
}

export const DeliverablePreviewModal: React.FC<DeliverablePreviewModalProps> = ({
  task,
  isOpen,
  onClose,
  onApprove,
}) => {
  if (!isOpen || !task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl border border-[#e5eeff] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 bg-[#eff4ff] flex items-center justify-between border-b border-[#dce9ff]">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#004ac6] text-[22px]">
              {task.deliverableType === 'pdf'
                ? 'picture_as_pdf'
                : task.deliverableType === 'spreadsheet'
                ? 'table_chart'
                : 'description'}
            </span>
            <div>
              <div className="text-[12px] font-bold text-[#004ac6]">
                Xác thực kết quả bàn giao ({task.code})
              </div>
              <h3 className="text-[16px] font-bold text-[#0b1c30]">
                {task.title}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#565e74] hover:bg-[#dce9ff]"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Modal Body: Document Preview Simulator */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#f8f9ff]">
          {/* Metadata bar */}
          <div className="p-3 bg-white rounded-lg border border-[#e5eeff] flex items-center justify-between text-[12px]">
            <div>
              Người nộp: <strong className="text-[#0b1c30]">{task.ownerName}</strong>
            </div>
            <div>
              Thời điểm nộp: <strong className="text-[#006243]">{task.submittedAt}</strong>
            </div>
          </div>

          {/* Document Content Box */}
          <div className="bg-white rounded-xl p-5 border border-[#e5eeff] shadow-sm space-y-3 font-sans">
            <div className="flex items-center justify-between border-b border-[#eff4ff] pb-3">
              <span className="font-mono text-[13px] font-bold text-[#004ac6]">
                {task.fileName || 'tai-lieu-ban-giao.pdf'}
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-[#006243] border border-emerald-200">
                Đã kiểm tra tính toàn vẹn
              </span>
            </div>

            <p className="text-[13px] text-[#434655] leading-relaxed">
              {task.deliverableText}
            </p>

            {/* Simulated document visual preview */}
            <div className="p-4 bg-[#eff4ff] rounded-lg border border-dashed border-[#c3c6d7] space-y-2 text-[12px] text-[#565e74]">
              <div className="flex items-center justify-between font-bold text-[#0b1c30]">
                <span>TÓM TẮT XÁC THỰC THỰC TẾ:</span>
                <span className="text-[#006243]">HỢP LỆ VÀ ĐẦY ĐỦ</span>
              </div>
              <ul className="list-disc pl-5 space-y-1">
                <li>Chữ ký người có thẩm quyền: Đã có chữ ký 2 bên.</li>
                <li>Phụ lục hợp đồng đính kèm: Đầy đủ các điều khoản điện nước và hạ tầng.</li>
                <li>Thời gian hiệu lực: Bắt đầu từ 15/10/2026 đến 15/10/2028.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 bg-[#eff4ff] border-t border-[#dce9ff] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-[#c3c6d7] text-[#0b1c30] rounded-lg text-[13px] font-semibold hover:bg-[#f8f9ff]"
          >
            Đóng
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onApprove(task.id);
                onClose();
              }}
              className="px-5 py-2 bg-[#006243] hover:bg-[#007d57] text-white rounded-lg text-[13px] font-bold shadow-sm flex items-center gap-1.5 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">check</span>
              <span>Duyệt đạt nghiệm thu</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
