const { google } = require('googleapis');
const moment = require('moment');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 8080;
const URL = 'https://telegram-bot-rekap-production.up.railway.app'; // ganti kalau domain beda

if (!TOKEN) {
  console.error('❌ BOT_TOKEN kosong');
  process.exit(1);
}
if (!SHEET_ID) {
  console.error('❌ SPREADSHEET_ID kosong');
  process.exit(1);
}

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

// ===== GLOBAL ERROR =====
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ===== DEBUG FILE =====
const credPath = path.join(__dirname, 'credentials.json');
console.log('📁 credentials path:', credPath);
console.log('📁 credentials exists:', fs.existsSync(credPath));

// ===== GOOGLE AUTH =====
const auth = new google.auth.GoogleAuth({
  keyFile: credPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ===== WEBHOOK =====
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  try {
    bot.processUpdate(req.body);
  } catch (e) {
    console.error('❌ Webhook error:', e);
  }
});

// ===== START SERVER =====
app.listen(PORT, async () => {
  console.log('🚀 BOT SIAP FULL');
  console.log('🌐 Server hidup di port', PORT);

  const webhookUrl = `${URL}/webhook`;
  console.log('🌐 Set webhook:', webhookUrl);

  try {
    await bot.deleteWebHook();
    await bot.setWebHook(webhookUrl);
    console.log('✅ Webhook aktif');
  } catch (err) {
    console.error('❌ Gagal set webhook:', err);
  }
});

// ===== PARSER =====
function parseLaporan(text = '') {
  const get = (label) => {
    const regex = new RegExp(`${label}\\s*:\\s*(.*)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  };

  return {
    status: get('STATUS'),
    tiket: get('NO TIKET'),
    inet: get('INET/TLP'),
    cp: get('CP PELANGGAN'),
    penyebab: get('PENYEBAB GANGGUAN'),
    perbaikan: get('LANGKAH PERBAIKAN'),
    alamat: get('ALAMAT LENGKAP'),
    odp: get('NAMA ODP'),
    petugas: get('PETUGAS'),
  };
}

// ===== SAVE TO SHEET =====
async function saveToSheet(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const values = [[
    moment().format('YYYY-MM-DD HH:mm:ss'),
    data.status,
    data.tiket,
    data.inet,
    data.cp,
    data.penyebab,
    data.perbaikan,
    data.alamat,
    data.odp,
    data.petugas
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:J',
    valueInputOption: 'USER_ENTERED',
    resource: { values }
  });

  console.log('✅ BERHASIL MASUK SHEET');
}

// ===== COMMAND =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 BOT AKTIF 🔥');
});

// ===== HANDLE MESSAGE =====
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;

    const data = parseLaporan(msg.text);
    if (!data.tiket) return;

    await saveToSheet(data);
    bot.sendMessage(msg.chat.id, '✅ Data masuk Google Sheet');

  } catch (err) {
    console.error('❌ ERROR FULL:', err);
    bot.sendMessage(msg.chat.id, '❌ Gagal simpan ke sheet');
  }
});
