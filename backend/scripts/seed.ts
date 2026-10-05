/**
 * seed.ts — Import seed data từ frontend vào SQLite.
 *
 * Usage:
 *   cd backend
 *   npm install
 *   npm run dev    # một lần để bootstrap schema (tạo database.db)
 *   # Ctrl+C, rồi:
 *   npm run seed
 *
 * Migration từ node:sqlite + bcryptjs (zero native compilation).
 */

import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');

// ============================================================================
// Import seed data từ frontend
// ============================================================================
const FRONTEND_DATA = path.join(__dirname, '..', '..', 'src', 'data');

const { SEED_USERS } = await import(pathToFileURL(path.join(FRONTEND_DATA, 'users.ts')).href);
const {
  CONSTRUCTION_TIER_ITEMS,
  CONSTRUCTION_SUBTASKS,
  CONSTRUCTION_DAILY_LOGS,
  CONSTRUCTION_HISTORY,
  CONSTRUCTION_TEAM_LEAD_TASKS,
  CONSTRUCTION_EMPLOYEE_TASKS,
} = await import(pathToFileURL(path.join(FRONTEND_DATA, 'constructionData.ts')).href);

// ============================================================================
// DB open + wipe
// ============================================================================

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ DB not found at ${DB_PATH}.`);
  console.error('   Chạy "npm run dev" 1 lần trước để bootstrap database + áp dụng schema.');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

console.log('🗑️  Clearing existing data…');
tx(() => {
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

// ============================================================================
// Manual transaction wrapper (node:sqlite không có built-in)
// ============================================================================
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

// ============================================================================
// Prepared statements
// ============================================================================
const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, fullname, email, role, initial, avatar_url)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertUserDept = db.prepare(
  'INSERT INTO user_departments (user_id, department_code) VALUES (?, ?)'
);

const insertTier = db.prepare(`
  INSERT INTO tier_items (code, tier, title, parent_id, department_code, owner_user_id,
    deadline, progress, status, priority, description, management_notes,
    start_week, end_week, gantt_label, gantt_bar_color)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertDeliverable = db.prepare(
  'INSERT INTO deliverables (tier_item_id, title, completed, sort_order) VALUES (?, ?, ?, ?)'
);

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
const userIdByUsername = new Map();
tx(() => {
  for (const u of SEED_USERS) {
    const hash = bcrypt.hashSync(u.password, 10);
    const info = insertUser.run(
      u.username,
      hash,
      u.fullname,
      u.email ?? null,
      u.role,
      u.initial ?? null,
      u.avatar ?? null,
    );
    const id = Number(info.lastInsertRowid);
    userIdByUsername.set(u.username, id);
    for (const dept of u.departments) {
      insertUserDept.run(id, dept);
    }
  }
});
console.log(`   ✓ ${userIdByUsername.size} users`);

// ============================================================================
// 2. TIER ITEMS
// ============================================================================
console.log('🌳 Inserting tier items…');
const tierIdByOldId = new Map();
const sortedTiers = [...CONSTRUCTION_TIER_ITEMS].sort((a, b) => a.tier - b.tier);

tx(() => {
  for (const t of sortedTiers) {
    const parentDbId = t.parentId && tierIdByOldId.has(t.parentId)
      ? tierIdByOldId.get(t.parentId)
      : null;
    const ownerDbId = t.ownerUsername ? userIdByUsername.get(t.ownerUsername) ?? null : null;

    const info = insertTier.run(
      t.code,
      t.tier,
      t.title,
      parentDbId,
      t.department ?? null,
      ownerDbId,
      t.deadline,
      t.progress,
      t.status,
      t.priority,
      t.description ?? '',
      t.managementNotes ?? '',
      t.gantt.startWeek,
      t.gantt.endWeek,
      t.gantt.label ?? null,
      t.gantt.barColor ?? null,
    );
    tierIdByOldId.set(t.id, Number(info.lastInsertRowid));
  }
});
console.log(`   ✓ ${tierIdByOldId.size} tier items`);

// ============================================================================
// 3. DELIVERABLES
// ============================================================================
console.log('📦 Inserting deliverables…');
let delivCount = 0;
tx(() => {
  for (const t of CONSTRUCTION_TIER_ITEMS) {
    const dbId = tierIdByOldId.get(t.id);
    if (!dbId || !t.deliverables?.length) continue;
    for (let i = 0; i < t.deliverables.length; i++) {
      const d = t.deliverables[i];
      insertDeliverable.run(dbId, d.title, d.completed ? 1 : 0, i);
      delivCount++;
    }
  }
});
console.log(`   ✓ ${delivCount} deliverables`);

// ============================================================================
// 4. SUBTASKS
// ============================================================================
console.log('🔧 Inserting subtasks…');
const subtaskIdByOldId = new Map();
tx(() => {
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
});
console.log(`   ✓ ${subtaskIdByOldId.size} subtasks`);

// ============================================================================
// 5. DAILY LOGS
// ============================================================================
console.log('📝 Inserting daily logs…');
let logCount = 0;
tx(() => {
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
});
console.log(`   ✓ ${logCount} daily logs`);

// ============================================================================
// 6. HISTORY ENTRIES
// ============================================================================
console.log('📜 Inserting history entries…');
let histCount = 0;
tx(() => {
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
});
console.log(`   ✓ ${histCount} history entries (entity_id=0 cho seed cũ)`);

// ============================================================================
// 7. TEAM LEAD TASKS
// ============================================================================
console.log('🎯 Inserting team lead tasks…');
let tltCount = 0;
tx(() => {
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
});
console.log(`   ✓ ${tltCount} team lead tasks`);

// ============================================================================
// 8. EMPLOYEE TASKS
// ============================================================================
console.log('👤 Inserting employee tasks…');
let etCount = 0;
tx(() => {
  for (const t of CONSTRUCTION_EMPLOYEE_TASKS) {
    const ownerId = t.ownerUsername ? userIdByUsername.get(t.ownerUsername) ?? null : null;
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
      null, // manager_user_id — seed chỉ có display string
      ownerId,
      t.department ?? null,
    );
    etCount++;
  }
});
console.log(`   ✓ ${etCount} employee tasks`);

// ============================================================================
// SUMMARY
// ============================================================================
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Seed complete!');
console.log('');

function count(sql) {
  return db.prepare(sql).get().c;
}

console.log(`   users                  ${count('SELECT COUNT(*) AS c FROM users')}`);
console.log(`   user_departments       ${count('SELECT COUNT(*) AS c FROM user_departments')}`);
console.log(`   tier_items             ${count('SELECT COUNT(*) AS c FROM tier_items')}`);
console.log(`   deliverables           ${count('SELECT COUNT(*) AS c FROM deliverables')}`);
console.log(`   subtasks               ${count('SELECT COUNT(*) AS c FROM subtasks')}`);
console.log(`   daily_logs             ${count('SELECT COUNT(*) AS c FROM daily_logs')}`);
console.log(`   history_entries        ${count('SELECT COUNT(*) AS c FROM history_entries')}`);
console.log(`   team_lead_tasks        ${count('SELECT COUNT(*) AS c FROM team_lead_tasks')}`);
console.log(`   employee_tasks         ${count('SELECT COUNT(*) AS c FROM employee_tasks')}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('👉 Test thử:');
console.log('   npm run dev   # chạy backend');
console.log('   curl -X POST http://localhost:3001/api/auth/login \\');
console.log('     -H "Content-Type: application/json" \\');
console.log('     -d \'{"username":"admin","password":"admin123"}\'');

db.close();