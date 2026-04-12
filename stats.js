// stats.js — MongoDB primary, JSON fallback. Counts start from 0.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMongoConnected, SessionEvent, Stats } from './db.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON() {
  try { if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch (_) {}
  const fresh = { pair: 0, qr: 0, history: [] };
  fs.writeFileSync(STATS_FILE, JSON.stringify(fresh, null, 2));
  return fresh;
}
function saveJSON(d) {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(d, null, 2)); }
  catch (e) { console.error('JSON save error:', e.message); }
}

let cache = loadJSON();

function maskPhone(p) {
  if (!p || p === 'QR Scan' || p === '—') return p;
  const s = String(p);
  if (s.length <= 6) return '****';
  return s.slice(0,2) + '*'.repeat(Math.max(0,s.length-6)) + s.slice(-4);
}

async function jsonSave(type, phone, sessionId) {
  const entry = { type, phone: phone||'—', sessionId: sessionId||'—', time: new Date().toISOString() };
  if (type === 'pair') cache.pair++; else cache.qr++;
  cache.history = cache.history || [];
  cache.history.unshift(entry);
  if (cache.history.length > 500) cache.history = cache.history.slice(0, 500);
  saveJSON(cache);
}

export async function incrementPair(phone, sessionId) {
  console.log(`📊 Pair — ${phone}`);
  if (isMongoConnected()) {
    try {
      await Promise.all([
        Stats.findOneAndUpdate({ _id: 'global' }, { $inc: { pair: 1 } }, { upsert: true }),
        SessionEvent.create({ type:'pair', phone: phone||'—', sessionId: sessionId||'—' }),
      ]);
      return;
    } catch (e) { console.error('Mongo pair error:', e.message); }
  }
  await jsonSave('pair', phone, sessionId);
}

export async function incrementQR(phone, sessionId) {
  console.log(`📊 QR — ${phone||'unknown'}`);
  if (isMongoConnected()) {
    try {
      await Promise.all([
        Stats.findOneAndUpdate({ _id: 'global' }, { $inc: { qr: 1 } }, { upsert: true }),
        SessionEvent.create({ type:'qr', phone: phone||'QR Scan', sessionId: sessionId||'—' }),
      ]);
      return;
    } catch (e) { console.error('Mongo QR error:', e.message); }
  }
  await jsonSave('qr', phone, sessionId);
}

async function counts() {
  if (isMongoConnected()) {
    try { const d = await Stats.findById('global').lean(); return { pair: d?.pair||0, qr: d?.qr||0 }; }
    catch (_) {}
  }
  return { pair: cache.pair, qr: cache.qr };
}

async function history(limit) {
  if (isMongoConnected()) {
    try { return await SessionEvent.find().sort({ time:-1 }).limit(limit).lean(); }
    catch (_) {}
  }
  return (cache.history||[]).slice(0, limit);
}

export async function getStats() {
  const { pair, qr } = await counts();
  const hist = await history(30);
  return { pair, qr, total: pair+qr, display_pair: pair, display_qr: qr, display_total: pair+qr,
    history: hist.map(h=>({...h, phone: maskPhone(h.phone)})),
    last_updated: new Date().toISOString(), storage: isMongoConnected()?'mongodb':'json' };
}

export async function getAdminStats() {
  const { pair, qr } = await counts();
  const hist = await history(200);
  return { pair, qr, total: pair+qr, display_pair: pair, display_qr: qr, display_total: pair+qr,
    history: hist,
    last_updated: new Date().toISOString(), storage: isMongoConnected()?'mongodb':'json' };
}
