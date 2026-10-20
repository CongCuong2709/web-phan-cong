// helpRequests.js — DEPRECATED (Phase F: 2026-10, refactored lại ở Phase G: 2026-10)
//
// Phase F xoá bảng `help_requests`; thay bằng `tasks.blocker_note` (1 dòng hiện tại).
// Phase G khôi phục `task_help_messages` (lịch sử 1:N) — xem migration.sql.
//
// Endpoint mới (Phase G, mount qua /api/tasks):
//   GET    /api/tasks/4/:id/help-messages              — list lịch sử
//   POST   /api/tasks/4/:id/blocker                    — append + update blocker_note
//   POST   /api/tasks/4/:id/help-messages/:msgId/resolve — manager đánh dấu đã xử lý
//
// File này KHÔNG còn được mount trong server.js. Giữ lại cho tới 2027-04-01
// làm "safety net" nếu frontend cũ còn gọi /api/help-requests. Sau thời hạn
// đó, xoá file + import + route alias trong server.js (nếu có).
//
// Hiện tại mọi method trên /api/help-requests* trả 410 Gone.
import { Router } from 'express';

const router = Router();

router.all('*', (_req, res) => res.status(410).json({
  error: 'gone',
  message: 'help_requests endpoint removed in Phase F. Use /api/tasks/4/:id/help-messages (Phase G) hoặc /api/tasks/4/:id/blocker (Phase F) cho lịch sử escalation.',
  removed_at: '2026-10-15',
  removal_deadline: '2027-04-01',
}));

export default router;
