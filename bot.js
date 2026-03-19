const { google } = require('googleapis');
const moment = require('moment');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 8080;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';

// 👉 OPTIONAL: batasi hanya 1 grup
// const ALLOWED_GROUP = -1002498803166;

if (!TOKEN) {
  console.error('❌ BOT_TOKEN kosong');
  process.exit(1);
}
if (!SHEET_ID) {
  console.error('❌ SPREADSHEET_ID kosong');
  process.exit(1);
}
if (!process.env.GOOGLE_CREDS_BASE64) {
  console.error('❌ GOOGLE_CREDS_BASE64 kosong');
  process.exit(1);
}

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

// 🔥 FIX JWT
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

  const webhookUrl = `${URL}/webhook`;

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

// ===== COMMAND (OPTIONAL) =====
bot.onText(/\/start/, (msg) => {
  if (msg.chat.type === 'private') {
    bot.sendMessage(msg.chat.id, '🤖 Bot aktif di GRUP ya 🔥');
  }
});

// ===== HANDLE MESSAGE (GRUP ONLY) =====
bot.on('message', async (msg) => {
  try {
    // ❌ Abaikan chat pribadi
    if (msg.chat.type === 'private') return;

    // ❌ Abaikan non-text
    if (!msg.text) return;

    // ❌ Optional: batasi grup tertentu
    // if (msg.chat.id !== ALLOWED_GROUP) return;

    // ❌ Filter: harus ada NO TIKET
    if (!msg.text.toUpperCase().includes('NO TIKET')) return;

    console.log('📩 Pesan masuk dari grup:', msg.chat.title);
    console.log('🆔 Chat ID:', msg.chat.id);

    const data = parseLaporan(msg.text);
    if (!data.tiket) return;

    await saveToSheet(data);

    bot.sendMessage(msg.chat.id, '✅ Data masuk Google Sheet');

  } catch (err) {
    console.error('❌ ERROR DETAIL:', err.response?.data || err.message);
    bot.sendMessage(msg.chat.id, '❌ Gagal simpan ke sheet');
  }
});
