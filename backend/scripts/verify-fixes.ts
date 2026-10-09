/**
 * verify-fixes.ts — Chạy 1 lần sau khi fix ISS-001 + ISS-002 để verify.
 *
 *   cd backend
 *   npx tsx scripts/verify-fixes.ts
 *
 * In ra:
 *   - /api/auth/me departments là array
 *   - mgr-kttc thấy ≥1 help request từ nv-kttc-1
 */
import { createApp } from '../app.js';
import request from 'supertest';

const app = createApp();

async function login(username: string) {
  const r = await request(app).post('/api/auth/login').send({ username, password: '123456' });
  return r.body.token as string;
}

async function main() {
  // Test 1: /api/auth/me trả departments là array (ISS-001 fix)
  console.log('\n=== ISS-001 verify ===');
  const adminToken = await login('admin');
  const meR = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  const depts = meR.body.user.departments;
  console.log('  /api/auth/me departments:', depts);
  console.log('  Is array:', Array.isArray(depts));
  console.log('  Length:', depts.length);
  if (Array.isArray(depts) && depts.length === 4) {
    console.log('  ✅ ISS-001 FIXED');
  } else {
    console.log('  ❌ ISS-001 NOT FIXED');
    process.exit(1);
  }

  // Test 2: mgr-kttc thấy help request của nv-kttc-1 (ISS-002 fix)
  console.log('\n=== ISS-002 verify ===');
  const mgrToken = await login('mgr-kttc');
  const helpR = await request(app).get('/api/help-requests').set('Authorization', `Bearer ${mgrToken}`);
  console.log('  mgr-kttc sees help_requests count:', helpR.body.requests.length);
  const kttcSender = helpR.body.requests.find(
    (r: { sender_username: string }) => r.sender_username === 'nv-kttc-1',
  );
  if (kttcSender) {
    console.log('  ✅ ISS-002 FIXED — mgr-kttc thấy:', kttcSender.reason);
  } else {
    console.log('  ❌ ISS-002 NOT FIXED');
    process.exit(1);
  }

  console.log('\n🎉 Cả 2 bug đã fix!');
  process.exit(0);
}
main();
