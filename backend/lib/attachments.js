/**
 * lib/attachments.js — Lưu trữ tệp đính kèm trên ổ đĩa máy chủ.
 *
 * - Thư mục: UPLOAD_DIR (env) hoặc backend/uploads. Không phục vụ tĩnh; chỉ tải qua
 *   endpoint có kiểm tra quyền (routes/attachments.js).
 * - Tên lưu là UUID ngẫu nhiên + đuôi đã kiểm tra; tên gốc chỉ nằm trong DB.
 * - Chấp nhận ảnh, PDF, Word, Excel, PowerPoint (.pptx). Kiểm tra cả đuôi lẫn
 *   chữ ký đầu tệp (magic bytes) để đuôi giả không lọt qua.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx / xlsx / pptx (Office Open XML)
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // doc / xls (Office 97-2003)

/** Đuôi được phép → MIME trả về khi tải + chữ ký đầu tệp. */
const TYPES = {
  jpg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  jpeg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  gif: { mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  webp: { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46], magicAt8: [0x57, 0x45, 0x42, 0x50] },
  pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  doc: { mime: 'application/msword', magic: OLE },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: ZIP },
  xls: { mime: 'application/vnd.ms-excel', magic: OLE },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: ZIP },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: ZIP },
};

const startsWith = (buf, bytes, offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

/** Tên gốc an toàn để lưu DB / gửi lại khi tải: bỏ đường dẫn, ký tự điều khiển, giới hạn độ dài. */
export function cleanFileName(name) {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return base.slice(-200);
}

/**
 * Kiểm tra tệp tải lên. Trả `{ ok: true, ext, mime }` hoặc `{ ok: false, error, message }`.
 */
export function checkUpload(fileName, buf) {
  if (!fileName) return { ok: false, error: 'file_name_required', message: 'Thiếu tên tệp.' };
  if (!buf?.length) return { ok: false, error: 'empty_file', message: 'Tệp rỗng.' };
  if (buf.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'file_too_large', message: 'Tệp vượt quá 25 MB.' };
  }
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const type = TYPES[ext];
  if (!type) {
    return {
      ok: false,
      error: 'file_type_not_allowed',
      message: 'Chỉ nhận ảnh (JPG, PNG, GIF, WEBP), PDF, Word (.doc, .docx), Excel (.xls, .xlsx), PowerPoint (.pptx).',
    };
  }
  if (!startsWith(buf, type.magic) || (type.magicAt8 && !startsWith(buf, type.magicAt8, 8))) {
    return { ok: false, error: 'file_content_mismatch', message: `Nội dung tệp không đúng định dạng .${ext}.` };
  }
  return { ok: true, ext, mime: type.mime };
}

/** Ghi tệp vào UPLOAD_DIR, trả tên lưu ngẫu nhiên. */
export function storeFile(buf, ext) {
  const storedName = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf, { flag: 'wx' });
  return storedName;
}

/** Đường dẫn tuyệt đối của 1 tệp đã lưu (chặn mọi tên có thành phần thư mục). */
export function storedPath(storedName) {
  return path.join(UPLOAD_DIR, path.basename(storedName));
}

/** Xoá tệp trên đĩa; tệp đã mất thì bỏ qua (dữ liệu DB mới là nguồn chính). */
export function removeStoredFiles(storedNames) {
  for (const name of storedNames) {
    try {
      fs.unlinkSync(storedPath(name));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[attachments] Không xoá được tệp', name, err.message);
    }
  }
}

/** Tên lưu của mọi tệp thuộc mục (và các mục con) — gọi TRƯỚC khi xoá CASCADE. */
const TASKS_UNDER = {
  4: 'SELECT ?1 AS id',
  3: 'SELECT id FROM tasks WHERE bundle_id = ?1',
  2: 'SELECT t.id FROM tasks t JOIN bundles b ON b.id = t.bundle_id WHERE b.phase_id = ?1',
  1: `SELECT t.id FROM tasks t JOIN bundles b ON b.id = t.bundle_id
        JOIN phases ph ON ph.id = b.phase_id WHERE ph.project_id = ?1`,
};
const BUNDLES_UNDER = {
  3: 'SELECT ?1 AS id',
  2: 'SELECT id FROM bundles WHERE phase_id = ?1',
  1: 'SELECT b.id FROM bundles b JOIN phases ph ON ph.id = b.phase_id WHERE ph.project_id = ?1',
};
const PHASES_UNDER = { 2: 'SELECT ?1 AS id', 1: 'SELECT id FROM phases WHERE project_id = ?1' };
const STORED_UNDER = Object.fromEntries([1, 2, 3, 4].map((tier) => [tier, [
  `SELECT stored_name FROM task_attachments WHERE task_id IN (${TASKS_UNDER[tier]})`,
  BUNDLES_UNDER[tier] && `SELECT stored_name FROM task_attachments WHERE bundle_id IN (${BUNDLES_UNDER[tier]})`,
  PHASES_UNDER[tier] && `SELECT stored_name FROM task_attachments WHERE phase_id IN (${PHASES_UNDER[tier]})`,
  tier === 1 && 'SELECT stored_name FROM task_attachments WHERE project_id = ?1',
].filter(Boolean).join(' UNION ALL ')]));
export function storedNamesUnder(tier, id) {
  return db.prepare(STORED_UNDER[Number(tier)]).all(Number(id)).map((r) => r.stored_name);
}
