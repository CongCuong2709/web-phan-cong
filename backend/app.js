/**
 * app.js — Express app factory.
 *
 * Tách ra từ server.js để:
 *   - Test có thể import app (không cần gọi listen)
 *   - Production chỉ cần `createApp().listen(...)`
 *
 * Tất cả middleware, routes, error handler đều ở đây.
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

/**
 * Tạo Express app instance. Tái sử dụng được cho cả prod và test.
 */
export function createApp() {
  const app = express();

  // --- Middleware ---
  app.use(cors({
    origin: true,
    credentials: true,
  }));
  app.use(express.json({ limit: '2mb' }));

  // Simple request logger (suppress in test)
  if (process.env.NODE_ENV !== 'test') {
    app.use((req, _res, next) => {
      const ts = new Date().toISOString().slice(11, 19);
      console.log(`[${ts}] ${req.method} ${req.path}`);
      next();
    });
  }

  // --- Health check ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // --- Routes ---
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/tier-items', tierItemRoutes);
  app.use('/api', deliverableRoutes);
  app.use('/api', subtaskRoutes);
  app.use('/api/team-tasks', teamLeadTaskRoutes);
  app.use('/api/team-members', teamMemberRoutes);
  app.use('/api/employee-tasks', employeeTaskRoutes);
  app.use('/api/help-requests', helpRequestRoutes);
  app.use('/api/history', historyRoutes);

  // --- 404 ---
  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Endpoint không tồn tại.' });
  });

  // --- Error handler ---
  app.use((err, _req, res, _next) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({ error: 'internal', message: 'Lỗi server không mong đợi.' });
  });

  return app;
}
