// plugins.js — Plugin API with MongoDB + JSON fallback
// Includes: github username, verified badge, creator display

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMongoConnected, Plugin } from './db.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR     = path.join(__dirname, 'data');
const PLUGINS_FILE = path.join(DATA_DIR, 'plugins.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'xmg-admin-2025';

router.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,x-admin-secret');
  next();
});
router.options('*', (_req, res) => res.sendStatus(200));

function isAdmin(req) {
  return (req.query.secret || req.headers['x-admin-secret'] || '') === ADMIN_SECRET;
}

// ── JSON fallback helpers ─────────────────────────────────────────
function loadJSON() {
  try { if (fs.existsSync(PLUGINS_FILE)) return JSON.parse(fs.readFileSync(PLUGINS_FILE, 'utf8')); }
  catch (_) {}
  return { approved: [], pending: [] };
}
function saveJSON(d) {
  try { fs.writeFileSync(PLUGINS_FILE, JSON.stringify(d, null, 2)); }
  catch (e) { console.error('Plugins JSON save error:', e.message); }
}

// ── GET /api/plugins ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { sort, type } = req.query;
  try {
    if (isMongoConnected()) {
      let q = Plugin.find({ status: 'approved' });
      if (type && type !== 'all') q = q.where('type').equals(type);
      if (sort === 'name') q = q.sort({ name: 1 });
      else if (sort === 'oldest') q = q.sort({ approved_at: 1 });
      else q = q.sort({ approved_at: -1 });
      const list = await q.lean();
      return res.json({ success: true, count: list.length, plugins: list });
    }
  } catch (e) { console.error('Get plugins error:', e.message); }

  // JSON fallback
  const db = loadJSON();
  let list = [...(db.approved || [])];
  if (type && type !== 'all') list = list.filter(p => p.type === type);
  if (sort === 'name') list.sort((a,b) => a.name.localeCompare(b.name));
  else if (sort === 'oldest') list.sort((a,b) => new Date(a.approved_at)-new Date(b.approved_at));
  else list.sort((a,b) => new Date(b.approved_at)-new Date(a.approved_at));
  res.json({ success: true, count: list.length, plugins: list });
});

// ── POST /api/plugins/submit ─────────────────────────────────────
router.post('/submit', async (req, res) => {
  const { name, description, gist_url, type, github } = req.body;

  if (!name || !description || !gist_url || !type) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }
  if (description.length < 10) {
    return res.status(400).json({ success: false, error: 'Description must be at least 10 characters.' });
  }
  if (!gist_url.startsWith('https://gist.github.com/') && !gist_url.startsWith('https://raw.githubusercontent.com/')) {
    return res.status(400).json({ success: false, error: 'Must be a valid GitHub Gist URL.' });
  }

  const data = {
    name: name.trim().slice(0,60),
    description: description.trim().slice(0,400),
    gist_url: gist_url.trim(),
    type: type.toLowerCase(),
    github: (github||'').trim().replace(/^@/,'').slice(0,40),
    verified: false,
    status: 'pending',
    submitted_at: new Date(),
  };

  try {
    if (isMongoConnected()) {
      const doc = await Plugin.create(data);
      console.log(`📦 Plugin submitted: "${data.name}" by @${data.github||'anon'}`);
      return res.json({ success: true, message: 'Submitted for review!', id: doc._id });
    }
  } catch (e) { console.error('Submit plugin error:', e.message); }

  // JSON fallback
  const db = loadJSON();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  db.pending = db.pending || [];
  db.pending.unshift({ ...data, id, submitted_at: new Date().toISOString() });
  saveJSON(db);
  console.log(`📦 [JSON] Plugin submitted: "${data.name}"`);
  res.json({ success: true, message: 'Submitted for review!' });
});

// ── GET /api/plugins/pending (admin) ─────────────────────────────
router.get('/pending', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
  try {
    if (isMongoConnected()) {
      const list = await Plugin.find({ status: 'pending' }).sort({ submitted_at: -1 }).lean();
      return res.json({ success: true, count: list.length, plugins: list });
    }
  } catch (e) { console.error('Pending plugins error:', e.message); }
  const db = loadJSON();
  res.json({ success: true, count: (db.pending||[]).length, plugins: db.pending||[] });
});

// ── POST /api/plugins/approve/:id (admin) ────────────────────────
router.post('/approve/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
  try {
    if (isMongoConnected()) {
      const doc = await Plugin.findByIdAndUpdate(req.params.id,
        { status: 'approved', approved_at: new Date() }, { new: true });
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      console.log(`✅ Plugin approved: "${doc.name}"`);
      return res.json({ success: true, message: `"${doc.name}" approved.` });
    }
  } catch (e) { console.error('Approve error:', e.message); }
  // JSON fallback
  const db = loadJSON();
  const idx = (db.pending||[]).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Not found in pending.' });
  const [plugin] = db.pending.splice(idx, 1);
  plugin.status = 'approved'; plugin.approved_at = new Date().toISOString();
  db.approved = db.approved || []; db.approved.unshift(plugin);
  saveJSON(db);
  res.json({ success: true, message: `"${plugin.name}" approved.` });
});

// ── POST /api/plugins/reject/:id (admin) ─────────────────────────
router.post('/reject/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
  try {
    if (isMongoConnected()) {
      const doc = await Plugin.findByIdAndDelete(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({ success: true, message: `"${doc.name}" rejected.` });
    }
  } catch (e) { console.error('Reject error:', e.message); }
  const db = loadJSON();
  const idx = (db.pending||[]).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Not found.' });
  const [p] = db.pending.splice(idx, 1);
  saveJSON(db);
  res.json({ success: true, message: `"${p.name}" rejected.` });
});

// ── PATCH /api/plugins/verify/:id (admin) ────────────────────────
router.patch('/verify/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
  const { verified } = req.body;
  try {
    if (isMongoConnected()) {
      const doc = await Plugin.findByIdAndUpdate(req.params.id, { verified: !!verified }, { new: true });
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({ success: true, message: `"${doc.name}" ${verified?'verified':'unverified'}.` });
    }
  } catch (e) { console.error('Verify error:', e.message); }
  // JSON fallback
  const db = loadJSON();
  const p = (db.approved||[]).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: 'Not found in approved.' });
  p.verified = !!verified; saveJSON(db);
  res.json({ success: true, message: `"${p.name}" ${verified?'verified':'unverified'}.` });
});

// ── DELETE /api/plugins/:id (admin) ──────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
  try {
    if (isMongoConnected()) {
      const doc = await Plugin.findByIdAndDelete(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({ success: true, message: 'Plugin deleted.' });
    }
  } catch (e) { console.error('Delete error:', e.message); }
  const db = loadJSON();
  const before = (db.approved||[]).length;
  db.approved = (db.approved||[]).filter(p => p.id !== req.params.id);
  if (db.approved.length === before) return res.status(404).json({ success: false, error: 'Not found.' });
  saveJSON(db);
  res.json({ success: true, message: 'Deleted.' });
});

export default router;
