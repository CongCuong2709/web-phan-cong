/**
 * routes/attachments.js — Tệp đính kèm của mọi tầng (lưu nội bộ, xem lib/attachments.js).
 *
 * Mount tại /api:
 *   GET    /api/tasks/:tier/:id/attachments  — Mọi tệp của mục (với đầu việc: cả tệp trong tin trao đổi, có message_id)
 *   POST   /api/tasks/:tier/:id/attachments?name=<tên tệp>[&message_id=<id>]
 *            Body = nội dung tệp (raw, mỗi request 1 tệp, tối đa 25 MB).
 *            Không có message_id → tệp khi tạo / giao việc (`task:attach`).
 *            Có message_id (chỉ đầu việc) → gắn vào tin trao đổi chính mình vừa gửi (trong 10 phút).
 *   GET    /api/attachments/:id          — Tải xuống (Content-Disposition: attachment)
 *   DELETE /api/attachments/:id          — Xoá tệp (người tải lên hoặc admin, và có `task:attach`).
 *            Tệp trong tin trao đổi không xoá được, như chính tin đó.
 *
 * Quyền: xem / tải = `task:read`; tệp trong tin = `task:edit`; tệp khi tạo / giao việc = `task:attach`.
 * Nhánh lưu trữ là chỉ đọc (409).
 */

import express, { Router } from 'express';
import { stmt, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../lib/policies.js';
import {
  MAX_FILE_BYTES,
  checkUpload,
  cleanFileName,
  removeStoredFiles,
  storeFile,
  storedPath,
} from '../lib/attachments.js';
import { ARCHIVED_ERROR, isInArchive, loadTierItem, logAudit } from './tasks.js';

const router = Router();

/** Áp requireAuth chỉ cho các đường dẫn của router này (router mount ở /api dùng chung). */
const auth = [requireAuth];

const ENTITY = { 1: 'project', 2: 'phase', 3: 'bundle', 4: 'task' };

function loadItem(req, res) {
  const tier = Number(req.params.tier);
  if (!ENTITY[tier]) {
    res.status(400).json({ error: 'invalid_tier' });
    return null;
  }
  const item = loadTierItem(tier, req.params.id);
  if (!item) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return item;
}

router.get('/tasks/:tier(\\d+)/:id(\\d+)/attachments', auth, (req, res) => {
  const item = loadItem(req, res);
  if (!item) return;
  const authz = authorize('task:read', req.user, { task: item });
  if (!authz.ok) return res.status(authz.status).json(authz);
  return res.json({ items: stmt.listAttachmentsByItem.all(item.tier, item.id) });
});

router.post(
  '/tasks/:tier(\\d+)/:id(\\d+)/attachments',
  auth,
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  (req, res) => {
    const item = loadItem(req, res);
    if (!item) return;
    if (req.query.message_id && item.tier !== 4) {
      return res.status(400).json({ error: 'messages_only_for_task', message: 'Chỉ đầu việc mới có trao đổi.' });
    }
    // Tệp trong tin trao đổi: ai gửi được tin thì gắn được tệp. Tệp khi tạo / giao việc: `task:attach`.
    const authz = authorize(req.query.message_id ? 'task:edit' : 'task:attach', req.user, { task: item });
    if (!authz.ok) return res.status(authz.status).json(authz);
    if (isInArchive(item.tier, item.id)) return res.status(409).json(ARCHIVED_ERROR);

    let messageId = null;
    if (req.query.message_id) {
      messageId = Number(req.query.message_id);
      if (!stmt.getOwnRecentHelpMessage.get(messageId, item.id, req.user.id)) {
        return res.status(409).json({
          error: 'message_closed',
          message: 'Chỉ gắn được tệp vào tin của chính bạn, ngay sau khi gửi.',
        });
      }
    }

    const name = cleanFileName(req.query.name);
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = checkUpload(name, buf);
    if (!check.ok) return res.status(check.error === 'file_too_large' ? 413 : 400).json(check);

    const storedName = storeFile(buf, check.ext);
    const owner = [1, 2, 3, 4].map((t) => (t === item.tier ? item.id : null));
    let id = 0;
    try {
      tx(() => {
        const info = stmt.insertAttachment.run(...owner, messageId, name, storedName, check.mime, buf.length, req.user.id);
        id = Number(info.lastInsertRowid);
        logAudit(ENTITY[item.tier], item.id, 'update', null, { attachment_added: name, attachment_id: id, message_id: messageId }, req);
      });
    } catch (err) {
      removeStoredFiles([storedName]);
      throw err;
    }
    const saved = stmt.listAttachmentsByItem.all(item.tier, item.id).find((f) => f.id === id);
    return res.status(201).json({ item: saved });
  },
);

/** Tệp + mục chứa nó, kèm kiểm tra quyền `action`. Trả null nếu đã gửi lỗi. */
function loadAttachment(req, res, action) {
  const file = stmt.getAttachment.get(Number(req.params.attId));
  if (!file) {
    res.status(404).json({ error: 'not_found', message: 'Tệp không còn tồn tại.' });
    return null;
  }
  const tier = file.project_id ? 1 : file.phase_id ? 2 : file.bundle_id ? 3 : 4;
  const item = loadTierItem(tier, file.project_id ?? file.phase_id ?? file.bundle_id ?? file.task_id);
  const authz = item ? authorize(action, req.user, { task: item }) : { ok: false, status: 404, error: 'not_found' };
  if (!authz.ok) {
    res.status(authz.status).json(authz);
    return null;
  }
  return { file, item };
}

router.get('/attachments/:attId(\\d+)', auth, (req, res) => {
  const found = loadAttachment(req, res, 'task:read');
  if (!found) return;
  const { file } = found;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.attachment(file.original_name);
  res.type(file.mime);
  return res.sendFile(storedPath(file.stored_name), (err) => {
    if (err && !res.headersSent) {
      res.status(410).json({ error: 'file_missing', message: 'Tệp không còn trên máy chủ. Hãy báo quản trị hệ thống.' });
    }
  });
});

router.delete('/attachments/:attId(\\d+)', auth, (req, res) => {
  const found = loadAttachment(req, res, 'task:attach');
  if (!found) return;
  const { file, item } = found;
  if (file.message_id != null) {
    return res.status(409).json({ error: 'message_attachment', message: 'Tệp trong tin trao đổi không xoá được.' });
  }
  if (file.uploaded_by_user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Chỉ người tải tệp lên (hoặc quản trị) mới xoá được.' });
  }
  if (isInArchive(item.tier, item.id)) return res.status(409).json(ARCHIVED_ERROR);

  tx(() => {
    stmt.deleteAttachment.run(file.id);
    logAudit(ENTITY[item.tier], item.id, 'update', { attachment_removed: file.original_name, attachment_id: file.id }, { attachment_removed: file.original_name }, req);
  });
  removeStoredFiles([file.stored_name]);
  return res.status(204).send();
});

export default router;
