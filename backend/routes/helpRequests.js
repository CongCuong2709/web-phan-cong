// helpRequests.js — DEPRECATED (Phase F: 2026-10)
//
// Bảng `help_requests` đã bị xoá khỏi schema. Tính năng escalation giờ chỉ
// còn là 1 cột `tasks.blocker_note` (NV ghi 1 dòng text, manager xem khi mở task).
// Endpoint mới: POST /api/tasks/4/:id/blocker { note }.
import { Router } from 'express';

const router = Router();

router.all('*', (_req, res) => res.status(410).json({
  error: 'gone',
  message: 'help_requests endpoint removed in Phase F. Use POST /api/tasks/4/:id/blocker.',
}));

export default router;
