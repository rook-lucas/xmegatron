// plugins.js — Plugin marketplace API
// Admin secret is set via ADMIN_SECRET env var (default: 'xmg-admin-2025')
//
// PUBLIC:
//   GET  /api/plugins              → list approved plugins (sort, filter)
//   POST /api/plugins/submit       → submit plugin for review
//
// ADMIN (require ?secret=ADMIN_SECRET header or query):
//   GET  /api/plugins/pending      → list pending submissions
//   POST /api/plugins/approve/:id  → approve a plugin
//   POST /api/plugins/reject/:id   → reject + delete a plugin
//   DELETE /api/plugins/:id        → delete any plugin

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR      = path.join(__dirname, 'data');
const PLUGINS_FILE  = path.join(DATA_DIR, 'plugins.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'xmg-admin-2025';

// CORS
router.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,x-admin-secret');
  next();
});
router.options('*', (_req, res) => res.sendStatus(200));

// ── Load / Save ──────────────────────────────────────────────────
function loadPlugins() {
  try {
    if (fs.existsSync(PLUGINS_FILE)) {
      return JSON.parse(fs.readFileSync(PLUGINS_FILE, 'utf8'));
    }
  } catch (_) {}
  return { approved: [], pending: [] };
}

function savePlugins(data) {
  try {
    fs.writeFileSync(PLUGINS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('❌ Plugins save error:', e.message);
  }
}

// ── Auth helper ──────────────────────────────────────────────────
function isAdmin(req) {
  const s = req.query.secret || req.headers['x-admin-secret'] || '';
  return s === ADMIN_SECRET;
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC: GET /api/plugins
// ?sort=newest|oldest|name   &type=utility|download|media|fun|group|general
// ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db    = loadPlugins();
  let list    = [...(db.approved || [])];
  const { sort, type } = req.query;

  if (type && type !== 'all') {
    list = list.filter(p => p.type?.toLowerCase() === type.toLowerCase());
  }

  if (sort === 'oldest') {
    list.sort((a, b) => new Date(a.approved_at) - new Date(b.approved_at));
  } else if (sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // default: newest first
    list.sort((a, b) => new Date(b.approved_at) - new Date(a.approved_at));
  }

  res.json({ success: true, count: list.length, plugins: list });
});

// ─────────────────────────────────────────────────────────────────
// PUBLIC: POST /api/plugins/submit
// Body: { name, description, gist_url, type }
// ─────────────────────────────────────────────────────────────────
router.post('/submit', (req, res) => {
  const { name, description, gist_url, type } = req.body;

  if (!name || !description || !gist_url || !type) {
    return res.status(400).json({ success: false, error: 'All fields required.' });
  }
  if (description.length < 10) {
    return res.status(400).json({ success: false, error: 'Description must be at least 10 characters.' });
  }
  if (!gist_url.startsWith('https://gist.github.com/') && !gist_url.startsWith('https://raw.githubusercontent.com/')) {
    return res.status(400).json({ success: false, error: 'Must be a valid GitHub Gist URL.' });
  }

  const db = loadPlugins();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const plugin = {
    id,
    name:        name.trim().slice(0, 60),
    description: description.trim().slice(0, 400),
    gist_url:    gist_url.trim(),
    type:        type.toLowerCase(),
    status:      'pending',
    submitted_at: new Date().toISOString()
  };

  db.pending = db.pending || [];
  db.pending.unshift(plugin);
  savePlugins(db);

  console.log(`📦 Plugin submitted: "${plugin.name}" (${plugin.type}) - pending review`);
  res.json({ success: true, message: 'Plugin submitted for review. Admin will approve shortly.' });
});

// ─────────────────────────────────────────────────────────────────
// ADMIN: GET /api/plugins/pending
// ─────────────────────────────────────────────────────────────────
router.get('/pending', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
  const db = loadPlugins();
  res.json({ success: true, count: (db.pending || []).length, plugins: db.pending || [] });
});

// ─────────────────────────────────────────────────────────────────
// ADMIN: POST /api/plugins/approve/:id
// ─────────────────────────────────────────────────────────────────
router.post('/approve/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });

  const db  = loadPlugins();
  const idx = (db.pending || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Plugin not found in pending list.' });

  const plugin = db.pending.splice(idx, 1)[0];
  plugin.status      = 'approved';
  plugin.approved_at = new Date().toISOString();
  db.approved = db.approved || [];
  db.approved.unshift(plugin);
  savePlugins(db);

  console.log(`✅ Plugin approved: "${plugin.name}"`);
  res.json({ success: true, message: `Plugin "${plugin.name}" approved.`, plugin });
});

// ─────────────────────────────────────────────────────────────────
// ADMIN: POST /api/plugins/reject/:id
// ─────────────────────────────────────────────────────────────────
router.post('/reject/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });

  const db  = loadPlugins();
  const idx = (db.pending || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Not found in pending.' });

  const [plugin] = db.pending.splice(idx, 1);
  savePlugins(db);
  res.json({ success: true, message: `Plugin "${plugin.name}" rejected and removed.` });
});

// ─────────────────────────────────────────────────────────────────
// ADMIN: DELETE /api/plugins/:id  (delete from approved)
// ─────────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });

  const db  = loadPlugins();
  const before = (db.approved || []).length;
  db.approved = (db.approved || []).filter(p => p.id !== req.params.id);
  if (db.approved.length === before) return res.status(404).json({ success: false, error: 'Plugin not found.' });
  savePlugins(db);
  res.json({ success: true, message: 'Plugin deleted.' });
});

export default router;
