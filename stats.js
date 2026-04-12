// stats.js — Persistent stats in data/stats.json
// Full phone stored for admin. Masked for public API.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

export const BASE = { pair: 70, qr: 70 };

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
  return s.slice(0, 2) + '*'.repeat(s.length - 6) + s.slice(-4);
}

// Call from pair.js when pastebin upload succeeds
export function incrementPair(phone = null, sessionId = null) {
  cache.pair++;
  cache.history = cache.history || [];
  cache.history.unshift({ type: 'pair', phone: phone || '—', sessionId: sessionId || '—', time: new Date().toISOString() });
  if (cache.history.length > 500) cache.history = cache.history.slice(0, 500);
  save(cache);
  console.log(`📊 Pair #${cache.pair} — ${phone}`);
}

// Call from qr.js when QR session connects + pastebin succeeds
export function incrementQR(phone = null, sessionId = null) {
  cache.qr++;
  cache.history = cache.history || [];
  cache.history.unshift({ type: 'qr', phone: phone || 'QR Scan', sessionId: sessionId || '—', time: new Date().toISOString() });
  if (cache.history.length > 500) cache.history = cache.history.slice(0, 500);
  save(cache);
  console.log(`📊 QR #${cache.qr} — ${phone || 'unknown'}`);
}

// Public API — phones masked
export function getStats() {
  return {
    pair: cache.pair, qr: cache.qr, total: cache.pair + cache.qr,
    display_pair: BASE.pair + cache.pair, display_qr: BASE.qr + cache.qr,
    display_total: BASE.pair + cache.pair + BASE.qr + cache.qr,
    history: (cache.history || []).slice(0, 30).map(h => ({ ...h, phone: maskPhone(h.phone) })),
    last_updated: new Date().toISOString()
  };
}

// Admin API — full phones + session IDs
export function getAdminStats() {
  return {
    pair: cache.pair, qr: cache.qr, total: cache.pair + cache.qr,
    display_pair: BASE.pair + cache.pair, display_qr: BASE.qr + cache.qr,
    display_total: BASE.pair + cache.pair + BASE.qr + cache.qr,
    history: (cache.history || []).slice(0, 200),
    last_updated: new Date().toISOString()
  };
}
