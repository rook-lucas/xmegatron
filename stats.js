// stats.js — Real persistent stats: pair codes + QR scans
// Auto-creates ./data/stats.json on first run. Survives restarts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

// Displayed starting numbers (base offset)
export const BASE = { pair: 70, qr: 70 };

// ── Ensure data dir exists ───────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Load / Save ──────────────────────────────────────────────────
function load() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
  } catch (_) {}
  // Default starting state
  const fresh = { pair: 0, qr: 0, history: [] };
  fs.writeFileSync(STATS_FILE, JSON.stringify(fresh, null, 2));
  console.log('📊 stats.json created at', STATS_FILE);
  return fresh;
}

function save(data) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('❌ Stats save error:', e.message);
  }
}

// In-memory cache
let cache = load();

// ── Increment pair code ──────────────────────────────────────────
// Call this when pastebin upload succeeds in pair.js
export function incrementPair(phoneNumber = null) {
  cache.pair++;
  cache.history = cache.history || [];
  // Mask phone: show country code + last 4 digits only
  const masked = phoneNumber
    ? phoneNumber.replace(/(\d{1,3})(\d+)(\d{4})/, (_, cc, mid, last) =>
        cc + '*'.repeat(mid.length) + last)
    : '****';
  cache.history.unshift({
    type: 'pair',
    phone: masked,
    time: new Date().toISOString()
  });
  if (cache.history.length > 200) cache.history = cache.history.slice(0, 200);
  save(cache);
  console.log(`📊 Pair count: ${cache.pair} (${masked})`);
}

// ── Increment QR scan ────────────────────────────────────────────
// Call this when QR session connects and pastebin upload succeeds in qr.js
export function incrementQR() {
  cache.qr++;
  cache.history = cache.history || [];
  cache.history.unshift({
    type: 'qr',
    phone: 'QR Scan',
    time: new Date().toISOString()
  });
  if (cache.history.length > 200) cache.history = cache.history.slice(0, 200);
  save(cache);
  console.log(`📊 QR count: ${cache.qr}`);
}

// ── Public getter ────────────────────────────────────────────────
export function getStats() {
  return {
    pair:             cache.pair,
    qr:               cache.qr,
    total:            cache.pair + cache.qr,
    display_pair:     BASE.pair + cache.pair,
    display_qr:       BASE.qr  + cache.qr,
    display_total:    BASE.pair + cache.pair + BASE.qr + cache.qr,
    history:          (cache.history || []).slice(0, 30),
    last_updated:     new Date().toISOString()
  };
}
