// ╔══════════════════════════════════════════════════════╗
// ║         X MEGATRON — Single Server                   ║
// ║  One port, all pages, all APIs                       ║
// ╚══════════════════════════════════════════════════════╝

import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import { EventEmitter } from 'events';

import { getStats }   from './stats.js';
import pairRouter     from './pair.js';
import qrRouter       from './qr.js';
import pluginsRouter  from './plugins.js';

EventEmitter.defaultMaxListeners = 500;

const app  = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUBLIC     = path.join(__dirname, 'public');

// ── Optional Telegram bot ─────────────────────────────────────────
if (process.env.BOT_TOKEN) {
  import('./bot.js')
    .then(({ bot, notifySessionSuccess }) => {
      global.telegramBot          = bot;
      global.notifySessionSuccess = notifySessionSuccess;
      console.log('✅ Telegram bot running');
    })
    .catch(e => console.error('❌ Bot error:', e.message));
} else {
  console.log('ℹ️  No BOT_TOKEN — Telegram bot disabled');
}

// ── Middleware ────────────────────────────────────────────────────
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from /public
app.use(express.static(PUBLIC));

// ── PAGE ROUTES ───────────────────────────────────────────────────
// GET /          → main landing page
// GET /session   → WhatsApp session linker (pair.html)
// GET /plugins   → plugin marketplace
// GET /admin     → admin panel (password protected client-side)

app.get('/',        (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/session', (_req, res) => res.sendFile(path.join(PUBLIC, 'session.html')));
app.get('/plugins', (_req, res) => res.sendFile(path.join(PUBLIC, 'plugins.html')));
app.get('/admin',   (_req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));

// ── WHATSAPP SESSION API ──────────────────────────────────────────
app.use('/pair', pairRouter);
app.use('/qr',   qrRouter);

// Session ready store
if (!global._sessionReady) global._sessionReady = {};
app.get('/session-status', (req, res) => {
  const { token } = req.query;
  if (token && global._sessionReady[token]) {
    const { sessionId } = global._sessionReady[token];
    delete global._sessionReady[token];
    return res.json({ ready: true, sessionId });
  }
  res.json({ ready: false });
});

// ── STATS API ─────────────────────────────────────────────────────
// GET /api/stats
// Returns: { display_pair, display_qr, display_total, history, last_updated }
app.get('/api/stats', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.json(getStats());
});

// ── PLUGINS API ───────────────────────────────────────────────────
// Public:  GET  /api/plugins              → approved list
//          POST /api/plugins/submit        → submit for review
// Admin:   GET  /api/plugins/pending       → pending list
//          POST /api/plugins/approve/:id   → approve
//          POST /api/plugins/reject/:id    → reject
//          DELETE /api/plugins/:id         → delete
app.use('/api/plugins', pluginsRouter);

// ── START ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║       X MEGATRON SERVER ONLINE       ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\n  🌐  http://localhost:${PORT}`);
  console.log(`  🔑  http://localhost:${PORT}/session`);
  console.log(`  🧩  http://localhost:${PORT}/plugins`);
  console.log(`  ⚙️   http://localhost:${PORT}/admin`);
  console.log(`  📊  http://localhost:${PORT}/api/stats`);
  console.log(`\n  Admin secret: ${process.env.ADMIN_SECRET || 'xmg-admin-2025'}`);
  console.log('  (set ADMIN_SECRET env var to change)\n');
});

export default app;
