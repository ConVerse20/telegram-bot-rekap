const { google } = require('googleapis');
const moment = require('moment');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cron = require('node-cron');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 8080;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';
const GROUP_ID = process.env.GROUP_ID;

if (!TOKEN) throw new Error('❌ BOT_TOKEN kosong');
if (!SHEET_ID) throw new Error('❌ SPREADSHEET_ID kosong');
if (!process.env.GOOGLE_CREDS_BASE64) throw new Error('❌ GOOGLE_CREDS_BASE64 kosong');

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ===== GOOGLE AUTH =====
const creds = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDS_BASE64, 'base64').toString()
);

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

// ===== START =====
app.listen(PORT, async () => {
  console.log('🚀 BOT SIAP FULL');

  await bot.deleteWebHook();
  await bot.setWebHook(`${URL}/webhook`);

  console.log('✅ Webhook aktif');
});

// ===== PARSER =====
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

  text.split('\n').forEach(line => {
    let clean = line.trim();
    if (clean.startsWith('-')) clean = clean.slice(1).trim();

    const parts = clean.split(':');
    if (parts.length < 2) return;

    const key = parts[0].toUpperCase();
    let value = parts.slice(1).join(':').trim();

    if (!value || value === '-' || value === ':') value = '';

    if (key.includes('STATUS')) result.status = value.toUpperCase();
    else if (key.includes('NO TIKET')) result.tiket = value;
    else if (key.includes('INET')) result.inet = value;

    else if (key.includes('CP')) {
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

// ===== SAVE / UPDATE =====
async function saveToSheet(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:J',
  });

  const rows = res.data.values || [];

  const rowIndex = rows.findIndex(r => r[2] === data.tiket);

  const newRow = [[
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

  if (rowIndex !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${rowIndex + 1}:J${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: newRow }
    });
    return 'update';
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:J',
    valueInputOption: 'USER_ENTERED',
    resource: { values: newRow }
  });

  return 'insert';
}

// ===== REKAP =====
async function kirimRekapHarian() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:J',
  });

  const rows = res.data.values || [];
  const today = moment().format('YYYY-MM-DD');

  let total = 0, close = 0, open = 0;

  rows.forEach((r, i) => {
    if (i === 0) return;

    const tgl = r[0] || '';
    const status = (r[1] || '').toUpperCase();

    if (!tgl.includes(today)) return;

    total++;
    if (status.includes('CLOSE')) close++;
    else open++;
  });

  const text = `📊 REKAP HARI INI
Tanggal: ${today}

Total Tiket : ${total}
CLOSE       : ${close}
OPEN/LOS    : ${open}`;

  if (GROUP_ID) {
    await bot.sendMessage(GROUP_ID, text);
  }
}

// ===== CRON JAM 17 =====
cron.schedule('0 17 * * *', () => {
  console.log('⏰ REKAP AUTO');
  kirimRekapHarian();
});

// ===== COMMAND =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 Bot siap 🔥');
});

bot.onText(/\/rekap/, async (msg) => {
  await kirimRekapHarian();
});

// ===== HANDLE MESSAGE =====
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;

    const isPrivate = msg.chat.type === 'private';

    if (!msg.text.toUpperCase().includes('NO TIKET')) {
      if (isPrivate) {
        return bot.sendMessage(msg.chat.id, '❌ Format salah');
      }
      return;
    }

    const data = parseLaporan(msg.text);
    if (!data.tiket) return;

    const result = await saveToSheet(data);

    if (result === 'update') {
      bot.sendMessage(msg.chat.id, '🔄 Data berhasil di-update');
    } else {
      bot.sendMessage(msg.chat.id, '🆕 Data baru masuk');
    }

  } catch (err) {
    console.error(err.message);
    bot.sendMessage(msg.chat.id, '❌ Error');
  }
});
