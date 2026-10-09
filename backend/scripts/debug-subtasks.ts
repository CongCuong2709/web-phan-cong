import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('database.test.db');
const rows = db.prepare(`
  SELECT s.id, s.assignee_user_id, t.code, t.owner_user_id, u.username as owner_name
  FROM subtasks s
  JOIN tier_items t ON t.id = s.tier_item_id
  JOIN users u ON u.id = t.owner_user_id
  WHERE t.owner_user_id = (SELECT id FROM users WHERE username = 'nv-qlda-1')
`).all();
console.log('Subtasks of T4 owned by nv-qlda-1:');
console.log(JSON.stringify(rows, null, 2));
db.close();
