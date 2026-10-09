import { createApp } from '../app.js';
import request from 'supertest';

const app = createApp();

async function main() {
  const r = await request(app).post('/api/auth/login').send({ username: 'admin', password: '123456' });
  console.log('STATUS:', r.status);
  console.log('USER:', JSON.stringify(r.body.user, null, 2));
  console.log('TYPEOF departments:', typeof r.body.user.departments);
  console.log('Is array:', Array.isArray(r.body.user.departments));
  process.exit(0);
}
main();
