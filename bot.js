import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 2029;
const API_BASE_URL = `http://localhost:${PORT}`;

// Initialize bot only if token is provided
if (!BOT_TOKEN) {
  console.log('⚠️  Telegram bot token not configured. Please add BOT_TOKEN to .env');
  process.exit(0);
}

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Store user states and session data
const userStates = {};
const userSessions = {};

// Helper function to create inline keyboard
function createMainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔑 Pair Code', callback_data: 'pair' },
          { text: '📱 QR Code', callback_data: 'qr' }
        ],
        [
          { text: 'ℹ️ Help', callback_data: 'help' }
        ]
      ]
    }
  };
}

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'User';
  
  const welcomeMessage = `
🤖 *Welcome to X MEGATRON Bot, ${userName}!*

I can help you link your WhatsApp account using two methods:

🔑 *Pair Code* - Link using an 8-digit code
📱 *QR Code* - Link by scanning a QR code

Choose a method below to get started:
  `;
  
  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: 'Markdown',
    ...createMainKeyboard()
  });
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `
📖 *X MEGATRON Bot Help*

*Available Commands:*
/start - Start the bot
/pair - Generate pair code
/qr - Generate QR code
/help - Show this help message

*How to use Pair Code:*
1. Use /pair command
2. Enter your WhatsApp number with country code
3. Open WhatsApp > Settings > Linked Devices
4. Tap "Link a Device"
5. Enter the 8-digit code

*How to use QR Code:*
1. Use /qr command
2. Open WhatsApp > Settings > Linked Devices
3. Tap "Link a Device"
4. Scan the QR code

*Social Links:*
• YouTube: @codlucasox
• GitHub: @COD-LUCAS

© 2025 COD-LUCAS | X MEGATRON
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Pair command
bot.onText(/\/pair/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = 'awaiting_number';
  
  bot.sendMessage(
    chatId,
    '📱 *Enter your WhatsApp number with country code*\n\nExample: +919876543210',
    { parse_mode: 'Markdown' }
  );
});

// QR command
bot.onText(/\/qr/, async (msg) => {
  const chatId = msg.chat.id;
  const loadingMsg = await bot.sendMessage(chatId, '⏳ Generating QR code...');
  
  try {
    const response = await axios.get(`${API_BASE_URL}/qr`);
    
    if (response.data.qr) {
      const base64Data = response.data.qr.replace(/^data:image\/png;base64,/, '');
      const qrImageBuffer = Buffer.from(base64Data, 'base64');
      
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      
      await bot.sendPhoto(chatId, qrImageBuffer, {
        caption:
          '📱 *Scan this QR code with WhatsApp*\n\n' +
          '1. Open WhatsApp\n' +
          '2. Go to Settings > Linked Devices\n' +
          '3. Tap "Link a Device"\n' +
          '4. Scan this QR code\n\n' +
          '⏱️ QR code will expire in 60 seconds',
        parse_mode: 'Markdown'
      });
      
      userSessions[chatId] = {
        type: 'qr',
        timestamp: Date.now()
      };
    } else {
      await bot.editMessageText('❌ Failed to generate QR code. Please try again.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  } catch (error) {
    await bot.editMessageText('❌ Error generating QR code. Please try again later.', {
      chat_id: chatId,
      message_id: loadingMsg.message_id
    });
  }
});

// Handle callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  
  await bot.answerCallbackQuery(query.id);
  
  if (data === 'pair') {
    userStates[chatId] = 'awaiting_number';
    bot.sendMessage(
      chatId,
      '📱 *Enter your WhatsApp number with country code*\n\nExample: +919876543210',
      { parse_mode: 'Markdown' }
    );
  } else if (data === 'qr') {
    bot.emit('text', { chat: { id: chatId }, text: '/qr' });
  } else if (data === 'help') {
    bot.emit('text', { chat: { id: chatId }, text: '/help' });
  }
});

// Handle text messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;
  
  if (userStates[chatId] === 'awaiting_number') {
    const phoneNumber = text.trim().replace(/[^0-9+]/g, '');
    
    if (!phoneNumber.startsWith('+') || phoneNumber.length < 10) {
      return bot.sendMessage(chatId, '❌ Invalid number format.');
    }
    
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Generating pair code...');
    
    try {
      const response = await axios.get(
        `${API_BASE_URL}/pair?number=${phoneNumber.replace(/[^0-9]/g, '')}`
      );
      
      const code = response.data.code;
      
      if (code) {
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        await bot.sendMessage(
          chatId,
          `🔑 *PAIR CODE*\n\n\`${code}\``,
          { parse_mode: 'Markdown' }
        );
        delete userStates[chatId];
      } else {
        await bot.editMessageText('❌ Service unavailable.', {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
      }
    } catch {
      await bot.editMessageText('❌ Error generating pair code.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  }
});

// ✅ FIXED FUNCTION (ONLY CHANGE)
async function notifySessionSuccess(chatId, sessionId) {
  try {
    await bot.sendMessage(
      chatId,
      `✅ *WHATSAPP CONNECTED SUCCESSFUL*\n\n` +
      `🔐 *SESSION ID:-*\n` +
      `\`${sessionId}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Telegram send error:', err.message);
  }
}

// Error handling
bot.on('polling_error', () => {});

console.log('🤖 X MEGATRON Bot is running...');
console.log(`📡 API Base URL: ${API_BASE_URL}`);
console.log('⚡ Bot is ready to receive commands!');

export { bot, notifySessionSuccess };
