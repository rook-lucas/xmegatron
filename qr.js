import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fetch from 'node-fetch';
import { incrementQR } from './stats.js';

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
    // Generate unique session for each request to avoid conflicts
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const sessionToken = sessionId;
    const dirs = `./temp_qr_sessions/session_${sessionId}`;
    if (!global._sessionReady) global._sessionReady = {};

    // Ensure temp_qr_sessions directory exists
    if (!fs.existsSync('./temp_qr_sessions')) {
        fs.mkdirSync('./temp_qr_sessions', { recursive: true });
    }

    async function initiateSession() {
        // Create the session folder before anything
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            
            let qrGenerated = false;
            let responseSent = false;

            // QR Code handling logic
            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return;
                
                qrGenerated = true;
                console.log('🟢 QR Code Generated! Scan it with your WhatsApp app.');
                console.log('📋 Instructions:');
                console.log('1. Open WhatsApp on your phone');
                console.log('2. Go to Settings > Linked Devices');
                console.log('3. Tap "Link a Device"');
                console.log('4. Scan the QR code below');
                
                try {
                    // Generate QR code as data URL
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 1,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        console.log('QR Code generated successfully');
                        await res.send({ 
                            qr: qrDataURL,
                            token: sessionToken,
                            message: 'QR Code Generated! Scan it with your WhatsApp app.',
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

            // Improved Baileys socket configuration
            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            };

            // Create socket and bind events
            let sock = makeWASocket(socketConfig);
            let reconnectAttempts = 0;
            const maxReconnectAttempts = 3;

            // Connection event handler function
            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update;
                console.log(`🔄 Connection update: ${connection || 'undefined'}`);

                if (qr && !qrGenerated) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    console.log('✅ Connected successfully!');
                    console.log('📤 Uploading session to Pastebin...');
                    reconnectAttempts = 0;
                    
                    try {
                        // Read the session file
                        const sessionContent = fs.readFileSync(dirs + '/creds.json', 'utf8');
                        
                        // Upload to Pastebin
                        const pastebinResult = await uploadToPastebin(sessionContent, `KnightBot QR Session - ${sessionId}`);
                        
                        if (pastebinResult.success) {
                            console.log("✅ Session uploaded to Pastebin:", pastebinResult.url);
                            
                            // Create the custom format: xmegatron~PasteID
                            const customCode = `xmegatron~${pastebinResult.id}`;
                            
                            // Get the user's JID from the session
                            const userJid = Object.keys(sock.authState.creds.me || {}).length > 0 
                                ? jidNormalizedUser(sock.authState.creds.me.id) 
                                : null;
                            
                            if (userJid) {
                                // Send custom code to user
                                await sock.sendMessage(userJid, {
                                    text: `${customCode}`
                                });
                                console.log("📤 Session code sent successfully to", userJid);
                                
                                // Send warning message
                                await sock.sendMessage(userJid, {
                                    text: ` _Note ⚠️_

_This bot is under developing stage only may cause some bugs and some issues to valuable users so kindly inform me through telegram channel._
_Uptodate Update to get new features_

_TELEGRAM:_ _https://t.me/xmegatronwha_

_THANKS FOR CHOOSING *X-MEGATRON*_`
                                });
                                console.log("⚠️ Warning message sent successfully");

                                // Save stats — phone from JID
                                const meId = sock.authState.creds?.me?.id;
                                const rawPhone = meId ? meId.split('@')[0].split(':')[0] : null;
                                incrementQR(rawPhone ? '+' + rawPhone : 'QR Scan', customCode);

                                // Notify frontend polling
                                global._sessionReady[sessionToken] = { sessionId: customCode, ts: Date.now() };
                                if (global.notifySessionSuccess) {
                                    try { await global.notifySessionSuccess(null, customCode); } catch (_) {}
                                }
                            } else {
                                console.log("❌ Could not determine user JID to send session code");
                            }
                        } else {
                            console.error("❌ Failed to upload to Pastebin:", pastebinResult.error);
                        }
                    } catch (error) {
                        console.error("Error processing session:", error);
                    }

                    // Clean up temporary session folder
                    setTimeout(() => {
                        console.log('🧹 Cleaning up temporary session...');
                        const deleted = removeFile(dirs);
                        if (deleted) {
                            console.log('✅ Temporary session cleaned up successfully');
                        } else {
                            console.log('❌ Failed to clean up session folder');
                        }
                    }, 15000); // Wait 15 seconds before cleanup
                }

                if (connection === 'close') {
                    console.log('❌ Connection closed');
                    if (lastDisconnect?.error) {
                        console.log('❗ Last Disconnect Error:', lastDisconnect.error);
                    }
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    // Handle specific error codes
                    if (statusCode === 401) {
                        console.log('🔐 Logged out - need new QR code');
                        removeFile(dirs);
                    } else if (statusCode === 515 || statusCode === 503) {
                        console.log(`🔄 Stream error (${statusCode}) - attempting to reconnect...`);
                        reconnectAttempts++;
                        
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
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
                            console.log('❌ Max reconnect attempts reached');
                            removeFile(dirs);
                            if (!responseSent) {
                                responseSent = true;
                                res.status(503).send({ code: 'Connection failed after multiple attempts' });
                            }
                        }
                    } else {
                        console.log('🔄 Connection lost - attempting to reconnect...');
                    }
                }
            };

            // Bind the event handler
            sock.ev.on('connection.update', handleConnectionUpdate);
            sock.ev.on('creds.update', saveCreds);

            // Set a timeout to clean up if no QR is generated
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: 'QR generation timeout' });
                    removeFile(dirs);
                }
            }, 30000); // 30 second timeout

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

// Frontend polls this every 3s after QR scanned
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
