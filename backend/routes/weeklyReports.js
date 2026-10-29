/**
 * routes/weeklyReports.js — Báo cáo tuần của Nhân viên và Trưởng phòng.
 *
 * 1 bảng `weekly_reports` (rows lưu JSON):
 *   GET    /api/weekly-reports?week=YYYY-MM-DD[&user=<id>] — 1 báo cáo (của mình hoặc người mình được xem)
 *   PUT    /api/weekly-reports                              — Lưu báo cáo tuần hiện tại của chính mình
 *   GET    /api/weekly-reports/history                      — Các tuần đã có dữ liệu của chính mình
 *   GET    /api/weekly-reports/team?week=YYYY-MM-DD         — Tổng hợp người viết trong phạm vi được xem
 *
 * Tuần tính theo ISO week (thứ 2 → CN). Không có bước duyệt hay phản hồi:
 * công ty vận hành bằng niềm tin. Quyền: `weekly_report:write` / `weekly_report:read`
 * ở lib/policies.js (HĐQT, Điều hành xem tất cả; Trưởng phòng xem người trong phòng mình).
 */

import { Router } from 'express';
import { db, stmt } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize, headOf, isHead } from '../lib/policies.js';

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
const STATUSES = ['Hoàn thành', 'Đang làm', 'Chưa bắt đầu', 'Vướng mắc'];

/** Chuẩn hoá rows người viết gửi lên. */
function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => ({
      id: typeof r.id === 'string' ? r.id : `r-${i}`,
      name: String(r.name ?? '').slice(0, 200),
      result: String(r.result ?? '').slice(0, 500),
      status: STATUSES.includes(r.status) ? r.status : 'Chưa bắt đầu',
      blocker: String(r.blocker ?? '').slice(0, 500),
    }));
}

/** Row parse an toàn từ rows_json. */
function parseRows(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Phòng ban của 1 user (để kiểm tra quyền xem báo cáo). */
function departmentsOf(userId) {
  return stmt.getUserDepartments.all(Number(userId)).map((d) => d.department_code);
}

/**
 * GET /api/weekly-reports?week=YYYY-MM-DD&user=<id?>
 *   - Không có `user`: trả report của chính actor (mặc định tuần hiện tại).
 *   - Có `user`: cần `weekly_report:read` với người đó.
 *   - 404 nếu chưa có report (FE hiểu = bảng trống, không phải lỗi).
 */
router.get('/', (req, res) => {
  const week = req.query.week || weekBounds().start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'invalid_week', message: 'week phải YYYY-MM-DD.' });
  }
  const targetUserId = req.query.user ? Number(req.query.user) : req.user.id;
  const authz = authorize('weekly_report:read', req.user, { targetUserId, targetDepts: departmentsOf(targetUserId) });
  if (!authz.ok) return res.status(authz.status).json(authz);
  const row = stmt.getWeeklyReport.get(targetUserId, week);
  if (!row) return res.json({ item: null });
  return res.json({
    item: {
      user_id: row.user_id,
      week_start: row.week_start,
      week_end: row.week_end,
      rows: parseRows(row.rows_json),
      updated_at: row.updated_at,
    },
    weekBounds: weekBounds(), // hint FE để render nav đúng tuần hiện tại
  });
});

/**
 * PUT /api/weekly-reports — Upsert report của chính actor.
 *   Body: { week_start: 'YYYY-MM-DD', rows: [...], week_end?: 'YYYY-MM-DD' }
 *   Lưu thủ công (FE bấm nút "Lưu báo cáo"), không auto-save.
 *
 *   Quy tắc tuần (chốt 2026-10-22): CHỈ tuần hiện tại mới sửa được.
 *   - Tuần tương lai → 400 future_week.
 *   - Tuần quá khứ  → 400 read_only (PRD: "chỉnh sửa miễn là trong tuần",
 *     qua tuần thì chỉ đọc để tra cứu lịch sử).
 */
router.put('/', (req, res) => {
  const authz = authorize('weekly_report:write', req.user, {});
  if (!authz.ok) return res.status(authz.status).json(authz);
  const body = req.body || {};
  const week_start = body.week_start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
    return res.status(400).json({ error: 'invalid_week', message: 'week_start phải YYYY-MM-DD.' });
  }
  const current = weekBounds().start;
  if (week_start > current) {
    return res.status(400).json({ error: 'future_week', message: 'Không thể lưu báo cáo tuần tương lai.' });
  }
  if (week_start < current) {
    return res.status(400).json({ error: 'read_only', message: 'Tuần đã kết thúc — chỉ đọc, không lưu được.' });
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
  const saved = stmt.getWeeklyReport.get(req.user.id, week_start);
  return res.json({
    ok: true, week_start, week_end, rows,
    updated_at: saved?.updated_at,
  });
});

/**
 * GET /api/weekly-reports/history?limit=26 — P0: lịch sử tuần của chính actor.
 *
 * Chỉ trả tuần THỰC SỰ có dữ liệu (rows_json != '[]'). Tuần trống không xuất
 * hiện trong popover → tránh dữ liệu giả trong lịch sử.
 * row_count / blocked_count tính ở JS từ rows_json (SQLite không có json_array_length
 * trong build của node:sqlite — tránh phụ thuộc extension JSON1).
 */
router.get('/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 26, 52);
  const rows = db.prepare(
    `SELECT week_start, week_end, rows_json, updated_at
       FROM weekly_reports
      WHERE user_id = ? AND rows_json != '[]'
      ORDER BY week_start DESC
      LIMIT ?`
  ).all(req.user.id, limit);
  const items = rows.map((r) => {
    let parsed = [];
    try { parsed = JSON.parse(r.rows_json); } catch { parsed = []; }
    return {
      week_start: r.week_start,
      week_end: r.week_end,
      row_count: parsed.length,
      blocked_count: parsed.filter((x) => x.status === 'Vướng mắc').length,
      updated_at: r.updated_at,
    };
  });
  return res.json({ items });
});

/**
 * GET /api/weekly-reports/team?week=YYYY-MM-DD — Tổng hợp những người viết báo cáo tuần
 * (Nhân viên + Trưởng phòng) trong phạm vi được xem.
 *
 * Phạm vi: Trưởng phòng = các phòng mình làm trưởng; HĐQT, Điều hành, admin = toàn công ty.
 * Trả số liệu theo người, KHÔNG trả rows_json. Người chưa lưu tuần này vẫn có mặt
 * với submitted = false → biết ai chưa viết.
 */
router.get('/team', (req, res) => {
  const week = req.query.week || weekBounds().start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'invalid_week', message: 'week phải YYYY-MM-DD.' });
  }
  if (req.user.role === 'employee' && !isHead(req.user)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ Trưởng phòng, Điều hành, HĐQT xem tổng hợp.' });
  }

  const myDepts = req.user.role === 'employee' ? headOf(req.user) : [];
  const deptFilter = myDepts.length
    ? `AND ud.department_code IN (${myDepts.map(() => '?').join(',')})`
    : '';

  const rows = db.prepare(`
    SELECT u.id AS user_id, u.username, u.fullname,
           ud.department_code, ud.is_head,
           w.rows_json, w.updated_at
      FROM users u
      JOIN user_departments ud ON ud.user_id = u.id
      LEFT JOIN weekly_reports w
             ON w.user_id = u.id AND w.week_start = ?
     WHERE u.is_active = 1 AND u.role = 'employee' ${deptFilter}
     ORDER BY ud.is_head DESC, u.fullname
  `).all(week, ...myDepts);

  // Gộp theo user (1 người có thể ở nhiều phòng → 1 dòng, departments là mảng).
  const byUser = new Map();
  for (const r of rows) {
    let entry = byUser.get(r.user_id);
    if (!entry) {
      const parsed = parseRows(r.rows_json);
      entry = {
        user_id: r.user_id,
        username: r.username,
        fullname: r.fullname,
        is_head: false,
        departments: [],
        row_count: parsed.length,
        blocked_count: parsed.filter((x) => x.status === 'Vướng mắc').length,
        updated_at: r.updated_at ?? null,
        submitted: !!r.updated_at,
      };
      byUser.set(r.user_id, entry);
    }
    if (r.department_code && !entry.departments.includes(r.department_code)) {
      entry.departments.push(r.department_code);
    }
    if (r.is_head) entry.is_head = true;
  }
  return res.json({ items: [...byUser.values()], week });
});

export default router;
