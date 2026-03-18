const { google } = require('googleapis');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ================= INIT EXPRESS =================
const app = express();

// 🔥 FIX BODY PARSING (WAJIB)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';

// ================= BOT =================
const bot = new TelegramBot(TOKEN, { polling: false });

// ================= TEST ROUTE =================
app.get('/', (req, res) => res.send('BOT HIDUP'));
app.get('/webhook', (req, res) => res.send('WEBHOOK OK'));

// ================= WEBHOOK =================
app.post('/webhook', (req, res) => {
  console.log('📩 WEBHOOK MASUK');

  try {
    const update = req.body;

    if (!update || Object.keys(update).length === 0) {
      console.log('❌ BODY KOSONG!');
      return res.sendStatus(200);
    }

    console.log('📦 UPDATE:', JSON.stringify(update));

    bot.processUpdate(update);

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ ERROR WEBHOOK:', err);
    res.sendStatus(500);
  }
});

// ================= DEBUG LISTENER =================
bot.on('message', (msg) => {
  console.log('📨 PESAN MASUK:', msg.text);

  bot.sendMessage(msg.chat.id, '✅ BOT SUDAH HIDUP');
});

// ================= SET WEBHOOK =================
async function initWebhook() {
  try {
    console.log('🔄 RESET WEBHOOK...');
    await bot.deleteWebHook();

    // kasih jeda biar bersih
    await new Promise(r => setTimeout(r, 2000));

    console.log('🔄 SET WEBHOOK...');
    await bot.setWebHook(`${URL}/webhook`, {
      drop_pending_updates: true
    });

    const info = await bot.getWebHookInfo();
    console.log('📡 WEBHOOK INFO:', info);

  } catch (err) {
    console.error('❌ WEBHOOK ERROR:', err.message);
  }
}

// ================= START SERVER =================
const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log('🚀 Server jalan di port', PORT);
  await initWebhook();
});

console.log('🚀 BOT SIAP FULL');
