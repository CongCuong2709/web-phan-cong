import { createApp } from '../app.js';
import request from 'supertest';

const app = createApp();

async function main() {
  const login = await request(app).post('/api/auth/login').send({ username: 'mgr-kttc', password: '123456' });
  const token = login.body.token;
  const r = await request(app).get('/api/help-requests').set('Authorization', `Bearer ${token}`);
  console.log('mgr-kttc sees help_requests count:', r.body.requests.length);
  for (const req of r.body.requests) {
    console.log('  id=' + req.id, 'sender_username=' + req.sender_username, 'status=' + req.status);
  }
  process.exit(0);
}
main();
