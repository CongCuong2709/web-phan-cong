/**
 * seed.ts — Phase C: Dữ liệu seed cho schema v3 (4-tier normalized).
 *
 * Tạo:
 *   - 4 departments (ĐH, QLDA, KTTC, TC)
 *   - 11 users (admin + 2 directors + 4 managers + 6 employees)
 *   - 1 project QLDA-001 với 1 phase → 1 bundle → 2 tasks
 *   - 1 standalone task KTTC (test tier-4 không có parent)
 *
 * Phase C changes:
 *   - KHÔNG import từ src/data/constructionData.ts (file rỗng từ cleanup)
 *   - Data inline trong file này
 *   - Insert vào 4 bảng: projects, phases, bundles, tasks
 *   - Không wipe các bảng cũ (đã được db.js tạo mới khi fresh DB)
 */

import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');

// ============================================================================
// DB open
// ============================================================================

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ DB not found at ${DB_PATH}.`);
  console.error('   Chạy "npm run dev" 1 lần trước để bootstrap database + áp dụng schema.');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

console.log('🗑️  Clearing existing data…');
db.exec(`
  DELETE FROM audit_log;
  DELETE FROM daily_logs;
  DELETE FROM subtasks;
  DELETE FROM task_help_messages;
  DELETE FROM task_deliverables;
  DELETE FROM task_notes;
  DELETE FROM help_requests;
  DELETE FROM tasks;
  DELETE FROM bundles;
  DELETE FROM phases;
  DELETE FROM projects;
  DELETE FROM sessions;
  DELETE FROM messages;
  DELETE FROM attachments;
  DELETE FROM user_departments;
  DELETE FROM users;
  DELETE FROM departments;
  DELETE FROM sqlite_sequence;
`);

// ============================================================================
// 1. Departments
// ============================================================================

console.log('📁 Inserting departments…');
const departments = [
  { code: 'ĐH',   name: 'Ban Điều hành',          sort_order: 10 },
  { code: 'QLDA', name: 'Phòng Quản lý Dự án',    sort_order: 20 },
  { code: 'KTTC', name: 'Phòng Kế toán – Tài chính', sort_order: 30 },
  { code: 'TC',   name: 'Phòng Tổ chức – Hành chính', sort_order: 40 },
];
const insertDept = db.prepare(
  'INSERT INTO departments (code, name, sort_order) VALUES (?, ?, ?)'
);
for (const d of departments) insertDept.run(d.code, d.name, d.sort_order);

// ============================================================================
// 2. Users + User-department mapping
// ============================================================================

console.log('👥 Inserting users…');
const passwordHash = bcrypt.hashSync('123456', 10);
const passwordAdmin = bcrypt.hashSync('admin123', 10);

const users = [
  { username: 'admin',  fullname: 'Quản trị hệ thống',  role: 'admin',     depts: ['ĐH','QLDA','KTTC','TC'] },
  { username: 'khanh',  fullname: 'Khánh — BGĐ',         role: 'director',  depts: ['ĐH'] },
  { username: 'nam',    fullname: 'Nam — BGĐ',           role: 'director',  depts: ['ĐH'] },
  { username: 'hung',   fullname: 'Hùng — TP.QLDA',      role: 'manager',   depts: ['QLDA'] },
  { username: 'cuong',  fullname: 'Cường — TP.KTTC',     role: 'manager',   depts: ['KTTC'] },
  { username: 'thanh',  fullname: 'Thành — TP.TC',       role: 'manager',   depts: ['TC'] },
  { username: 'hong',   fullname: 'Hồng — NV.QLDA',      role: 'employee',  depts: ['QLDA'] },
  { username: 'nguyet', fullname: 'Nguyệt — NV.KTTC',    role: 'employee',  depts: ['KTTC'] },
  { username: 'hang',   fullname: 'Hằng — NV.KTTC',      role: 'employee',  depts: ['KTTC'] },
  { username: 'tu',     fullname: 'Tú — NV.KTTC',        role: 'employee',  depts: ['KTTC'] },
  { username: 'ngoc',   fullname: 'Ngọc — NV.TC',        role: 'employee',  depts: ['TC'] },
];

const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, fullname, role, initial)
  VALUES (?, ?, ?, ?, ?)
`);
const insertUserDept = db.prepare(`
  INSERT INTO user_departments (user_id, department_code) VALUES (?, ?)
`);

const userIds: Record<string, number> = {};
for (const u of users) {
  const hash = u.username === 'admin' ? passwordAdmin : passwordHash;
  const info = insertUser.run(u.username, hash, u.fullname, u.role, u.fullname.charAt(0).toUpperCase());
  const id = Number(info.lastInsertRowid);
  userIds[u.username] = id;
  for (const d of u.depts) insertUserDept.run(id, d);
}
console.log(`   ✓ ${users.length} users`);

// ============================================================================
// 3. Project hierarchy (QLDA example + standalone KTTC task)
// ============================================================================

console.log('📊 Inserting project hierarchy…');

// --- Tier 1: Project ---
const projectInfo = db.prepare(`
  INSERT INTO projects (code, title, description, owner_user_id, start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  'DA-QLDA-001',
  'Dự án Khu đô thị mới',
  'Dự án trọng điểm Q1/2026. Bao gồm hạ tầng, pháp lý, thiết kế.',
  userIds['hung'],
  '2026-01-01',
  '2026-12-31',
  'doing',
);
const projectId = Number(projectInfo.lastInsertRowid);

// --- Tier 2: Phase ---
const phaseInfo = db.prepare(`
  INSERT INTO phases (project_id, code, title, description, owner_user_id,
    start_date, end_date, status, management_notes, blocker_alert)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  projectId,
  'GD-01',
  'Giai đoạn chuẩn bị đầu tư',
  'Hồ sơ pháp lý + thiết kế cơ sở',
  userIds['hung'],
  '2026-01-01',
  '2026-04-30',
  'doing',
  'Đang chờ ý kiến BGĐ về phương án đền bù GPMB.',
  null,
);
const phaseId = Number(phaseInfo.lastInsertRowid);

// --- Tier 3: Bundle ---
const bundleInfo = db.prepare(`
  INSERT INTO bundles (phase_id, code, title, description, owner_user_id,
    start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  phaseId,
  'GOI-01',
  'Hồ sơ pháp lý & thiết kế cơ sở',
  'Bao gồm GPMB, TKCS, thẩm tra',
  userIds['hung'],
  '2026-01-15',
  '2026-03-15',
  'doing',
);
const bundleId = Number(bundleInfo.lastInsertRowid);

// --- Tier 4: Tasks (2 tasks trong bundle) ---
const insertTask = db.prepare(`
  INSERT INTO tasks (bundle_id, code, title, description, owner_user_id,
    department_code, start_date, end_date, progress, status, priority, is_today)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const t1 = insertTask.run(
  bundleId,
  'T4-A01',
  'Hồ sơ pháp lý mặt bằng',
  'Hoàn tất thủ tục đất đai, GPMB khu vực A',
  userIds['hong'],
  'QLDA',
  '2026-01-15',
  '2026-02-15',
  50,
  'doing',
  'high',
  1,
);
const t1Id = Number(t1.lastInsertRowid);

const t2 = insertTask.run(
  bundleId,
  'T4-A02',
  'Thiết kế cơ sở',
  'Hồ sơ thiết kế cơ sở gửi SXD',
  userIds['hong'],
  'QLDA',
  '2026-02-15',
  '2026-03-15',
  30,
  'doing',
  'normal',
  0,
);
const t2Id = Number(t2.lastInsertRowid);

// --- Standalone task (KTTC, no parent) ---
const t3 = insertTask.run(
  null,  // bundle_id = NULL
  'T4-KTTC-01',
  'Báo cáo quyết toán Q1',
  'Tổng hợp quyết toán quý 1 cho BGĐ',
  userIds['nguyet'],
  'KTTC',
  '2026-01-01',
  '2026-03-31',
  0,
  'pending',
  'high',
  0,
);
const t3Id = Number(t3.lastInsertRowid);

// ============================================================================
// 4. Subtask + Daily log demo (cho T4-A01)
// ============================================================================

console.log('📝 Inserting subtasks + daily logs…');
const insertSubtask = db.prepare(`
  INSERT INTO subtasks (task_id, name, assignee_user_id, progress, status)
  VALUES (?, ?, ?, ?, ?)
`);
const insertLog = db.prepare(`
  INSERT INTO daily_logs (subtask_id, log_date, description, result, obstacle, progress, author_user_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const subInfo = insertSubtask.run(
  t1Id,
  'Khảo sát hiện trạng',
  userIds['hong'],
  60,
  'doing',
);
const subId = Number(subInfo.lastInsertRowid);

insertLog.run(
  subId,
  '2026-01-20',
  'Khảo sát thực địa khu A, đo đạc diện tích',
  'Đã hoàn tất 80% diện tích, còn 20% vướng mặt bằng hộ dân',
  'Một số hộ chưa đồng ý di dời',
  60,
  userIds['hong'],
);

// ============================================================================
// 5. Task deliverables + help message demo
// ============================================================================

console.log('📦 Inserting deliverables + help messages…');
db.prepare(`
  INSERT INTO task_deliverables (task_id, type, text, completed, sort_order)
  VALUES (?, ?, ?, ?, ?)
`).run(t1Id, 'text', 'Báo cáo khảo sát hiện trạng', 1, 0);

db.prepare(`
  INSERT INTO task_deliverables (task_id, type, text, file_name, completed, sort_order)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(t1Id, 'pdf', 'Bản đồ hiện trạng tỷ lệ 1/500', 'hientrang_A.pdf', 0, 1);

db.prepare(`
  INSERT INTO task_help_messages (task_id, author_user_id, body, is_resolved)
  VALUES (?, ?, ?, ?)
`).run(t1Id, userIds['hong'], 'Cần hỗ trợ thêm nhân lực khảo sát do 1 bạn nghỉ phép', 0);

// ============================================================================
// 6. Audit log demo
// ============================================================================

console.log('📜 Inserting audit log demo…');
db.prepare(`
  INSERT INTO audit_log (entity_type, entity_id, action, new_values, actor_user_id, actor_username, actor_ip)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  'project', projectId, 'create',
  JSON.stringify({ code: 'DA-QLDA-001', title: 'Dự án Khu đô thị mới' }),
  userIds['hung'], 'hung', '127.0.0.1',
);

db.prepare(`
  INSERT INTO audit_log (entity_type, entity_id, action, new_values, actor_user_id, actor_username, actor_ip)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  'task', t1Id, 'create',
  JSON.stringify({ code: 'T4-A01', title: 'Hồ sơ pháp lý mặt bằng' }),
  userIds['hung'], 'hung', '127.0.0.1',
);

// ============================================================================
// Summary
// ============================================================================

db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();

console.log('\n✅ Seed v3 complete!');
console.log('   - 4 departments, 11 users');
console.log('   - 1 project → 1 phase → 1 bundle → 2 tasks + 1 standalone task');
console.log('   - 1 subtask + 1 daily log + 2 deliverables + 1 help message');
console.log('   - 2 audit log entries');
console.log('\n   Default password:');
console.log('   - admin / admin123');
console.log('   - all others / 123456');
