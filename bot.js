const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const app = express();

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;

// ================= BOT POLLING =================
const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🚀 BOT POLLING AKTIF');

// ================= TEST BOT =================
bot.on('message', (msg) => {
  console.log('📨 MASUK:', msg.text);
  bot.sendMessage(msg.chat.id, '✅ BOT HIDUP (POLLING)');
});

// ================= SERVER (BIAR GAK DIMATIIN RAILWAY) =================
app.get('/', (req, res) => {
  res.send('BOT HIDUP');
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log('🌐 Server hidup di port', PORT);
});
