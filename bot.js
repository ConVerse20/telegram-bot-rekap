// =======================
// 🚀 MCU BOT FINAL FULL (SEMUA FITUR UTUH + FIX)
// =======================

const { google } = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const express = require('express');

// ===== ENV =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || process.env.RAILWAY_STATIC_URL;

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

// ===== WEBHOOK =====
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  const webhookUrl = `${BASE_URL}/webhook`;
  await bot.deleteWebHook();
  await bot.setWebHook(webhookUrl);
  console.log('🚀 WEBHOOK AKTIF:', webhookUrl);
});

// =======================
// 🧠 UTIL
// =======================
const delay = ms => new Promise(r => setTimeout(r, ms));

function clean(v) {
  if (!v) return '';
  v = v.trim();
  if (v === '-' || v === ':' || v === 'x') return '';
  if (/nama odp/i.test(v)) return '';
  if (/petugas/i.test(v)) return '';
  return v;
}

// =======================
// 🔥 FILTER KOSONG
// =======================
function isReallyEmpty(txt) {
  return txt
    .replace(/MEDICAL\s*CHECK\s*UP\s*PELANGGAN/gi, '')
    .replace(/STATUS|NO TIKET|INET\/TLP|CP PELANGGAN|PENYEBAB GANGGUAN|LANGKAH PERBAIKAN|ALAMAT LENGKAP|NAMA ODP|PETUGAS/gi, '')
    .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
    .replace(/[:\-]/g, '')
    .trim() === '';
}

// =======================
// 📍 LOCATION
// =======================
function getLocation(msg) {
  if (msg.location)
    return `${msg.location.latitude},${msg.location.longitude}`;

  if (msg.reply_to_message?.location)
    return `${msg.reply_to_message.location.latitude},${msg.reply_to_message.location.longitude}`;

  return '';
}

// =======================
// 📦 BUFFER
// =======================
const bufferMsg = {};
const lastLocation = {};

function addBuffer(chatId, msg) {
  if (!bufferMsg[chatId]) bufferMsg[chatId] = [];
  bufferMsg[chatId].push(msg);
}

// =======================
// 🧠 PARSER
// =======================
function splitMCU(text) {
  const parts = text.split(/MEDICAL\s*CHECK\s*UP\s*PELANGGAN\s*:/i);
  parts.shift();
  return parts.map(p => "MEDICAL CHECK UP PELANGGAN :" + p);
}

function get(label, txt) {
  const r = new RegExp(`${label}\\s*:\\s*([^\\n]*)`, 'i');
  const m = txt.match(r);
  return m ? m[1].trim() : '';
}

function parseMCU(txt) {
  return {
    status: clean(get('STATUS', txt)),
    tiket: clean(get('NO TIKET', txt)),
    inet: clean(get('INET/TLP', txt)),
    cp: clean(get('CP PELANGGAN', txt)),
    penyebab: clean(get('PENYEBAB GANGGUAN', txt)),
    perbaikan: clean(get('LANGKAH PERBAIKAN', txt)),
    alamat: clean(get('ALAMAT LENGKAP', txt)),
    odp: clean(get('NAMA ODP', txt)),
    petugas: clean(get('PETUGAS', txt)),
  };
}

// =======================
// 💾 GOOGLE SHEET
// =======================
const creds = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDS_BASE64, 'base64').toString()
);
creds.private_key = creds.private_key.replace(/\\n/g, '\n');

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function saveData(data, loc) {
  if (!data.inet) return;

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];
  let idx = rows.findIndex(r => r[3] === data.inet);

  const now = moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');

  const row = [
    now,
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
  ];

  if (idx !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${idx + 1}:K${idx + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });
    return { type: 'update' };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] }
  });

  return { type: 'insert' };
}

// =======================
// 🔍 COMMAND /cek (DIKEMBALIKAN)
// =======================
bot.onText(/\/cek (.+)/, async (msg, match) => {
  try {
    const chatId = msg.chat.id;
    const inet = match[1].trim();

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DATA!A:K',
    });

    const rows = res.data.values || [];
    const row = rows.find(r => r[3] === inet);

    if (!row) {
      return bot.sendMessage(chatId, `❌ INET ${inet} tidak ditemukan`);
    }

    await bot.sendMessage(chatId, `
📡 DATA

INET: ${row[3]}
STATUS: ${row[1]}
TIKET: ${row[2]}
CP: ${row[4]}
ODP: ${row[8]}
PETUGAS: ${row[9]}
📍: ${row[10]}
    `);

  } catch (err) {
    console.log(err);
  }
});

// =======================
// 🚀 MAIN
// =======================
bot.on('message', handleMsg);
bot.on('edited_message', handleMsg);

async function handleMsg(msg) {
  try {
    const chatId = msg.chat.id;

    const loc = getLocation(msg);
    if (loc) lastLocation[chatId] = loc;

    addBuffer(chatId, msg);
    await delay(1000);

    const combined = bufferMsg[chatId]
      .map(m => m.text || m.caption || '')
      .join('\n');

    bufferMsg[chatId] = [];

    if (!/MEDICAL/i.test(combined)) return;

    const blocks = splitMCU(combined);

    for (let b of blocks) {

      if (isReallyEmpty(b)) continue;

      const data = parseMCU(b);

      if (!data.inet) continue;

      const shareloc = lastLocation[chatId] || '';

      const res = await saveData(data, shareloc);

      if (res.type === 'insert') {
        await bot.sendMessage(chatId,
          `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
      } else {
        await bot.sendMessage(chatId,
          `🔄 Data berhasil di-update ke Google Sheet ✅`);
      }
    }

  } catch (err) {
    console.log(err);
  }
}

console.log('🚀 BOT FINAL FULL UTUH');
