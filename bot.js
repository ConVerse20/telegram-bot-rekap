process.env.NTBA_FIX_350 = 1;

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { google } = require('googleapis');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const BASE_URL = process.env.BASE_URL;

const bot = new TelegramBot(TOKEN);
const app = express();

app.use(express.json());

// ===== WEBHOOK SETUP =====
const webhookPath = `/bot${TOKEN}`;
const webhookUrl = `${BASE_URL}${webhookPath}`;

bot.setWebHook(webhookUrl).then(() => {
  console.log('🌐 Webhook aktif:', webhookUrl);
});

// endpoint webhook
app.post(webhookPath, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ===== EXPRESS =====
app.get('/', (req, res) => {
  res.send('Bot webhook aktif 🚀');
});

app.listen(PORT, () => {
  console.log(`🌐 Server hidup di port ${PORT}`);
});

// ===== GOOGLE AUTH =====
let credentials;
try {
  credentials = JSON.parse(process.env.GSHEET_CREDENTIALS);
} catch (err) {
  console.error('❌ GSHEET_CREDENTIALS error:', err.message);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ===== STORAGE =====
let dataRekap = [];

// ===== PARSER =====
function parseMessage(text) {
  const fields = {
    status: '',
    tiket: '',
    inet: '',
    cp: '',
    gangguan: '',
    perbaikan: '',
    alamat: '',
    odp: '',
    petugas: ''
  };

  const lines = text.split('\n');

  lines.forEach(line => {
    const val = line.split(':')[1]?.trim() || '';

    if (/STATUS/i.test(line)) fields.status = val;
    if (/NO TIKET/i.test(line)) fields.tiket = val;
    if (/INET\/TLP/i.test(line)) fields.inet = val;
    if (/CP PELANGGAN/i.test(line)) fields.cp = val;
    if (/PENYEBAB/i.test(line)) fields.gangguan = val;
    if (/LANGKAH/i.test(line)) fields.perbaikan = val;
    if (/ALAMAT/i.test(line)) fields.alamat = val;
    if (/ODP/i.test(line)) fields.odp = val;
    if (/PETUGAS/i.test(line)) fields.petugas = val;
  });

  return fields;
}

// ===== VALIDASI =====
function isKosong(data) {
  return Object.values(data).every(v => v === '');
}

// ===== SAVE TO SHEET =====
async function saveToSheet(data) {
  try {
    const now = new Date().toLocaleString('id-ID');

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now,
          data.status,
          data.tiket,
          data.inet,
          data.cp,
          data.gangguan,
          data.perbaikan,
          data.alamat,
          data.odp,
          data.petugas
        ]]
      }
    });

    console.log('📊 Masuk Google Sheet');
  } catch (err) {
    console.error('❌ ERROR SHEET:', err.message);
  }
}

// ===== COMMAND =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 BOT WEBHOOK AKTIF 🔥');
});

bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;
    if (msg.text.startsWith('/')) return;

    console.log('📨 MASUK:', msg.text);

    const parsed = parseMessage(msg.text);

    if (isKosong(parsed)) return;

    dataRekap.push(parsed);

    await saveToSheet(parsed);

    bot.sendMessage(msg.chat.id, '✅ Data tersimpan');

  } catch (err) {
    console.error('❌ ERROR MESSAGE:', err.message);
  }
});
