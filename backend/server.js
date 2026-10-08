/**
 * server.js — Express entry point.
 *
 * Khi chạy `node backend/server.js`:
 *   1. Bootstrap DB (tạo file + apply schema nếu mới)
 *   2. Mount routes (/api/auth, /api/users, /api/tier-items)
 *   3. CORS cho Vite dev server (localhost:5173)
 *   4. Listen trên PORT (mặc định 3000)
 *
 * Sau khi backend chạy, frontend gọi tới http://localhost:3000/api/*
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import './db.js'; // Trigger DB bootstrap (side-effect import)

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import tierItemRoutes from './routes/tierItems.js';
import deliverableRoutes from './routes/deliverables.js';
import subtaskRoutes from './routes/subtasks.js';
import teamLeadTaskRoutes from './routes/teamLeadTasks.js';
import employeeTaskRoutes from './routes/employeeTasks.js';
import helpRequestRoutes from './routes/helpRequests.js';
import historyRoutes from './routes/history.js';
import teamMemberRoutes from './routes/teamMembers.js';

const PORT = Number(process.env.PORT) || 3001;

const app = express();

// --- Middleware ---
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// Simple request logger
app.use((req, _res, next) => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tier-items', tierItemRoutes);
app.use('/api', deliverableRoutes);   // /tier-items/:id/deliverables, /deliverables/:id/*
app.use('/api', subtaskRoutes);       // /tier-items/:id/subtasks, /subtasks/:id/*, /subtasks/:id/logs
app.use('/api/team-tasks', teamLeadTaskRoutes);
app.use('/api/team-members', teamMemberRoutes);
app.use('/api/employee-tasks', employeeTaskRoutes);
app.use('/api/help-requests', helpRequestRoutes);
app.use('/api/history', historyRoutes);

// --- 404 ---
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Endpoint không tồn tại.' });
});

// --- Error handler (cuối cùng) ---
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'internal', message: 'Lỗi server không mong đợi.' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Backend ready: http://localhost:${PORT}`);
  console.log(`   Health:  GET  http://localhost:${PORT}/api/health`);
  console.log(`   Login:   POST http://localhost:${PORT}/api/auth/login`);
  console.log(`   CORS:    ${FRONTEND_ORIGIN}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});