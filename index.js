import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import { EventEmitter } from 'events';
import { connectDB, getActiveUri } from './db.js';
import { getStats, getAdminStats } from './stats.js';
import pairRouter    from './pair.js';
import qrRouter      from './qr.js';
import pluginsRouter from './plugins.js';

EventEmitter.defaultMaxListeners = 500;

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'xmg-admin-2025';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUBLIC     = path.join(__dirname, 'public');

// ── Connect DB first, then start everything ───────────────────────
await connectDB();

// ── Optional Telegram bot ─────────────────────────────────────────
if (process.env.BOT_TOKEN) {
  import('./bot.js').then(({ bot, notifySessionSuccess }) => {
    global.telegramBot          = bot;
    global.notifySessionSuccess = notifySessionSuccess;
    console.log('✅ Telegram bot running');
  }).catch(e => console.error('❌ Bot error:', e.message));
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(PUBLIC));

// Pages
app.get('/',        (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/session', (_req, res) => res.sendFile(path.join(PUBLIC, 'session.html')));
app.get('/plugins', (_req, res) => res.sendFile(path.join(PUBLIC, 'plugins.html')));
app.get('/admin',   (_req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));

// WhatsApp session
app.use('/pair', pairRouter);
app.use('/qr',   qrRouter);
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

// Public stats (phones masked)
app.get('/api/stats', async (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.json(await getStats());
});

// Admin stats — full phones + session IDs
app.get('/api/admin-stats', async (req, res) => {
  const secret = req.query.secret || req.headers['x-admin-secret'] || '';
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
  res.set('Access-Control-Allow-Origin', '*');
  res.json(await getAdminStats());
});

// Health / debug info
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', storage: getActiveUri() || 'json', port: PORT, ts: new Date().toISOString() });
});

// Plugins
app.use('/api/plugins', pluginsRouter);

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║    X MEGATRON SERVER ONLINE ✓        ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  🔑  http://localhost:${PORT}/session`);
  console.log(`  🧩  http://localhost:${PORT}/plugins`);
  console.log(`  ⚙️   http://localhost:${PORT}/admin`);
  console.log(`  📊  http://localhost:${PORT}/api/stats`);
  console.log(`  💾  Storage: ${getActiveUri() || 'JSON files'}`);
  console.log(`  🔐  Admin secret: ${ADMIN_SECRET}\n`);
});

export default app;
