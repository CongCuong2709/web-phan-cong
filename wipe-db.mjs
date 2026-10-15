// wipe-db.mjs — Xóa database để bootstrap lại từ schema mới
// An toàn vì DB chỉ chứa data demo (xem db-audit.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, 'backend');

const files = [
  'database.db', 'database.db-wal', 'database.db-shm',
  'database.test.db', 'database.test.db-wal', 'database.test.db-shm',
];

for (const f of files) {
  const p = path.join(backendDir, f);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log('Deleted:', f);
  } else {
    console.log('Skip (not found):', f);
  }
}
