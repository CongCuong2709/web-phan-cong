// bootstrap-schema.mjs — Tạo database mới với schema mới (Phase C)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, 'backend');
const DB_PATH = path.join(backendDir, 'database.db');
const SCHEMA_PATH = path.join(backendDir, 'sql', 'schema.sql');

// Tạo file mới
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

console.log('Schema applied to:', DB_PATH);
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();
console.log('Tables created:');
tables.forEach((t) => console.log('  -', t.name));

const triggers = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
).all();
console.log('Triggers created:');
triggers.forEach((t) => console.log('  -', t.name));

db.close();
