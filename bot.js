// =======================
// 🚀 MCU BOT FINAL (FIX TOTAL KOSONG REAL)
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

if (!TOKEN) throw new Error("BOT_TOKEN kosong");
if (!SHEET_ID) throw new Error("SPREADSHEET_ID kosong");

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

// ===== LOCK =====
const processing = new Set();

// ===== CACHE =====
let sheetCache = [];
let lastFetch = 0;

// ===== ANTI SPAM =====
const lastWarn = {};

// ===== WEBHOOK =====
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  try {
    const webhookUrl = `${BASE_URL}/webhook`;
    await bot.deleteWebHook();
    await bot.setWebHook(webhookUrl);
    console.log('🚀 WEBHOOK AKTIF:', webhookUrl);
  } catch (e) {
    console.log('❌ WEBHOOK ERROR:', e.message);
  }
});

// =======================
// 🔁 RETRY
// =======================
async function retry(fn, times = 3) {
  let err;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw err;
}

// =======================
// 🧠 UTIL
// =======================
function clean(v) {
  if (!v) return '';
  v = v.trim();
  if (v === '-' || v === ':' || v === 'x') return '';
  if (/nama odp/i.test(v)) return '';
  if (/petugas/i.test(v)) return '';
  return v;
}

function normalizeCP(cp) {
  if (!cp) return '';
  cp = cp.replace(/\s+/g, '');
  return cp.split('/').map(n => {
    if (n.startsWith('+62')) return n;
    if (n.startsWith('62')) return '+62' + n.slice(2);
    if (n.startsWith('0')) return '+62' + n.slice(1);
    return n;
  }).join(' / ');
}

// =======================
// 📍 LOCATION
// =======================
function getLocation(msg) {
  if (msg.location)
    return `${msg.location.latitude},${msg.location.longitude}`;

  if (msg.reply_to_message?.location)
    return `${msg.reply_to_message.location.latitude},${msg.reply_to_message.location.longitude}`;

  const text = msg.text || msg.caption || '';

  let m = text.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) return `${m[1]},${m[2]}`;

  m = text.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return `${m[1]},${m[2]}`;

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

  return parts.map(p => {
    let cleanText = p.split(/contoh\s*:/i)[0];
    return "MEDICAL CHECK UP PELANGGAN :" + cleanText;
  });
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
    cp: normalizeCP(clean(get('CP PELANGGAN', txt))),
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

async function getSheetRows(sheets) {
  if (Date.now() - lastFetch < 5000 && sheetCache.length) {
    return sheetCache;
  }

  const res = await retry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DATA!A:K',
    })
  );

  sheetCache = (res.data.values || []).filter(r => r[3]);
  lastFetch = Date.now();
  return sheetCache;
}

async function saveData(data, loc) {
  if (!data.inet) return { type: 'skip' };

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const rows = await getSheetRows(sheets);
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
    await retry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `DATA!A${idx + 1}:K${idx + 1}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] }
      })
    );
    return { type: 'update' };
  }

  await retry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'DATA!A:K',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    })
  );

  return { type: 'insert' };
}

// =======================
// 🚀 MAIN
// =======================
bot.on('message', handleMsg);
bot.on('edited_message', handleMsg);

async function handleMsg(msg) {
  try {
    const chatId = msg.chat.id;

    addBuffer(chatId, msg);
    await new Promise(r => setTimeout(r, 1000));

    const combined = bufferMsg[chatId]
      .map(m => m.text || m.caption || '')
      .join('\n');

    bufferMsg[chatId] = [];

    if (!/MEDICAL/i.test(combined)) return;

    const blocks = splitMCU(combined);

    for (let b of blocks) {
      const data = parseMCU(b);

      // ✅ FIX FINAL: semua field kosong → SKIP TOTAL
      const semuaKosong =
        !data.status &&
        !data.tiket &&
        !data.inet &&
        !data.cp &&
        !data.penyebab &&
        !data.perbaikan &&
        !data.alamat &&
        !data.odp &&
        !data.petugas;

      if (semuaKosong) continue;

      if (!data.inet) continue;

      const res = await saveData(data, '');

      if (res.type === 'insert') {
        await bot.sendMessage(chatId,
          `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
      } else {
        await bot.sendMessage(chatId,
          `🔄 Data berhasil di-update ke Google Sheet ✅`);
      }
    }

  } catch (err) {
    console.error(err);
  }
}

console.log('🚀 BOT FIX TOTAL KOSONG');
