import React, { useState } from 'react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (type: 'pdf' | 'excel') => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'pdf' | 'excel'>('pdf');
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleExport = () => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      onSuccess(selectedFormat);
      onClose();
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-[#e5eeff] overflow-hidden flex flex-col">
        <div className="p-4 bg-[#eff4ff] flex items-center justify-between border-b border-[#dce9ff]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#004ac6] text-[20px]">
              download
            </span>
            <h4 className="text-[15px] font-bold text-[#0b1c30]">
              Xuất dữ liệu tiến độ điều hành
            </h4>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded flex items-center justify-center text-[#565e74] hover:bg-[#dce9ff]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="text-[13px] text-[#434655]">
            Chọn định dạng xuất báo cáo:
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div
              onClick={() => setSelectedFormat('pdf')}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col items-center text-center gap-2 ${
                selectedFormat === 'pdf'
                  ? 'border-[#004ac6] bg-[#eff4ff] ring-2 ring-[#004ac6]'
                  : 'border-[#e5eeff] hover:bg-[#f8f9ff]'
              }`}
            >
              <span className="material-symbols-outlined text-[28px] text-[#ba1a1a]">
                picture_as_pdf
              </span>
              <div>
                <div className="text-[13px] font-bold text-[#0b1c30]">Báo cáo PDF</div>
                <div className="text-[11px] text-[#565e74]">
                  Bản in đồ họa
                </div>
              </div>
            </div>

            <div
              onClick={() => setSelectedFormat('excel')}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col items-center text-center gap-2 ${
                selectedFormat === 'excel'
                  ? 'border-[#006243] bg-emerald-50 ring-2 ring-[#006243]'
                  : 'border-[#e5eeff] hover:bg-[#f8f9ff]'
              }`}
            >
              <span className="material-symbols-outlined text-[28px] text-[#006243]">
                table_view
              </span>
              <div>
                <div className="text-[13px] font-bold text-[#0b1c30]">Bảng tính Excel</div>
                <div className="text-[11px] text-[#565e74]">
                  Dữ liệu chi tiết
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#eff4ff]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-[#565e74] hover:bg-[#eff4ff] rounded-lg text-[12px] font-semibold"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={isExporting}
              onClick={handleExport}
              className="px-4 py-2 bg-[#004ac6] hover:bg-[#2563eb] text-white rounded-lg text-[13px] font-bold shadow-sm flex items-center gap-1.5"
            >
              {isExporting ? (
                <>
                  <span className="material-symbols-outlined text-[16px] animate-spin">
                    progress_activity
                  </span>
                  <span>Đang kết xuất...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">
                    file_download
                  </span>
                  <span>Tải tệp ngay</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
