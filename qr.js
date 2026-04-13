import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';
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
    const sessionToken = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./temp_qr_sessions/session_${sessionToken}`;

    if (!fs.existsSync('./temp_qr_sessions')) {
        fs.mkdirSync('./temp_qr_sessions', { recursive: true });
    }

    async function initiateSession() {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            let qrGenerated = false;
            let responseSent = false;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return;
                qrGenerated = true;

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        await res.send({
                            qr: qrDataURL,
                            token: sessionToken,
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        });
                    }
                } catch (qrError) {
                    console.error('Error generating QR code:', qrError);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ code: 'Failed to generate QR code' });
                    }
                }
            };

            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            };

            let sock = makeWASocket(socketConfig);
            let reconnectAttempts = 0;
            const maxReconnectAttempts = 3;

            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !qrGenerated) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    console.log('✅ QR Connected successfully!');
                    reconnectAttempts = 0;

                    try {
                        const sessionContent = fs.readFileSync(dirs + '/creds.json', 'utf8');
                        const pastebinResult = await uploadToPastebin(sessionContent, `MEG4TRON QR - ${sessionToken}`);

                        if (pastebinResult.success) {
                            const customCode = `xmegatron~${pastebinResult.id}`;

                            // Get phone from creds
                            const meId = sock.authState.creds?.me?.id;
                            const rawPhone = meId ? meId.split('@')[0].split(':')[0] : null;
                            const displayPhone = rawPhone ? '+' + rawPhone : 'QR User';

                            const userJid = meId ? jidNormalizedUser(meId) : null;

                            if (userJid) {
                                await sock.sendMessage(userJid, { text: customCode });
                                await sock.sendMessage(userJid, {
                                    text: `_Note ⚠️_\n\n_This bot is under developing stage — report bugs via Telegram._\n\n_TELEGRAM: https://t.me/xmegatronwha_\n\n_THANKS FOR CHOOSING *X-MEGATRON*_`
                                });
                            }

                            // Save stats
                            await incrementQR(displayPhone, customCode);

                            // Notify frontend polling
                            global._sessionReady[sessionToken] = { sessionId: customCode, ts: Date.now() };

                            if (global.notifySessionSuccess) {
                                try { await global.notifySessionSuccess(null, customCode); } catch (_) {}
                            }
                        } else {
                            console.error('❌ Pastebin failed:', pastebinResult.error);
                        }
                    } catch (error) {
                        console.error('Error processing QR session:', error);
                    }

                    setTimeout(() => {
                        console.log('🧹 Cleaning up QR session...');
                        removeFile(dirs);
                    }, 15000);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        removeFile(dirs);
                    } else if (statusCode === 515 || statusCode === 503) {
                        reconnectAttempts++;
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            setTimeout(() => {
                                try {
                                    sock = makeWASocket(socketConfig);
                                    sock.ev.on('connection.update', handleConnectionUpdate);
                                    sock.ev.on('creds.update', saveCreds);
                                } catch (err) {
                                    console.error('Failed to reconnect:', err);
                                }
                            }, 2000);
                        } else {
                            removeFile(dirs);
                            if (!responseSent) {
                                responseSent = true;
                                res.status(503).send({ code: 'Connection failed after multiple attempts' });
                            }
                        }
                    }
                }
            };

            sock.ev.on('connection.update', handleConnectionUpdate);
            sock.ev.on('creds.update', saveCreds);

            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: 'QR generation timeout. Try again.' });
                    removeFile(dirs);
                }
            }, 30000);

        } catch (err) {
            console.error('Error initializing QR session:', err);
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
            removeFile(dirs);
        }
    }

    await initiateSession();
});

// Poll endpoint
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
