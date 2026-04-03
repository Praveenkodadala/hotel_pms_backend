import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import cfg from './config/index.js';
import db from './db.js';
import { startSubscriptionJob } from './services/subscriptionJob.js';

// ✅ Import all routes (IMPORTANT: .js extension)
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import reservationRoutes from './routes/reservations.js';
import checkinRoutes from './routes/checkin.js';
import invoiceRoutes from './routes/invoices.js';
import rateRoutes from './routes/rates.js';
import channelRoutes from './routes/channels.js';
import housekeepingRoutes from './routes/housekeeping.js';
import dashboardRoutes from './routes/dashboard.js';
import hotelAdminRoutes from './routes/hotelAdmin.js';
import superAdminRoutes from './routes/superAdmin.js';

const app = express();

// ── CORS ────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(cfg.isProd ? 'combined' : 'dev'));

// ── Health ──────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', env: cfg.env, time: new Date() })
);

app.get('/ready', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    res.json({ status: 'ready', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'not ready', db: e.message });
  }
});

// ── Routes ──────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

app.use('/api/rooms', roomRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/rates', rateRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/housekeeping', housekeepingRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use('/api/admin', hotelAdminRoutes);
app.use('/api/super-admin', superAdminRoutes);

// ── 404 ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Error handler ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Unhandled error]', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// ── Start ───────────────────────────────────────────────────────
const PORT = cfg.server.port;

app.listen(PORT, () => {
  console.log(`\n🏨  Hotel PMS API — ${cfg.env.toUpperCase()}`);
  console.log(`    Port     : ${PORT}`);
  console.log(`    Frontend : ${cfg.server.frontendUrl}`);
  console.log(`    DB Host  : ${cfg.db.host}:${cfg.db.port}/${cfg.db.name}`);
  console.log(`    GST Rate : ${cfg.gst.roomRate}%\n`);

  startSubscriptionJob();
});

// ❌ REMOVE THIS (NOT NEEDED IN ESM)
// module.exports = app;