import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('database.test.db');
const u = db.prepare("SELECT id, username, role FROM users WHERE username LIKE 'nv-kttc%'").all();
console.log('KTTC users:', u);
const u11 = db.prepare('SELECT id, username, role FROM users WHERE id=11').get();
console.log('id=11:', u11);
const u10 = db.prepare('SELECT id, username, role FROM users WHERE id=10').get();
console.log('id=10:', u10);
const u18 = db.prepare('SELECT id, username, role FROM users WHERE id=18').get();
console.log('id=18:', u18);
db.close();
