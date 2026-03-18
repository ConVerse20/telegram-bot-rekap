const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TOKEN;

const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🚀 BOT POLLING AKTIF');

bot.on('message', (msg) => {
  console.log('📨 MASUK:', msg.text);
  bot.sendMessage(msg.chat.id, '✅ BOT HIDUP (POLLING)');
});
