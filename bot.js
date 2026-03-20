// =======================
// 🚀 MCU BOT FINAL (LOCK - NO CHANGE FLOW)
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
});

// =======================
// 🧠 UTIL
// =======================
const delay = ms => new Promise(r => setTimeout(r, ms));

function clean(v) {
  if (!v) return '';
  v = v.trim();

  if (
    v === '-' ||
    v === ':' ||
    v === '' ||
    /STATUS|NO TIKET|INET|CP|PENYEBAB|LANGKAH|ALAMAT|ODP|PETUGAS/i.test(v)
  ) return '';

  return v;
}

// =======================
// 📱 CP NORMAL (ASLI)
// =======================
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
// 📍 SHARELOK
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

  m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return `${m[1]},${m[2]}`;

  return '';
}

// =======================
// 📦 BUFFER
// =======================
const bufferMsg = {};
const lastLocation = {};
const lastInet = {};

function addBuffer(chatId, msg) {
  if (!bufferMsg[chatId]) bufferMsg[chatId] = [];
  bufferMsg[chatId].push(msg);
}

// =======================
// 🧠 PARSER (FIX FINAL)
// =======================
function get(label, txt) {
  const lines = txt.split('\n');

  for (let line of lines) {
    if (line.toUpperCase().includes(label)) {
      let val = line.split(':').slice(1).join(':').trim();

      if (!val || val === '-' || val === ':') return '';

      if (/STATUS|NO TIKET|INET|CP|PENYEBAB|LANGKAH|ALAMAT|ODP|PETUGAS/i.test(val)) {
        return '';
      }

      return val;
    }
  }

  return '';
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

async function saveData(data, loc) {
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
    data.status || '',
    data.tiket || '',
    data.inet || '',
    data.cp || '',
    data.penyebab || '',
    data.perbaikan || '',
    data.alamat || '',
    data.odp || '',
    data.petugas || '',
    loc || '',
  ];

  if (idx !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${idx + 1}:K${idx + 1}`,
      valueInputOption: 'RAW',
      resource: { values: [row] }
    });
    return { type: 'update' };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'RAW',
    resource: { values: [row] }
  });

  return { type: 'insert' };
}

// =======================
// 🚀 MAIN
// =======================
bot.on('message', handleMsg);
bot.on('edited_message', handleMsg);

async function handleMsg(msg) {
  try {
    if (msg.text && msg.text.startsWith('/cek')) return;

    const chatId = msg.chat.id;

    // SHARELOK TERPISAH
    const locNow = getLocation(msg);
    if (locNow && lastInet[chatId]) {
      await saveData({ inet: lastInet[chatId] }, locNow);
      await bot.sendMessage(chatId, '📍 sharelok berhasil di-update ke Google Sheet ✅');
    }

    const loc = getLocation(msg);
    if (loc) lastLocation[chatId] = loc;

    addBuffer(chatId, msg);
    await delay(1000);

    const combined = bufferMsg[chatId]
      .map(m => m.text || m.caption || '')
      .join('\n');

    bufferMsg[chatId] = [];

    if (!/MEDICAL/i.test(combined)) return;

    const data = parseMCU(combined);
    if (!data.inet) return;

    lastInet[chatId] = data.inet;

    // 🔔 REMINDER (BALIK SEPERTI AWAL)
    const fields = {
      "INET/TLP": data.inet,
      "CP PELANGGAN": data.cp,
      "ALAMAT LENGKAP": data.alamat,
      "NAMA ODP": data.odp
    };

    const kosong = Object.keys(fields).filter(k => !fields[k]);
    const semuaKosong = Object.values(fields).every(v => !v);

    if (kosong.length && !semuaKosong) {
      const user = msg.from.username ? '@' + msg.from.username : msg.from.first_name;

      await bot.sendMessage(
        chatId,
        `⚠️ ${user} data belum lengkap (${kosong.join(', ')}) silahkan dilengkapi.`
      );
    }

    const shareloc = lastLocation[chatId] || '';
    const res = await saveData(data, shareloc);

    if (res.type === 'insert') {
      await bot.sendMessage(chatId, '🆕 Data Baru sudah Dicatet ke Google Sheet ✅');
    } else {
      await bot.sendMessage(chatId, '🔄 Data berhasil di-update ke Google Sheet ✅');
    }

  } catch (err) {
    console.log(err);
  }
}

// =======================
// 🔎 /CEK
// =======================
bot.onText(/^\/cek (.+)/i, async (msg, match) => {
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
      return bot.sendMessage(chatId, '❌ Data tidak ditemukan');
    }

    const loc = row[10] || '';

    if (loc) {
      const [lat, lon] = loc.split(',');
      if (lat && lon) {
        await bot.sendLocation(chatId, parseFloat(lat), parseFloat(lon));
      }
    }

    const text = `
🌐 INTERNET : ${row[3] || '-'}
📞 CP : ${row[4] || '-'}
📍 ALAMAT : ${row[7] || '-'}
📡 ODP : ${row[8] || '-'}
`;

    await bot.sendMessage(chatId, text.trim());

  } catch (err) {
    console.log(err);
  }
});

console.log('🚀 FINAL STABLE - ALL FIXED');
