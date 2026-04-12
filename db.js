// db.js — MongoDB multi-URI connection manager
// Tries DATABASE_URI → DATABASE_URI_2 → ... → DATABASE_URI_5 in order.
// Falls back to local JSON files if all fail.

import mongoose from 'mongoose';

const URIS = [
  process.env.DATABASE_URI,
  process.env.DATABASE_URI_2,
  process.env.DATABASE_URI_3,
  process.env.DATABASE_URI_4,
  process.env.DATABASE_URI_5,
].filter(Boolean);

// ── SCHEMAS ──────────────────────────────────────────────────────

const SessionEventSchema = new mongoose.Schema({
  type:      { type: String, enum: ['pair', 'qr'], required: true },
  phone:     { type: String, default: '—' },
  sessionId: { type: String, default: '—' },
  time:      { type: Date,   default: Date.now },
}, { timestamps: false });

const StatsSchema = new mongoose.Schema({
  _id:  { type: String, default: 'global' },
  pair: { type: Number, default: 0 },
  qr:   { type: Number, default: 0 },
}, { timestamps: false });

const PluginSchema = new mongoose.Schema({
  name:        { type: String, required: true, maxlength: 60 },
  description: { type: String, required: true, maxlength: 400 },
  gist_url:    { type: String, required: true },
  type:        { type: String, default: 'general' },
  github:      { type: String, default: '' },     // submitter GitHub username
  verified:    { type: Boolean, default: false },  // admin can verify
  status:      { type: String, enum: ['pending', 'approved'], default: 'pending' },
  submitted_at:{ type: Date, default: Date.now },
  approved_at: { type: Date },
}, { timestamps: false });

// ── MODELS (lazy — only created after connection) ─────────────────
export let SessionEvent = null;
export let Stats        = null;
export let Plugin       = null;

let connected = false;
let usingMongo = false;
let activeUri = null;

export function isMongoConnected() { return connected && usingMongo; }
export function getActiveUri() { return activeUri; }

// ── CONNECT ───────────────────────────────────────────────────────
export async function connectDB() {
  if (!URIS.length) {
    console.log('ℹ️  No DATABASE_URI set — using local JSON files');
    return false;
  }

  for (let i = 0; i < URIS.length; i++) {
    const uri = URIS[i];
    const label = i === 0 ? 'DATABASE_URI' : `DATABASE_URI_${i + 1}`;
    try {
      console.log(`🔌 Trying ${label}…`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 6000,
        connectTimeoutMS: 8000,
        socketTimeoutMS: 30000,
      });

      // Create models on first successful connection
      SessionEvent = mongoose.model('SessionEvent', SessionEventSchema);
      Stats        = mongoose.model('Stats', StatsSchema);
      Plugin       = mongoose.model('Plugin', PluginSchema);

      // Ensure global stats doc exists
      await Stats.findOneAndUpdate(
        { _id: 'global' },
        { $setOnInsert: { pair: 0, qr: 0 } },
        { upsert: true, new: true }
      );

      connected  = true;
      usingMongo = true;
      activeUri  = label;
      console.log(`✅ MongoDB connected via ${label}`);

      // Reconnect on disconnect
      mongoose.connection.on('disconnected', () => {
        console.warn(`⚠️  MongoDB disconnected (${label}), reconnecting…`);
        connected = false;
        setTimeout(connectDB, 5000);
      });

      return true;
    } catch (err) {
      console.warn(`❌ ${label} failed: ${err.message}`);
    }
  }

  console.warn('⚠️  All MongoDB URIs failed — falling back to local JSON');
  return false;
}
