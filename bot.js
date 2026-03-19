const { google } = require('googleapis');
const moment = require('moment');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 8080;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';

// const ALLOWED_GROUP = -1002498803166;

if (!TOKEN) throw new Error('❌ BOT_TOKEN kosong');
if (!SHEET_ID) throw new Error('❌ SPREADSHEET_ID kosong');
if (!process.env.GOOGLE_CREDS_BASE64) throw new Error('❌ GOOGLE_CREDS_BASE64 kosong');

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

// ===== ERROR HANDLER =====
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ===== GOOGLE AUTH =====
const creds = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDS_BASE64, 'base64').toString()
);

// 🔥 FIX PRIVATE KEY
creds.private_key = creds.private_key.replace(/\\n/g, '\n');

console.log('🔑 SERVICE ACCOUNT:', creds.client_email);

const auth = new google.auth.GoogleAuth({
  credentials: creds,
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

  try {
    await bot.deleteWebHook();
    await bot.setWebHook(`${URL}/webhook`);
    console.log('✅ Webhook aktif');
  } catch (err) {
    console.error('❌ Gagal set webhook:', err);
  }
});

// ===== PARSER SUPER STABIL =====
function parseLaporan(text = '') {
  const result = {
    status: '',
    tiket: '',
    inet: '',
    cp: '',
    penyebab: '',
    perbaikan: '',
    alamat: '',
    odp: '',
    petugas: ''
  };

  const lines = text.split('\n');

  lines.forEach(line => {
    let clean = line.trim();

    if (clean.startsWith('-')) {
      clean = clean.slice(1).trim();
    }

    const parts = clean.split(':');
    if (parts.length < 2) return;

    const key = parts[0].toUpperCase().trim();
    let value = parts.slice(1).join(':').trim();

    // kosongkan jika kosong
    if (!value || value === '-' || value === ':') value = '';

    if (key.includes('STATUS')) result.status = value.toUpperCase();
    else if (key.includes('NO TIKET')) result.tiket = value;
    else if (key.includes('INET')) result.inet = value;

    else if (key.includes('CP')) {
      // 🔥 FIX +62
      if (value.startsWith('+')) value = `'${value}`;
      result.cp = value;
    }

    else if (key.includes('PENYEBAB')) result.penyebab = value;
    else if (key.includes('LANGKAH')) result.perbaikan = value;
    else if (key.includes('ALAMAT')) result.alamat = value;
    else if (key.includes('ODP')) result.odp = value;
    else if (key.includes('PETUGAS')) result.petugas = value;
  });

  return result;
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
  if (msg.chat.type === 'private') {
    bot.sendMessage(msg.chat.id, '🤖 Bot aktif di GRUP ya 🔥');
  }
});

// ===== HANDLE MESSAGE (GRUP) =====
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;

    // if (msg.chat.id !== ALLOWED_GROUP) return;

    if (!msg.text.toUpperCase().includes('NO TIKET')) return;

    console.log('📩 Grup:', msg.chat.title);

    const data = parseLaporan(msg.text);

    if (!data.tiket) return;

    await saveToSheet(data);

    bot.sendMessage(msg.chat.id, '✅ Data masuk Google Sheet');

  } catch (err) {
    console.error('❌ ERROR DETAIL:', err.response?.data || err.message);
    bot.sendMessage(msg.chat.id, '❌ Gagal simpan ke sheet');
  }
});
