import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR     = path.join(__dirname, 'data');
const PLUGINS_FILE = path.join(DATA_DIR, 'plugins.json');
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'xmg-admin-2025';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

router.use((_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type,x-admin-secret');
    next();
});
router.options('*', (_req, res) => res.sendStatus(200));

function admin(req) {
    return (req.query.secret || req.headers['x-admin-secret'] || '') === ADMIN_SECRET;
}
function load() {
    try { if (fs.existsSync(PLUGINS_FILE)) return JSON.parse(fs.readFileSync(PLUGINS_FILE, 'utf8')); }
    catch (_) {}
    return { approved: [], pending: [] };
}
function save(d) {
    try { fs.writeFileSync(PLUGINS_FILE, JSON.stringify(d, null, 2)); }
    catch (e) { console.error('Plugins save error:', e.message); }
}

// GET /api/plugins
router.get('/', (req, res) => {
    const { sort, type } = req.query;
    const db = load();
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
    if (!name || !description || !gist_url || !type)
        return res.status(400).json({ success: false, error: 'All fields are required.' });
    if (description.length < 10)
        return res.status(400).json({ success: false, error: 'Description must be at least 10 characters.' });
    if (!gist_url.startsWith('https://gist.github.com/') && !gist_url.startsWith('https://raw.githubusercontent.com/'))
        return res.status(400).json({ success: false, error: 'Must be a valid GitHub Gist URL.' });

    const db = load();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    db.pending = db.pending || [];
    db.pending.unshift({
        id,
        name:        name.trim().slice(0, 60),
        description: description.trim().slice(0, 400),
        gist_url:    gist_url.trim(),
        type:        type.toLowerCase(),
        github:      (github || '').trim().replace(/^@/, '').slice(0, 40),
        verified:    false,
        status:      'pending',
        submitted_at: new Date().toISOString()
    });
    save(db);
    console.log(`📦 Plugin submitted: "${name}" by @${github || 'anonymous'}`);
    res.json({ success: true, message: 'Submitted! Admin will review shortly.' });
});

// GET /api/plugins/pending (admin)
router.get('/pending', (req, res) => {
    if (!admin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = load();
    res.json({ success: true, count: (db.pending || []).length, plugins: db.pending || [] });
});

// POST /api/plugins/approve/:id (admin)
router.post('/approve/:id', (req, res) => {
    if (!admin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = load();
    const idx = (db.pending || []).findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found.' });
    const [p] = db.pending.splice(idx, 1);
    p.status = 'approved'; p.approved_at = new Date().toISOString();
    db.approved = db.approved || []; db.approved.unshift(p);
    save(db);
    res.json({ success: true, message: `"${p.name}" approved.` });
});

// POST /api/plugins/reject/:id (admin)
router.post('/reject/:id', (req, res) => {
    if (!admin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = load();
    const idx = (db.pending || []).findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found.' });
    const [p] = db.pending.splice(idx, 1);
    save(db);
    res.json({ success: true, message: `"${p.name}" rejected.` });
});

// PATCH /api/plugins/verify/:id (admin) — toggle verified badge
router.patch('/verify/:id', (req, res) => {
    if (!admin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = load();
    const p = (db.approved || []).find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ success: false, error: 'Not found.' });
    p.verified = !!req.body.verified;
    save(db);
    res.json({ success: true, message: `"${p.name}" ${p.verified ? 'verified ✓' : 'unverified'}.` });
});

// DELETE /api/plugins/:id (admin)
router.delete('/:id', (req, res) => {
    if (!admin(req)) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const db = load();
    const before = (db.approved || []).length;
    db.approved = (db.approved || []).filter(p => p.id !== req.params.id);
    if (db.approved.length === before) return res.status(404).json({ success: false, error: 'Not found.' });
    save(db);
    res.json({ success: true, message: 'Deleted.' });
});

export default router;
