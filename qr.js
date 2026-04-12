import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
  makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore,
  Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fetch from 'node-fetch';
import { incrementQR } from './stats.js';

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
  try { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
  catch (e) { console.error('Cleanup error:', e.message); }
}

router.get('/', async (req, res) => {
  const token = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const dir   = `./temp_qr_sessions/session_${token}`;
  fs.mkdirSync(dir, { recursive: true });

  async function initiateSession() {
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    try {
      const { version } = await fetchLatestBaileysVersion();
      let qrDone = false, sent = false;

      const handleQR = async (qr) => {
        if (qrDone || sent) return;
        qrDone = true;
        try {
          const qrDataURL = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M', type: 'image/png', quality: 0.92,
            margin: 1, color: { dark: '#000000', light: '#FFFFFF' }
          });
          if (!sent) {
            sent = true;
            res.json({ qr: qrDataURL, token, instructions: ['1. Open WhatsApp','2. Settings → Linked Devices','3. Tap "Link a Device"','4. Scan the QR code'] });
          }
        } catch (e) {
          if (!sent) { sent = true; res.status(500).json({ code: 'QR generation failed' }); }
        }
      };

      const cfg = {
        version, logger: pino({ level: 'silent' }), browser: Browsers.windows('Chrome'),
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })) },
        markOnlineOnConnect: false, generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000, connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000, retryRequestDelayMs: 250, maxRetries: 5,
      };

      let sock = makeWASocket(cfg);
      let retries = 0;

      const onUpdate = async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr && !qrDone) await handleQR(qr);

        if (connection === 'open') {
          console.log('✅ QR session connected!');
          try {
            const sessionContent = fs.readFileSync(dir + '/creds.json', 'utf8');
            const pb = await uploadToPastebin(sessionContent, `MEG4TRON QR - ${token}`);

            if (pb.success) {
              const sessionId = `xmegatron~${pb.id}`;

              const meId = sock.authState.creds?.me?.id || null;
              const userJid = meId ? jidNormalizedUser(meId) : null;

              const rawPhone = meId ? meId.split('@')[0].split(':')[0] : null;
              const displayPhone = rawPhone ? '+' + rawPhone : 'QR User';

              if (userJid) {
                await sock.sendMessage(userJid, { text: sessionId });
                await sock.sendMessage(userJid, {
                  text: ` _Note ⚠️_

_This bot is under developing stage only may cause some bugs and some issues to valuable users so kindly inform me through telegram channel.
_Uptodate Update to get new features_

_Report Bugs 🪲 Here:-_

_TELEGRAM:_ _https://t.me/xmegatronwha_

_THANKS FOR CHOOSING *X-MEGATRON*_`
                });
              } // ✅ FIXED: missing bracket added here

              incrementQR(displayPhone, sessionId);

              global._sessionReady[token] = { sessionId, ts: Date.now() };
              if (global.notifySessionSuccess) {
                try { await global.notifySessionSuccess(null, sessionId); } catch (_) {}
              }

            } else {
              console.error('❌ Pastebin failed:', pb.error);
            }
          } catch (err) {
            console.error('QR open error:', err);
          }
          setTimeout(() => cleanupDir(dir), 15000);
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === 401) { cleanupDir(dir); }
          else if ([515, 503].includes(code)) {
            if (++retries <= 3) {
              setTimeout(() => {
                sock = makeWASocket(cfg);
                sock.ev.on('connection.update', onUpdate);
                sock.ev.on('creds.update', saveCreds);
              }, 2000);
            } else {
              cleanupDir(dir);
              if (!sent) { sent = true; res.status(503).json({ code: 'Connection failed' }); }
            }
          }
        }
      };

      sock.ev.on('connection.update', onUpdate);
      sock.ev.on('creds.update', saveCreds);

      setTimeout(() => {
        if (!sent) { sent = true; res.status(408).json({ code: 'QR timeout. Try again.' }); cleanupDir(dir); }
      }, 30000);

    } catch (err) {
      console.error('QR init error:', err);
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
