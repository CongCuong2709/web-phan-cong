/**
 * routes/weeklyReports.js — Báo cáo tuần cho nhân viên.
 *
 * YAGNI/Ponytail: 1 bảng `weekly_reports` (xem migration.sql) + 3 endpoints:
 *   GET    /api/weekly-reports?week=YYYY-MM-DD   — Lấy 1 report (của mình hoặc của NV mình quản lý)
 *   PUT    /api/weekly-reports                    — Upsert report (auto-save)
 *
 * Tuần tính theo ISO week (thứ 2 → CN). FE truyền `?week=YYYY-MM-DD` (tuần start).
 * Không cần `week_end` vì có thể derive từ `week` + 6 ngày, nhưng vẫn lưu để
 * debug/admin nhìn nhanh.
 *
 * Phân quyền:
 *   - Employee: chỉ đọc/ghi report của chính mình.
 *   - Manager:  đọc report của NV cùng phòng ban (admin/director: read-all).
 *   - Không cần duyệt (theo PRD: vận hành bằng niềm tin nội bộ).
 */

import { Router } from 'express';
import { db, stmt } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { inDepartment, parseDepartments } from '../lib/policies.js';

const router = Router();
router.use(requireAuth);

/** Ngày thứ 2 của tuần chứa `d` (YYYY-MM-DD local). Chuẩn ISO: Mon=0..Sun=6. */
function weekBounds(d = new Date()) {
  const dt = new Date(d);
  // getDay(): 0=Sun..6=Sat. Đổi sang ISO Mon..Sun.
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const start = `${yyyy}-${mm}-${dd}`;
  const end = new Date(dt);
  end.setDate(end.getDate() + 6);
  const ey = end.getFullYear();
  const em = String(end.getMonth() + 1).padStart(2, '0');
  const ed = String(end.getDate()).padStart(2, '0');
  return { start, end: `${ey}-${em}-${ed}` };
}

/** Validate rows JSON — chỉ giữ shape tối thiểu, không cần strict zod. */
function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => ({
      id: typeof r.id === 'string' ? r.id : `r-${i}`,
      name: String(r.name ?? '').slice(0, 200),
      result: String(r.result ?? '').slice(0, 500),
      status: ['Hoàn thành', 'Đang làm', 'Chưa bắt đầu', 'Vướng mắc'].includes(r.status)
        ? r.status : 'Chưa bắt đầu',
      blocker: String(r.blocker ?? '').slice(0, 500),
    }));
}

/** Check user X có quyền xem report của user Y không (mirror policies.js). */
function canViewReport(actor, targetUserId) {
  if (actor.role === 'admin' || actor.role === 'director') return true;
  if (actor.id === Number(targetUserId)) return true;
  if (actor.role === 'manager') {
    // Manager chỉ xem NV cùng phòng ban (bất kỳ phòng nào của actor overlap).
    const targetDepts = parseDepartments(
      db.prepare(
        `SELECT (SELECT GROUP_CONCAT(department_code, ',') FROM user_departments WHERE user_id = ?) AS d`
      ).get(targetUserId)?.d
    );
    return targetDepts.some((d) => inDepartment(actor, d));
  }
  return false;
}

/**
 * GET /api/weekly-reports?week=YYYY-MM-DD&user=<id?>
 *   - Không có `user`: trả report của chính actor (mặc định tuần hiện tại).
 *   - Có `user`: actor phải là admin/director/manager cùng phòng → trả report của NV đó.
 *   - 404 nếu chưa có report (FE hiểu = bảng trống, không phải lỗi).
 */
router.get('/', (req, res) => {
  const week = req.query.week || weekBounds().start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'invalid_week', message: 'week phải YYYY-MM-DD.' });
  }
  const targetUserId = req.query.user ? Number(req.query.user) : req.user.id;
  if (!canViewReport(req.user, targetUserId)) {
    return res.status(403).json({ error: 'forbidden', message: 'Không có quyền xem report này.' });
  }
  const row = db.prepare(
    'SELECT user_id, week_start, week_end, rows_json, updated_at FROM weekly_reports WHERE user_id = ? AND week_start = ?'
  ).get(targetUserId, week);
  if (!row) return res.json({ item: null });
  // Trả rows_json đã parse cho FE khỏi JSON.parse lại.
  let rows = [];
  try { rows = JSON.parse(row.rows_json); } catch { /* empty array */ }
  return res.json({
    item: {
      user_id: row.user_id,
      week_start: row.week_start,
      week_end: row.week_end,
      rows,
      updated_at: row.updated_at,
    },
    weekBounds: weekBounds(), // hint FE để render nav đúng tuần hiện tại
  });
});

/**
 * PUT /api/weekly-reports — Upsert report của chính actor.
 *   Body: { week_start: 'YYYY-MM-DD', rows: [...], week_end?: 'YYYY-MM-DD' }
 *   Auto-save: mỗi lần gõ → FE debounce 1s → gọi PUT.
 *   Conflict: chỉ upsert nếu tuần hiện tại (PRD: hết tuần thì UI đóng).
 *   Đơn giản hoá: không check week phải "now" — cho phép sửa tuần quá khứ nếu FE
 *   cho phép. PRD nói "chỉnh sửa miễn là trong tuần" → enforce tuần ≤ tuần hiện tại
 *   (không cho edit tuần tương lai).
 */
router.put('/', (req, res) => {
  const body = req.body || {};
  const week_start = body.week_start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
    return res.status(400).json({ error: 'invalid_week', message: 'week_start phải YYYY-MM-DD.' });
  }
  const { end: currentEnd } = weekBounds();
  if (week_start > currentEnd) {
    return res.status(400).json({ error: 'future_week', message: 'Không thể sửa báo cáo tuần tương lai.' });
  }
  const week_end = body.week_end || (() => {
    const d = new Date(week_start);
    d.setDate(d.getDate() + 6);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  })();
  const rows = sanitizeRows(body.rows);

  stmt.upsertWeeklyReport.run(
    req.user.id, week_start, week_end, JSON.stringify(rows)
  );
  const row = db.prepare(
    'SELECT updated_at FROM weekly_reports WHERE user_id = ? AND week_start = ?'
  ).get(req.user.id, week_start);
  return res.json({ ok: true, week_start, week_end, rows, updated_at: row?.updated_at });
});

export default router;
