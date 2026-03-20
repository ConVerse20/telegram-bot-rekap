// =======================
// 🚀 MCU BOT FINAL ALL-IN-ONE (LOCK FINAL)
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
// 🧠 UTIL (ASLI)
// =======================
const delay = ms => new Promise(r => setTimeout(r, ms));

function clean(v) {
  if (!v) return '';
  v = v.trim();
  if (v === '-' || v === ':' || v === 'x') return '';
  return v;
}

// =======================
// 📱 CP (ASLI JANGAN DIUBAH)
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

function normalizeCompare(cp) {
  return cp.replace(/\D/g, '').replace(/^0/, '62');
}

function explodeCP(cp) {
  if (!cp) return [];
  return cp.split('/').map(n => normalizeCompare(n));
}

// =======================
// 📍 SHARELOK (ASLI)
// =======================
function getLocation(msg) {
  if (msg.location)
    return `${msg.location.latitude},${msg.location.longitude}`;

  if (msg.reply_to_message?.location)
    return `${msg.reply_to_message.location.latitude},${msg.reply_to_message.location.longitude}`;

  const text = msg.text || msg.caption || '';

  let m = text.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) return `${m[1]},${m[2]}`;

  return '';
}

// =======================
// 📦 BUFFER (ASLI)
// =======================
const bufferMsg = {};
const lastLocation = {};

function addBuffer(chatId, msg) {
  if (!bufferMsg[chatId]) bufferMsg[chatId] = [];
  bufferMsg[chatId].push(msg);
}

// =======================
// 🧠 PARSER (FIX MINIMAL)
// =======================
function get(label, txt) {
  const r = new RegExp(`${label}\\s*:\\s*([^\\n]*)`, 'i');
  const m = txt.match(r);
  return m ? m[1].replace(/^-/, '').trim() : '';
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
// 💾 GOOGLE SHEET (FIX RAPI TANPA UBAH STRUKTUR)
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
    let old = rows[idx];
    while (old.length < 11) old.push('');

    // ❗ FIX: jangan geser kolom
    old[1] = data.status || old[1];
    old[2] = data.tiket || old[2];
    old[3] = data.inet || old[3];
    old[4] = data.cp || old[4];
    old[5] = data.penyebab || old[5];
    old[6] = data.perbaikan || old[6];
    old[7] = data.alamat || old[7];
    old[8] = data.odp || old[8];
    old[9] = data.petugas || old[9];

    if (loc) old[10] = loc;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${idx + 1}:K${idx + 1}`,
      valueInputOption: 'RAW',
      resource: { values: [old] }
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
// 🚀 MAIN (ASLI + FIX REMINDER)
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

    const data = parseMCU(combined);

    if (!data.inet) return;

    const shareloc = lastLocation[chatId] || '';

    // 🔥 FIX REMINDER SESUAI /CEK
    const kosong = [];

    if (!data.inet) kosong.push("INET");
    if (!data.cp) kosong.push("CP");
    if (!data.alamat) kosong.push("ALAMAT");
    if (!data.odp) kosong.push("ODP");

    const semuaKosong =
      !data.inet && !data.cp && !data.alamat && !data.odp;

    if (kosong.length && !semuaKosong) {
      const user = msg.from.username
        ? '@' + msg.from.username
        : msg.from.first_name;

      await bot.sendMessage(
        chatId,
        `⚠️ ${user} data belum lengkap (${kosong.join(', ')}) silahkan dilengkapi.`
      );
    }

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

console.log('🚀 BOT FINAL LOCK (FITUR UTUH)');
