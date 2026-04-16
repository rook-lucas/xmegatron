import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import { EventEmitter } from 'events';

import pairRouter   from './pair.js';
import qrRouter     from './qr.js';
import pluginsRouter from './plugins.js';
import { getStats, getAdminStats } from './stats.js';

EventEmitter.defaultMaxListeners = 500;

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'xmg-admin-2025';
const PUBLIC = path.join(__dirname, 'public');

// Optional Telegram bot
import('./bot.js').then(({ bot, notifySessionSuccess }) => {
    global.telegramBot          = bot;
    global.notifySessionSuccess = notifySessionSuccess;
    console.log('✅ Telegram bot initialized');
}).catch(err => {
    console.error('❌ Telegram bot disabled:', err.message);
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve public folder (index.html, session.html, plugins.html, admin.html)
app.use(express.static(PUBLIC));

// Also serve root-level files (pair.html if someone links to it directly)
app.use(express.static(__dirname));

// ── Pages ────────────────────────────────────────────────────────
app.get('/',        (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/session', (_req, res) => res.sendFile(path.join(PUBLIC, 'session.html')));
app.get('/plugins', (_req, res) => res.sendFile(path.join(PUBLIC, 'plugins.html')));
app.get('/admin',   (_req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));

// ── WhatsApp Session ──────────────────────────────────────────────
app.use('/pair', pairRouter);
app.use('/qr',   qrRouter);

// Unified session-status fallback
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

// ── Stats ─────────────────────────────────────────────────────────
app.get('/api/stats', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(getStats());
});

app.get('/api/admin-stats', (req, res) => {
    const secret = req.query.secret || req.headers['x-admin-secret'] || '';
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    res.set('Access-Control-Allow-Origin', '*');
    res.json(getAdminStats());
});

// ── Plugins ───────────────────────────────────────────────────────
app.use('/api/plugins', pluginsRouter);

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\nYouTube: @codlucasox\nGitHub:  @COD-LUCAS`);
    console.log(`Server:  http://localhost:${PORT}`);
    console.log(`Admin:   ${ADMIN_SECRET}\n`);
});

export default app;
