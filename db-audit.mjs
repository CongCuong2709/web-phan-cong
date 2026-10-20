// db-audit.mjs — Verify schema + data (Phase G — 2026-10)
//
// Phase F đã drop: task_deliverables, task_help_messages (Phase G restore lại
// với tên task_help_messages, KHÔNG phải task_help_messages), help_requests.
// Phase G thêm: is_today_date, created_by_user_id, task_help_messages.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'backend', 'database.db'));

const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();
console.log('Tables:', tables.map((t) => t.name).join(', '));

const counts = {
  users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
  departments: db.prepare('SELECT COUNT(*) AS c FROM departments').get().c,
  user_departments: db.prepare('SELECT COUNT(*) AS c FROM user_departments').get().c,
  projects: db.prepare('SELECT COUNT(*) AS c FROM projects').get().c,
  phases: db.prepare('SELECT COUNT(*) AS c FROM phases').get().c,
  bundles: db.prepare('SELECT COUNT(*) AS c FROM bundles').get().c,
  tasks: db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c,
  daily_logs: db.prepare('SELECT COUNT(*) AS c FROM daily_logs').get().c,
  task_help_messages: db.prepare('SELECT COUNT(*) AS c FROM task_help_messages').get().c,
  audit_log: db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c,
  sessions: db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c,
};
console.log('Row counts:', JSON.stringify(counts, null, 2));

// Phase G: check UNIQUE constraint trên daily_logs
const uniqueIdx = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='index' AND name='idx_daily_logs_task_date_unique'
`).get();
console.log('UNIQUE index on daily_logs(task_id, log_date):', uniqueIdx ? '✅' : '❌');

// Phase G: check is_today_date + created_by_user_id tồn tại
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
const checks = [
  { t: 'projects', c: 'created_by_user_id' },
  { t: 'phases',   c: 'created_by_user_id' },
  { t: 'bundles',  c: 'created_by_user_id' },
  { t: 'tasks',    c: 'created_by_user_id' },
  { t: 'tasks',    c: 'is_today_date' },
];
console.log('Schema column checks:');
for (const { t, c } of checks) {
  console.log(`  ${hasColumn(t, c) ? '✅' : '❌'} ${t}.${c}`);
}

console.log('--- Sample data ---');
console.log('Projects:', db.prepare('SELECT id, code, title, status, created_by_user_id FROM projects').all());
console.log('Phases:', db.prepare('SELECT id, project_id, code, title, status, created_by_user_id FROM phases').all());
console.log('Bundles:', db.prepare('SELECT id, phase_id, code, title, status, created_by_user_id FROM bundles').all());
console.log('Tasks:', db.prepare(`
  SELECT id, bundle_id, code, title, status, progress,
    is_today, is_today_date, created_by_user_id
  FROM tasks
`).all());
console.log('Daily logs:', db.prepare(`
  SELECT id, task_id, log_date, description, progress FROM daily_logs
`).all());
console.log('Help messages:', db.prepare(`
  SELECT id, task_id, author_user_id, is_resolved, resolved_at, body
  FROM task_help_messages
`).all());
console.log('Audit log:', db.prepare(`
  SELECT entity_type, entity_id, action, actor_username FROM audit_log
`).all());

db.close();
