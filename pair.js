import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
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
            api_dev_key: PASTEBIN_API_KEY,
            api_option: 'paste',
            api_paste_code: content,
            api_paste_name: title,
            api_paste_private: '1',
            api_paste_expire_date: 'N'
        });
        const response = await fetch(PASTEBIN_API_URL, {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const result = await response.text();
        if (result.startsWith('https://pastebin.com/')) {
            const pasteId = result.split('/').pop().trim();
            return { success: true, url: result.trim(), id: pasteId };
        }
        return { success: false, error: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    const sessionToken = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    let dirs = './temp_sessions/' + sessionToken;

    if (!fs.existsSync('./temp_sessions')) {
        fs.mkdirSync('./temp_sessions', { recursive: true });
    }

    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({
                code: 'Invalid phone number. Enter full international format without + or spaces.'
            });
        }
        return;
    }

    num = phone.getNumber('e164').replace('+', '');
    const displayPhone = '+' + num;

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            let KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
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

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log('✅ Connected successfully!');
                    try {
                        const sessionContent = fs.readFileSync(dirs + '/creds.json', 'utf8');
                        const pastebinResult = await uploadToPastebin(sessionContent, `MEG4TRON Session - ${displayPhone}`);

                        if (pastebinResult.success) {
                            const customCode = `xmegatron~${pastebinResult.id}`;
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                            await KnightBot.sendMessage(userJid, { text: customCode });
                            await KnightBot.sendMessage(userJid, {
                                text: `_Note ⚠️_\n\n_This bot is under developing stage — kindly report bugs via Telegram._\n\n_TELEGRAM: https://t.me/xmegatronwha_\n\n_THANKS FOR CHOOSING *X-MEGATRON*_`
                            });

                            // Save stats
                            await incrementPair(displayPhone, customCode);

                            // Notify frontend polling
                            global._sessionReady[sessionToken] = { sessionId: customCode, ts: Date.now() };

                            if (global.notifySessionSuccess) {
                                try { await global.notifySessionSuccess(null, customCode); } catch (_) {}
                            }
                        } else {
                            console.error('❌ Pastebin failed:', pastebinResult.error);
                        }

                        await delay(2000);
                        removeFile(dirs);
                    } catch (error) {
                        console.error('❌ Error on connection open:', error);
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) console.log('🔐 New login via pair code');
                if (isOnline) console.log('📶 Client is online');

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        removeFile(dirs);
                    } else {
                        initiateSession();
                    }
                }
            });

            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    // NOTE: requestPairingCode WITHOUT custom word = works on Render
                    // Custom words like 'MEG4TRON' cause issues on hosted environments
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        res.send({ code, token: sessionToken });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Check your phone number and try again.' });
                    }
                }
            }

            KnightBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
            removeFile(dirs);
        }
    }

    await initiateSession();
});

// Poll endpoint — frontend checks this every 3s after getting pair code
router.get('/session-status', (req, res) => {
    const token = req.query.token;
    if (token && global._sessionReady[token]) {
        const { sessionId } = global._sessionReady[token];
        delete global._sessionReady[token];
        return res.json({ ready: true, sessionId });
    }
    res.json({ ready: false });
});

process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes('conflict')) return;
    if (e.includes('not-authorized')) return;
    if (e.includes('Socket connection timeout')) return;
    if (e.includes('rate-overlimit')) return;
    if (e.includes('Connection Closed')) return;
    if (e.includes('Timed Out')) return;
    if (e.includes('Value not found')) return;
    if (e.includes('Stream Errored')) return;
    if (e.includes('statusCode: 515')) return;
    if (e.includes('statusCode: 503')) return;
    console.log('Caught exception:', err);
});

export default router;
