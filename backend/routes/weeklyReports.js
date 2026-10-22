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
const STATUSES = ['Hoàn thành', 'Đang làm', 'Chưa bắt đầu', 'Vướng mắc'];

/** Chuẩn hoá rows từ NV (chỉ field của NV). KHÔNG đụng mgr_* — xem preserveMgrFeedback. */
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

/**
 * Giữ lại chỉ đạo của QL khi NV lưu báo cáo.
 *
 * Đây là chốt chặn quan trọng: NV không biết/cẩn thậ về field mgr_comment, nên
 * payload của NV sẽ không có nó. Nếu upsert thẳng rows_json, chỉ đạo của QL sẽ
 * bị xoá mỗi lần NV bấm "Lưu báo cáo". Merge theo `row.id`.
 */
function preserveMgrFeedback(incoming, existingJson) {
  let prev = [];
  try { prev = JSON.parse(existingJson || '[]'); } catch { prev = []; }
  const prevById = new Map(prev.map((r) => [r.id, r]));
  return incoming.map((row) => {
    const old = prevById.get(row.id);
    return {
      ...row,
      mgr_comment: typeof old?.mgr_comment === 'string' ? old.mgr_comment.slice(0, 500) : '',
    };
  });
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
  const row = stmt.getWeeklyReport.get(targetUserId, week);
  if (!row) return res.json({ item: null });
  return res.json({
    item: {
      user_id: row.user_id,
      week_start: row.week_start,
      week_end: row.week_end,
      rows: parseRows(row.rows_json),
      manager_note: row.manager_note ?? '',
      ack_user_id: row.ack_user_id ?? null,
      ack_at: row.ack_at ?? null,
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
  const sanitized = sanitizeRows(body.rows);
  // Giữ phản hồi của QL: NV lưu không được xoá chỉ đạo/nhận xét đã có.
  const existing = stmt.getWeeklyReport.get(req.user.id, week_start);
  const rows = preserveMgrFeedback(sanitized, existing?.rows_json);

  stmt.upsertWeeklyReport.run(
    req.user.id, week_start, week_end, JSON.stringify(rows)
  );
  const saved = stmt.getWeeklyReport.get(req.user.id, week_start);
  return res.json({
    ok: true, week_start, week_end, rows,
    updated_at: saved?.updated_at,
    manager_note: saved?.manager_note ?? null,
    ack_at: saved?.ack_at ?? null,
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
 * GET /api/weekly-reports/team?week=YYYY-MM-DD — P1: tổng hợp phòng ban.
 *
 * Phạm vi = các phòng ban của manager đang đăng nhập (admin/director: tất cả).
 * Trả aggregate per nhân viên, KHÔNG trả rows_json (tránh tải cả phòng ban).
 * Nhân viên chưa lưp tuần này vẫn xuất hiện với row_count = 0 → QL biết ai chưa nộp.
 */
router.get('/team', (req, res) => {
  const week = req.query.week || weekBounds().start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'invalid_week', message: 'week phải YYYY-MM-DD.' });
  }
  if (!['admin', 'director', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ quản lý mới xem tổng hợp phòng ban.' });
  }

  // Khoanh vùng phòng ban theo quyền xem của actor.
  const myDepts = parseDepartments(req.user.departments);
  const deptFilter = myDepts.length
    ? `AND ud.department_code IN (${myDepts.map(() => '?').join(',')})`
    : '';
  const deptArgs = myDepts.length ? myDepts : [];

  // Chỉ lấy nhân viên (không gồm manager/admin/director — tránh lẫn dòng quản lý).
  const rows = db.prepare(`
    SELECT u.id AS user_id, u.username, u.fullname, u.role,
           ud.department_code,
           w.rows_json, w.updated_at, w.ack_at, w.manager_note
      FROM users u
      JOIN user_departments ud ON ud.user_id = u.id
      LEFT JOIN weekly_reports w
             ON w.user_id = u.id AND w.week_start = ?
     WHERE u.is_active = 1 AND u.role = 'employee' ${deptFilter}
     ORDER BY u.fullname
  `).all(week, ...deptArgs);

  // Gộp theo user (1 NV có thể ở nhiều phòng → 1 dòng, departments là mảng).
  const byUser = new Map();
  for (const r of rows) {
    let entry = byUser.get(r.user_id);
    if (!entry) {
      const parsed = parseRows(r.rows_json);
      entry = {
        user_id: r.user_id,
        username: r.username,
        fullname: r.fullname,
        departments: [],
        row_count: parsed.length,
        blocked_count: parsed.filter((x) => x.status === 'Vướng mắc').length,
        updated_at: r.updated_at ?? null,
        submitted: !!r.updated_at,
        ack_at: r.ack_at ?? null,
        has_note: !!r.manager_note,
      };
      byUser.set(r.user_id, entry);
    }
    if (r.department_code && !entry.departments.includes(r.department_code)) {
      entry.departments.push(r.department_code);
    }
  }
  return res.json({ items: [...byUser.values()], week });
});

/**
 * POST /api/weekly-reports/:userId/review — Quản lý phản hồi báo cáo tuần của NV.
 *
 *   body: {
 *     week_start: 'YYYY-MM-DD',
 *     manager_note?: string,                       // Nhận xét chung cho tuần
 *     ack?: true,                                  // Bấm "Xác nhận đã xem"
 *     rows?: [{ id, mgr_comment }]                     // Chỉ đạo theo từng dòng
 *   }
 *
 *   ⚠️ NGUYÊN TẮC AN TOÀN: endpoint này CHỈ ghi các field `mgr_*` + manager_note
 *   + ack_*. Tuyệt đối KHÔNG nhận/ghi đè name/result/status/blocker của NV —
 *   nếu không, 1 thao tác gõ nhầm của QL sẽ xoá dữ liệu báo cáo của nhân viên.
 *   Thực hiện bằng cách merge vào rows_json ĐANG CÓ trong DB, key theo row.id.
 *
 *   Quyền: manager/admin trong cùng phòng ban (canViewReport). Director là
 *   read-only theo thiết kế executive nên không phản hồi được.
 *
 *   Tuần quá khứ vẫn phản hồi được (tra cứu lịch sử cần thêm ngữ cảnh QL).
 */
router.post('/:userId/review', (req, res) => {
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(targetUserId)) {
    return res.status(400).json({ error: 'invalid_user' });
  }
  if (!['manager', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ quản lý mới phản hồi báo cáo.' });
  }
  if (!canViewReport(req.user, targetUserId)) {
    return res.status(403).json({ error: 'forbidden', message: 'Không cùng phòng ban.' });
  }

  const body = req.body || {};
  const week = body.week_start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'invalid_week', message: 'week_start phải YYYY-MM-DD.' });
  }

  const existing = stmt.getWeeklyReport.get(targetUserId, week);
  if (!existing) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Nhân viên chưa lập báo cáo cho tuần này — không có gì để phản hồi.',
    });
  }

  // ── Merge phản hồi theo dòng, giữ nguyên nội dung của NV ──
  let rows = parseRows(existing.rows_json);
  if (Array.isArray(body.rows)) {
    const byId = new Map(
      body.rows
        .filter((r) => r && typeof r === 'object')
        .map((r) => [String(r.id), r])
    );
    rows = rows.map((row) => {
      const patch = byId.get(String(row.id));
      if (!patch) return row;
      return {
        ...row,
        mgr_comment: patch.mgr_comment !== undefined
          ? String(patch.mgr_comment).slice(0, 500)
          : (row.mgr_comment ?? ''),
      };
    });
  }

  const managerNote = body.manager_note !== undefined
    ? String(body.manager_note).slice(0, 2000)
    : (existing.manager_note ?? '');
  const wantAck = body.ack === true;
  const ackUserId = wantAck ? req.user.id : existing.ack_user_id;
  const ackAt = wantAck
    ? new Date().toISOString().replace('T', ' ').slice(0, 19)
    : existing.ack_at;

  stmt.saveWeeklyReportReview.run(
    JSON.stringify(rows),
    managerNote,
    ackUserId,
    ackAt,
    targetUserId,
    week,
  );

  return res.json({
    ok: true,
    rows,
    manager_note: managerNote,
    ack_at: ackAt,
    updated_at: stmt.getWeeklyReport.get(targetUserId, week)?.updated_at ?? null,
  });
});

export default router;
