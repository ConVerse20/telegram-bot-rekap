const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TOKEN;

// 🔥 PAKAI POLLING (BUKAN WEBHOOK)
const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🚀 BOT POLLING AKTIF');

// TEST
bot.on('message', (msg) => {
  console.log('📨 MASUK:', msg.text);
  bot.sendMessage(msg.chat.id, '✅ BOT HIDUP (POLLING)');
});
