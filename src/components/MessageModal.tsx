import React, { useState } from 'react';

interface MessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetName: string;
  taskTitle: string;
  onSend: (message: string) => void;
}

export const MessageModal: React.FC<MessageModalProps> = ({
  isOpen,
  onClose,
  targetName,
  taskTitle,
  onSend,
}) => {
  const [msg, setMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msg.trim()) return;
    onSend(msg);
    setMsg('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-[#e5eeff] overflow-hidden flex flex-col">
        <div className="p-4 bg-[#eff4ff] flex items-center justify-between border-b border-[#dce9ff]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#004ac6] text-[20px]">
              chat
            </span>
            <h4 className="text-[15px] font-bold text-[#0b1c30]">
              Nhắn tin cho {targetName}
            </h4>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded flex items-center justify-center text-[#565e74] hover:bg-[#dce9ff]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          <div className="text-[12px] text-[#565e74]">
            Về công việc: <strong className="text-[#0b1c30]">{taskTitle}</strong>
          </div>

          <textarea
            required
            rows={3}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder={`Gửi hướng dẫn hoặc phản hồi nhanh cho ${targetName}...`}
            className="w-full p-2.5 rounded-lg bg-[#eff4ff] text-[#0b1c30] text-[13px] border border-[#dce9ff] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#004ac6]"
          />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#eff4ff]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-[#565e74] hover:bg-[#eff4ff] rounded-lg text-[12px] font-semibold"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-[#004ac6] hover:bg-[#2563eb] text-white rounded-lg text-[12px] font-bold shadow-sm"
            >
              Gửi tin nhắn
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
