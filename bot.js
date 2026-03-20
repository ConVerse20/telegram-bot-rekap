// =======================
// 🚀 MCU BOT FINAL ALL-IN-ONE (FIX GSHEET + CEK SESUAI)
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
  try {
    const webhookUrl = `${BASE_URL}/webhook`;
    await bot.deleteWebHook();
    await bot.setWebHook(webhookUrl);
  } catch (e) {}
});

// =======================
// UTIL
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
// FILTER KOSONG TOTAL
// =======================
function isReallyEmpty(txt) {
  return txt
    .replace(/MEDICAL\s*CHECK\s*UP\s*PELANGGAN/gi, '')
    .replace(/STATUS|NO TIKET|INET\/TLP|CP PELANGGAN|PENYEBAB GANGGUAN|LANGKAH PERBAIKAN|ALAMAT LENGKAP|NAMA ODP|PETUGAS/gi, '')
    .replace(/[\s:-]/g, '')
    .trim() === '';
}

// =======================
// CP (ASLI)
// =======================
function normalizeCP(cp) {
  if (!cp) return '';
  cp = cp.replace(/\s+/g, '');
  let list = cp.split('/');

  return list.map(n => {
    if (n.startsWith('+62')) return n;
    if (n.startsWith('62')) return '+62' + n.slice(2);
    if (n.startsWith('0')) return '+62' + n.slice(1);
    return n;
  }).join(' / ');
}

function normalizeCompare(cp) {
  return cp.replace(/\D/g, '').replace(/^0/, '62');
}

function explodeCP(cp) {
  if (!cp) return [];
  return cp.split('/').map(n => normalizeCompare(n));
}

// =======================
// SHARELOK
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
// BUFFER
// =======================
const bufferMsg = {};
const lastLocation = {};

function addBuffer(chatId, msg) {
  if (!bufferMsg[chatId]) bufferMsg[chatId] = [];
  bufferMsg[chatId].push(msg);
}

// =======================
// PARSER
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
  let cp = get('CP PELANGGAN', txt);

  if (/PENYEBAB|LANGKAH|ALAMAT|ODP|PETUGAS/i.test(cp)) cp = '';

  return {
    status: clean(get('STATUS', txt)),
    tiket: clean(get('NO TIKET', txt)),
    inet: clean(get('INET/TLP', txt)),
    cp: normalizeCP(clean(cp)),
    penyebab: clean(get('PENYEBAB GANGGUAN', txt)),
    perbaikan: clean(get('LANGKAH PERBAIKAN', txt)),
    alamat: clean(get('ALAMAT LENGKAP', txt)),
    odp: clean(get('NAMA ODP', txt)),
    petugas: clean(get('PETUGAS', txt)),
  };
}

// =======================
// GOOGLE SHEET (FIX RAPI)
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

  let shareChanged = false;

  if (idx !== -1) {
    let old = rows[idx];
    while (old.length < 11) old.push('');

    if (data.cp) {
      let existing = old[4] ? old[4].split(' / ') : [];
      let existClean = existing.map(e => normalizeCompare(e));
      let incoming = explodeCP(data.cp);

      incoming.forEach(n => {
        if (!existClean.includes(n)) {
          existing.push('+62' + n.replace(/^62/, ''));
        }
      });

      old[4] = existing.join(' / ');
    }

    if (data.status) old[1] = data.status;
    if (data.tiket) old[2] = data.tiket;
    if (data.penyebab) old[5] = data.penyebab;
    if (data.perbaikan) old[6] = data.perbaikan;
    if (data.alamat) old[7] = data.alamat;
    if (data.odp) old[8] = data.odp;
    if (data.petugas) old[9] = data.petugas;

    if (loc && loc !== old[10]) {
      old[10] = loc;
      shareChanged = true;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${idx + 1}:K${idx + 1}`,
      valueInputOption: 'RAW',
      resource: { values: [old.slice(0, 11)] }
    });

    return { type: 'update', shareChanged };
  }

  const newRow = [
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
    loc || ''
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'RAW',
    resource: { values: [newRow] }
  });

  return { type: 'insert', shareChanged: !!loc };
}

// =======================
// /CEK (SESUAI SS)
// =======================
bot.onText(/\/cek (.+)/, async (msg, match) => {
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
    return bot.sendMessage(chatId, `❌ data tidak ditemukan`);
  }

  const loc = row[10] || '';
  const [lat, lon] = loc.split(',');

  if (lat && lon) {
    await bot.sendLocation(chatId, parseFloat(lat), parseFloat(lon));
  }

  await bot.sendMessage(chatId,
`📡 INTERNET : ${row[3] || ''}
📞 CP : ${row[4] || ''}
📍 ALAMAT : ${row[7] || ''}
📡 ODP : ${row[8] || ''}`);
});

// =======================
// MAIN
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
        await bot.sendMessage(chatId, `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
      } else {
        await bot.sendMessage(chatId, `🔄 Data berhasil di-update ke Google Sheet ✅`);
      }

      if (res.shareChanged) {
        await bot.sendMessage(chatId, `📍 sharelok berhasil di-update ke Google Sheet ✅`);
      }
    }

  } catch (err) {
    console.log(err);
  }
}

console.log('🚀 FINAL FIX CLEAN');
