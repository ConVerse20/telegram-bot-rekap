const { google } = require('googleapis');
const moment = require('moment');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cron = require('node-cron');

// CONFIG
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 8080;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';

if (!TOKEN) throw new Error('BOT_TOKEN kosong');
if (!SHEET_ID) throw new Error('SPREADSHEET_ID kosong');
if (!process.env.GOOGLE_CREDS_BASE64) throw new Error('GOOGLE_CREDS_BASE64 kosong');

// INIT
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

// GOOGLE AUTH
const creds = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDS_BASE64, 'base64').toString()
);

creds.private_key = creds.private_key.replace(/\\n/g, '\n');

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// WEBHOOK
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  bot.processUpdate(req.body);
});

// START
app.listen(PORT, async () => {
  await bot.deleteWebHook();
  await bot.setWebHook(`${URL}/webhook`);
  console.log('🚀 BOT SIAP');
});

// WIB TIME
function now() {
  return moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');
}

// PARSER
function parse(text) {
  const get = (key) => {
    const r = new RegExp(`${key}\\s*:\\s*(.*)`, 'i');
    const m = text.match(r);
    if (!m) return '';
    let v = m[1].trim();
    if (!v || v === ':' || v === '-') return '';
    return v;
  };

  let cp = get('CP PELANGGAN');
  if (cp.startsWith('+')) cp = `'${cp}`;

  return {
    status: get('STATUS'),
    tiket: get('NO TIKET'),
    inet: get('INET/TLP'),
    cp,
    penyebab: get('PENYEBAB GANGGUAN'),
    perbaikan: get('LANGKAH PERBAIKAN'),
    alamat: get('ALAMAT LENGKAP'),
    odp: get('NAMA ODP'),
    petugas: get('PETUGAS'),
  };
}

// SAVE
async function save(data, loc = '') {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        now(),
        data.status,
        data.tiket,
        data.inet,
        data.cp,
        data.penyebab,
        data.perbaikan,
        data.alamat,
        data.odp,
        data.petugas,
        loc
      ]]
    }
  });
}

// HANDLE
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;
    if (!msg.text.includes('NO TIKET')) return;

    const data = parse(msg.text);

    const loc = msg.location
      ? `${msg.location.latitude},${msg.location.longitude}`
      : '';

    await save(data, loc);

    bot.sendMessage(msg.chat.id, '✅ Masuk sheet');

  } catch (e) {
    console.error(e);
    bot.sendMessage(msg.chat.id, '❌ Error');
  }
});
