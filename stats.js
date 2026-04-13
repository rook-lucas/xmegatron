// stats.js — File-based stats. Saves to data/stats.json. Survives restarts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function load() {
    try {
        if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    } catch (_) {}
    const fresh = { pair: 0, qr: 0, history: [] };
    fs.writeFileSync(STATS_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
}

function save(d) {
    try { fs.writeFileSync(STATS_FILE, JSON.stringify(d, null, 2)); }
    catch (e) { console.error('Stats save error:', e.message); }
}

let cache = load();

function maskPhone(p) {
    if (!p || p === 'QR Scan' || p === '—') return p;
    const s = String(p);
    if (s.length <= 6) return '****';
    return s.slice(0, 3) + '*'.repeat(Math.max(0, s.length - 7)) + s.slice(-4);
}

export async function incrementPair(phone, sessionId) {
    cache.pair++;
    cache.history = cache.history || [];
    cache.history.unshift({ type: 'pair', phone: phone || '—', sessionId: sessionId || '—', time: new Date().toISOString() });
    if (cache.history.length > 500) cache.history = cache.history.slice(0, 500);
    save(cache);
    console.log(`📊 Pair #${cache.pair} — ${phone}`);
}

export async function incrementQR(phone, sessionId) {
    cache.qr++;
    cache.history = cache.history || [];
    cache.history.unshift({ type: 'qr', phone: phone || 'QR Scan', sessionId: sessionId || '—', time: new Date().toISOString() });
    if (cache.history.length > 500) cache.history = cache.history.slice(0, 500);
    save(cache);
    console.log(`📊 QR #${cache.qr} — ${phone || 'unknown'}`);
}

// Public — masked phones
export function getStats() {
    return {
        pair: cache.pair,
        qr: cache.qr,
        total: cache.pair + cache.qr,
        history: (cache.history || []).slice(0, 30).map(h => ({ ...h, phone: maskPhone(h.phone) })),
        last_updated: new Date().toISOString()
    };
}

// Admin — full phones + session IDs
export function getAdminStats() {
    return {
        pair: cache.pair,
        qr: cache.qr,
        total: cache.pair + cache.qr,
        history: (cache.history || []).slice(0, 200),
        last_updated: new Date().toISOString()
    };
}
