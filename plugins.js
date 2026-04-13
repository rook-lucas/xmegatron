// plugins.js — Plugin marketplace API (file-based storage)
// Features: github username, verified badge, admin approval

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

function loadDB() {
    try {
        if (fs.existsSync(PLUGINS_FILE)) return JSON.parse(fs.readFileSync(PLUGINS_FILE, 'utf8'));
    } catch (_) {}
    return { approved: [], pending: [] };
}

function saveDB(d) {
    try { fs.writeFileSync(PLUGINS_FILE, JSON.stringify(d, null, 2)); }
    catch (e) { console.error('Plugins save error:', e.message); }
}

// GET /api/plugins
router.get('/', (req, res) => {
    const { sort, type } = req.query;
    const db = loadDB();
    let list = [...(db.approved || [])];
    if (type && type !== 'all') list = list.filter(p => p.type === type);
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'oldest') list.sort((a, b) => new Date(a.approved_at) - new Date(b.approved_at));
    else list.sort((a, b) => new Date(b.approved_at) - new Date(a.approved_at));
    res.json({ success: true, count: list.length, plugins: list });
});

// POST /api/plugins/submit
router.post('/submit', (req, res) => {
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

    const db = loadDB();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const plugin = {
        id,
        name: name.trim().slice(0, 60),
        description: description.trim().slice(0, 400),
        gist_url: gist_url.trim(),
        type: type.toLowerCase(),
        github: (github || '').trim().replace(/^@/, '').slice(0, 40),
        verified: false,
        status: 'pending',
        submitted_at: new Date().toISOString()
    };

    db.pending = db.pending || [];
    db.pending.unshift(plugin);
    saveDB(db);

    console.log(`📦 Plugin submitted: "${plugin.name}" by @${plugin.github || 'anonymous'}`);
    res.json({ success: true, message: 'Plugin submitted for review. Admin will approve shortly.' });
});

// GET /api/plugins/pending (admin)
router.get('/pending', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = loadDB();
    res.json({ success: true, count: (db.pending || []).length, plugins: db.pending || [] });
});

// POST /api/plugins/approve/:id (admin)
router.post('/approve/:id', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = loadDB();
    const idx = (db.pending || []).findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found in pending.' });
    const [plugin] = db.pending.splice(idx, 1);
    plugin.status = 'approved';
    plugin.approved_at = new Date().toISOString();
    db.approved = db.approved || [];
    db.approved.unshift(plugin);
    saveDB(db);
    console.log(`✅ Plugin approved: "${plugin.name}"`);
    res.json({ success: true, message: `"${plugin.name}" approved.` });
});

// POST /api/plugins/reject/:id (admin)
router.post('/reject/:id', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = loadDB();
    const idx = (db.pending || []).findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found.' });
    const [p] = db.pending.splice(idx, 1);
    saveDB(db);
    res.json({ success: true, message: `"${p.name}" rejected.` });
});

// PATCH /api/plugins/verify/:id (admin) — toggle verified badge
router.patch('/verify/:id', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const { verified } = req.body;
    const db = loadDB();
    const p = (db.approved || []).find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ success: false, error: 'Not found in approved.' });
    p.verified = !!verified;
    saveDB(db);
    res.json({ success: true, message: `"${p.name}" ${verified ? 'verified' : 'unverified'}.` });
});

// DELETE /api/plugins/:id (admin)
router.delete('/:id', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = loadDB();
    const before = (db.approved || []).length;
    db.approved = (db.approved || []).filter(p => p.id !== req.params.id);
    if (db.approved.length === before) return res.status(404).json({ success: false, error: 'Not found.' });
    saveDB(db);
    res.json({ success: true, message: 'Plugin deleted.' });
});

export default router;
