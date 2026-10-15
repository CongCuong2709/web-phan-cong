// db-audit.mjs — Verify schema + data (Phase C)
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
  projects: db.prepare('SELECT COUNT(*) AS c FROM projects').get().c,
  phases: db.prepare('SELECT COUNT(*) AS c FROM phases').get().c,
  bundles: db.prepare('SELECT COUNT(*) AS c FROM bundles').get().c,
  tasks: db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c,
  task_deliverables: db.prepare('SELECT COUNT(*) AS c FROM task_deliverables').get().c,
  task_help_messages: db.prepare('SELECT COUNT(*) AS c FROM task_help_messages').get().c,
  subtasks: db.prepare('SELECT COUNT(*) AS c FROM subtasks').get().c,
  daily_logs: db.prepare('SELECT COUNT(*) AS c FROM daily_logs').get().c,
  help_requests: db.prepare('SELECT COUNT(*) AS c FROM help_requests').get().c,
  audit_log: db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c,
};
console.log('Row counts:', JSON.stringify(counts, null, 2));

console.log('--- Sample data ---');
console.log('Projects:', db.prepare('SELECT id, code, title, status FROM projects').all());
console.log('Phases:', db.prepare('SELECT id, project_id, code, title, status FROM phases').all());
console.log('Bundles:', db.prepare('SELECT id, phase_id, code, title, status FROM bundles').all());
console.log('Tasks:', db.prepare('SELECT id, bundle_id, code, title, status, progress, is_today FROM tasks').all());
console.log('Deliverables:', db.prepare('SELECT id, task_id, type, text, completed FROM task_deliverables').all());
console.log('Help messages:', db.prepare('SELECT id, task_id, body, is_resolved FROM task_help_messages').all());
console.log('Audit log:', db.prepare('SELECT entity_type, entity_id, action, actor_username FROM audit_log').all());

db.close();
