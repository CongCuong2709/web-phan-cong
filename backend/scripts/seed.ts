/**
 * seed.ts — Import seed data từ frontend vào SQLite.
 *
 * Usage:
 *   cd backend
 *   npm install          # lần đầu
 *   npm run seed         # chạy script này
 *
 * Script sẽ:
 *   1. Xoá hết rows trong tables (trừ departments)
 *   2. Insert 11 users từ src/data/users.ts (bcrypt password)
 *   3. Insert 53 tier items từ constructionData.ts (theo thứ tự tier 1→4 để FK chain)
 *   4. Insert deliverables, subtasks, daily_logs, history_entries
 *   5. Insert team_lead_tasks, employee_tasks
 *   6. In summary table
 *
 * Lưu ý: script dùng path relative `../src/data/...`. Nếu chạy từ backend/
 * thì import path là '../../src/data/...'. Phải chạy từ backend/.
 */

import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');

// ============================================================================
// Import seed data từ frontend
// ============================================================================
// Dùng relative path từ backend/scripts/ đến frontend src/data/
// Khi chạy `npm run seed` từ backend/ thì __dirname = backend/scripts/
const FRONTEND_DATA = path.join(__dirname, '..', '..', 'src', 'data');

const { SEED_USERS } = await import(pathToFileURL(path.join(FRONTEND_DATA, 'users.ts')).href);
const {
  CONSTRUCTION_TIER_ITEMS,
  CONSTRUCTION_SUBTASKS,
  CONSTRUCTION_DAILY_LOGS,
  CONSTRUCTION_HISTORY,
  CONSTRUCTION_TEAM_MEMBERS,
  CONSTRUCTION_TEAM_LEAD_TASKS,
  CONSTRUCTION_EMPLOYEE_TASKS,
} = await import(pathToFileURL(path.join(FRONTEND_DATA, 'constructionData.ts')).href);

// ============================================================================
// DB open + wipe
// ============================================================================

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ DB not found at ${DB_PATH}. Chạy "npm run dev" hoặc "node server.js" 1 lần trước để tạo schema.`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

console.log('🗑️  Clearing existing data…');
const tx = db.transaction(() => {
  // Thứ tự xoá: leaf → parent (FK cascade sẽ lo nhưng explicit cho an toàn)
  db.exec(`
    DELETE FROM history_entries;
    DELETE FROM daily_logs;
    DELETE FROM subtasks;
    DELETE FROM deliverables;
    DELETE FROM employee_task_notes;
    DELETE FROM employee_tasks;
    DELETE FROM help_requests;
    DELETE FROM team_lead_tasks;
    DELETE FROM tier_items;
    DELETE FROM sessions;
    DELETE FROM messages;
    DELETE FROM attachments;
    DELETE FROM user_departments;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
});
tx();

// ============================================================================
// Helpers
// ============================================================================

const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, fullname, email, role, initial, avatar_url)
  VALUES (@username, @password_hash, @fullname, @email, @role, @initial, @avatar_url)
`);
const insertUserDept = db.prepare(`
  INSERT INTO user_departments (user_id, department_code) VALUES (?, ?)
`);
const getUserId = db.prepare('SELECT id FROM users WHERE username = ?');

const insertTier = db.prepare(`
  INSERT INTO tier_items (code, tier, title, parent_id, department_code, owner_user_id,
    deadline, progress, status, priority, description, management_notes,
    start_week, end_week, gantt_label, gantt_bar_color)
  VALUES (@code, @tier, @title, @parent_id, @department_code, @owner_user_id,
    @deadline, @progress, @status, @priority, @description, @management_notes,
    @start_week, @end_week, @gantt_label, @gantt_bar_color)
`);
const getTierId = db.prepare('SELECT id FROM tier_items WHERE code = ?');

const insertDeliverable = db.prepare(`
  INSERT INTO deliverables (tier_item_id, title, completed, sort_order) VALUES (?, ?, ?, ?)
`);
const insertSubtask = db.prepare(`
  INSERT INTO subtasks (tier_item_id, name, description, assignee_user_id,
    start_date, end_date, progress, status, priority, results)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertDailyLog = db.prepare(`
  INSERT INTO daily_logs (subtask_id, log_date, description, result, obstacle,
    progress, author_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertHistory = db.prepare(`
  INSERT INTO history_entries (entity_type, entity_id, action,
    author_user_id, author_username, author_fullname) VALUES (?, ?, ?, ?, ?, ?)
`);
const insertTeamLeadTask = db.prepare(`
  INSERT INTO team_lead_tasks (code, title, category, deliverable_type, deliverable_text,
    file_name, owner_user_id, department_code, submitted_at, deadline, status, priority,
    progress_text, help_message_author, help_message_body, help_message_timeago)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertEmployeeTask = db.prepare(`
  INSERT INTO employee_tasks (code, bundle_name, title, description, current_deliverable,
    last_updated, deadline, is_today, status, manager_user_id, owner_user_id, department_code)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// ============================================================================
// 1. USERS
// ============================================================================
console.log('👥 Inserting users…');
const userIdByUsername = new Map<string, number>();
for (const u of SEED_USERS) {
  const hash = bcrypt.hashSync(u.password, 10);
  const info = insertUser.run({
    username: u.username,
    password_hash: hash,
    fullname: u.fullname,
    email: u.email ?? null,
    role: u.role,
    initial: u.initial ?? null,
    avatar_url: u.avatar ?? null,
  });
  const id = Number(info.lastInsertRowid);
  userIdByUsername.set(u.username, id);
  for (const dept of u.departments) {
    insertUserDept.run(id, dept);
  }
}
console.log(`   ✓ ${userIdByUsername.size} users`);

// ============================================================================
// 2. TIER ITEMS (sorted by tier asc → parent_id có sẵn khi insert T2/T3/T4)
// ============================================================================
console.log('🌳 Inserting tier items…');
const tierIdByOldId = new Map<string, number>();
const sortedTiers = [...CONSTRUCTION_TIER_ITEMS].sort((a, b) => a.tier - b.tier);

for (const t of sortedTiers) {
  let parentDbId: number | null = null;
  if (t.parentId && tierIdByOldId.has(t.parentId)) {
    parentDbId = tierIdByOldId.get(t.parentId) ?? null;
  }
  const ownerDbId = t.ownerUsername ? userIdByUsername.get(t.ownerUsername) ?? null : null;

  const info = insertTier.run({
    code: t.code,
    tier: t.tier,
    title: t.title,
    parent_id: parentDbId,
    department_code: t.department ?? null,
    owner_user_id: ownerDbId,
    deadline: t.deadline,
    progress: t.progress,
    status: t.status,
    priority: t.priority,
    description: t.description ?? '',
    management_notes: t.managementNotes ?? '',
    start_week: t.gantt.startWeek,
    end_week: t.gantt.endWeek,
    gantt_label: t.gantt.label ?? null,
    gantt_bar_color: t.gantt.barColor ?? null,
  });
  tierIdByOldId.set(t.id, Number(info.lastInsertRowid));
}
console.log(`   ✓ ${tierIdByOldId.size} tier items`);

// ============================================================================
// 3. DELIVERABLES
// ============================================================================
console.log('📦 Inserting deliverables…');
let delivCount = 0;
for (const t of CONSTRUCTION_TIER_ITEMS) {
  const dbId = tierIdByOldId.get(t.id);
  if (!dbId || !t.deliverables?.length) continue;
  for (let i = 0; i < t.deliverables.length; i++) {
    const d = t.deliverables[i];
    insertDeliverable.run(dbId, d.title, d.completed ? 1 : 0, i);
    delivCount++;
  }
}
console.log(`   ✓ ${delivCount} deliverables`);

// ============================================================================
// 4. SUBTASKS
// ============================================================================
console.log('🔧 Inserting subtasks…');
const subtaskIdByOldId = new Map<string, number>();
for (const s of CONSTRUCTION_SUBTASKS) {
  const tierDbId = tierIdByOldId.get(s.taskId);
  if (!tierDbId) {
    console.warn(`   ⚠ Skipping subtask ${s.id}: parent tier ${s.taskId} not found`);
    continue;
  }
  const assigneeId = s.assigneeUsername ? userIdByUsername.get(s.assigneeUsername) ?? null : null;
  const info = insertSubtask.run(
    tierDbId,
    s.name,
    s.description ?? null,
    assigneeId,
    s.startDate,
    s.endDate,
    s.progress,
    s.status,
    s.priority,
    s.results ?? null,
  );
  subtaskIdByOldId.set(s.id, Number(info.lastInsertRowid));
}
console.log(`   ✓ ${subtaskIdByOldId.size} subtasks`);

// ============================================================================
// 5. DAILY LOGS
// ============================================================================
console.log('📝 Inserting daily logs…');
let logCount = 0;
for (const l of CONSTRUCTION_DAILY_LOGS) {
  const subId = subtaskIdByOldId.get(l.subtaskId);
  if (!subId) continue;
  const authorId = userIdByUsername.get(l.username) ?? null;
  insertDailyLog.run(
    subId,
    l.logDate,
    l.description,
    l.result ?? null,
    l.obstacle ?? null,
    l.progress,
    authorId,
  );
  logCount++;
}
console.log(`   ✓ ${logCount} daily logs`);

// ============================================================================
// 6. HISTORY ENTRIES (seed từ frontend const)
// ============================================================================
console.log('📜 Inserting history entries…');
let histCount = 0;
for (const h of CONSTRUCTION_HISTORY) {
  const authorId = userIdByUsername.get(h.username) ?? null;
  // Seed history có entity_id cũ (string). Insert với entity_id = 0 vì chưa map được.
  insertHistory.run(
    h.entityType,
    0,
    h.action,
    authorId,
    h.username,
    h.userName,
  );
  histCount++;
}
console.log(`   ✓ ${histCount} history entries (entity_id=0 cho seed cũ)`);

// ============================================================================
// 7. TEAM LEAD TASKS
// ============================================================================
console.log('🎯 Inserting team lead tasks…');
let tltCount = 0;
for (const t of CONSTRUCTION_TEAM_LEAD_TASKS) {
  const ownerId = t.ownerUsername ? userIdByUsername.get(t.ownerUsername) ?? null : null;
  insertTeamLeadTask.run(
    t.code,
    t.title,
    t.category,
    t.deliverableType,
    t.deliverableText,
    t.fileName ?? null,
    ownerId,
    t.department ?? null,
    t.submittedAt,
    t.deadline ?? null,
    t.status,
    t.priority ?? null,
    t.progressText ?? null,
    t.helpMessage?.author ?? null,
    t.helpMessage?.message ?? null,
    t.helpMessage?.timeAgo ?? null,
  );
  tltCount++;
}
console.log(`   ✓ ${tltCount} team lead tasks`);

// ============================================================================
// 8. EMPLOYEE TASKS
// ============================================================================
console.log('👤 Inserting employee tasks…');
let etCount = 0;
for (const t of CONSTRUCTION_EMPLOYEE_TASKS) {
  const ownerId = t.ownerUsername ? userIdByUsername.get(t.ownerUsername) ?? null : null;
  // manager chỉ là display string trong seed; để null ở manager_user_id vì
  // frontend cũng chỉ lưu fullname/role. Update sau nếu cần.
  insertEmployeeTask.run(
    t.code,
    t.bundleName,
    t.title,
    t.description,
    t.currentDeliverable ?? null,
    t.lastUpdated,
    t.deadline,
    t.isToday ? 1 : 0,
    t.status,
    null, // manager_user_id
    ownerId,
    t.department ?? null,
  );
  etCount++;
}
console.log(`   ✓ ${etCount} employee tasks`);

// ============================================================================
// SUMMARY
// ============================================================================
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Seed complete!');
console.log('');
const counts = {
  users: db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number },
  user_departments: db.prepare('SELECT COUNT(*) AS c FROM user_departments').get() as { c: number },
  tier_items: db.prepare('SELECT COUNT(*) AS c FROM tier_items').get() as { c: number },
  deliverables: db.prepare('SELECT COUNT(*) AS c FROM deliverables').get() as { c: number },
  subtasks: db.prepare('SELECT COUNT(*) AS c FROM subtasks').get() as { c: number },
  daily_logs: db.prepare('SELECT COUNT(*) AS c FROM daily_logs').get() as { c: number },
  history_entries: db.prepare('SELECT COUNT(*) AS c FROM history_entries').get() as { c: number },
  team_lead_tasks: db.prepare('SELECT COUNT(*) AS c FROM team_lead_tasks').get() as { c: number },
  employee_tasks: db.prepare('SELECT COUNT(*) AS c FROM employee_tasks').get() as { c: number },
};
for (const [k, v] of Object.entries(counts)) {
  console.log(`   ${k.padEnd(20)} ${v.c}`);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('👉 Test thử:');
console.log('   npm run dev   # chạy backend');
console.log('   curl -X POST http://localhost:3001/api/auth/login \\');
console.log('     -H "Content-Type: application/json" \\');
console.log('     -d \'{"username":"admin","password":"admin123"}\'');

db.close();