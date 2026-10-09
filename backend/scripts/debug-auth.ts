import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const db = new DatabaseSync('database.test.db');
const u = db.prepare("SELECT username, password_hash FROM users WHERE username='admin'").get() as { username: string; password_hash: string };
console.log('user:', u);
console.log('compare admin123:', bcrypt.compareSync('admin123', u.password_hash));
console.log('compare wrong:', bcrypt.compareSync('wrong', u.password_hash));
db.close();
