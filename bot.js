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

// 🔥 PATCH USER BASE (ANTI TERTIMPA)
const lastRowByUser = {};
const lastInetByUser = {};
const lastLocationByUser = {};
const lastMCUByUser = {};

// 🔥 PATCH CHAT BASE (BIAR GA ERROR)
const lastRowByChat = {};

// 🔥 TRACK REMINDER MESSAGE
const lastReminderMsgByUser = {};

function clean(v) {
  if (!v) return '';
  v = v.trim();
  v = v.replace(/^[:\-\s]+/, '').trim();

  if (/^(STATUS|NO TIKET|INET|CP|PENYEBAB|LANGKAH|ALAMAT|NAMA ODP|PETUGAS)/i.test(v))
    return '';

  if (v === '-' || v === ':' || v === '') return '';
  if (/^[:\-]+$/.test(v)) return '';

  return v;
}

// =======================
// 📱 CP NORMAL
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
// 🔥 MERGE CP
// =======================
function mergeCP(oldCP, newCP) {
  const set = new Set();

  function splitCP(cp) {
    if (!cp) return [];
    return cp.split('/').map(x => x.trim()).filter(Boolean);
  }

  splitCP(oldCP).forEach(v => set.add(v));
  splitCP(newCP).forEach(v => set.add(v));

  return normalizeCP(Array.from(set).join('/'));
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

// 🔥 FLAG MCU SUDAH MASUK
const mcuReady = {};

// =======================
// 📦 BUFFER
// =======================
const bufferMsg = {};
const lastLocation = {};
const lastInet = {};
const lastUser = {}; // 🔥 tambahan

function addBuffer(chatId, msg) {
  if (!bufferMsg[chatId]) bufferMsg[chatId] = [];
  bufferMsg[chatId].push(msg);
}

// =======================
// 🧠 PARSER
// =======================
function get(label, txt) {
  const r = new RegExp(`${label}\\s*:?\\s*([^\\n]*)`, 'i');
  const m = txt.match(r);
  if (!m) return '';

  let val = m[1].trim();
  val = val.replace(/^[:\-\s]+/, '').trim();

  if (val === '') return '';
  return val;
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
// 🔍 AMBIL INET DARI TEXT (FALLBACK)
// =======================
function extractInetFromText(text) {
  if (!text) return '';

  const m = text.match(/INET\/TLP\s*:\s*([^\n]+)/i);
  if (m) return clean(m[1]);

  return '';
}

// =======================
// 🔥 MCU ONLY
// =======================
function extractMCU(text) {
  const start = text.search(/MEDICAL CHECK UP PELANGGAN/i);
  if (start === -1) return '';

  const sub = text.slice(start);

  const endMatch = sub.match(/PETUGAS\s*:[^\n]*/i);
  if (!endMatch) return '';

  const endIndex = sub.indexOf(endMatch[0]) + endMatch[0].length;

  return sub.slice(0, endIndex);
}

// =======================
// 🧠 VALIDASI
// =======================
function getEmptyFields(data) {
  const fields = {
    STATUS: data.status,
    'NO TIKET': data.tiket,
    INET: data.inet,
    CP: data.cp,
    PENYEBAB: data.penyebab,
    PERBAIKAN: data.perbaikan,
    ALAMAT: data.alamat,
    'NAMA ODP': data.odp,
    PETUGAS: data.petugas,
  };

  const kosong = Object.entries(fields)
    .filter(([_, v]) => !v || v.toString().trim() === '')
    .map(([k]) => k);

  if (kosong.length === Object.keys(fields).length) return 'ALL_EMPTY';

  return kosong;
}

function getUserTag(msg) {
  if (msg.from.username) return `@${msg.from.username}`;
  return msg.from.first_name || 'User';
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

async function saveData(data, loc, isEdit = false) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
 // 🔥 VALIDASI FINAL (LAST DEFENSE)
  if (!data.tiket || !data.inet) {
    console.log('❌ SKIP SAVE (DATA TIDAK VALID)', data);
    return { type: 'skip' };
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];
  const normalizedRows = rows.map(r => {
    while (r.length < 11) r.push('');
    return r;
  });

  let oldCP = '';
let idx = -1;

// ==========================
// 1. CARI EXACT MATCH (INET + TIKET)
// ==========================
  // 🔥 TAMBAH DI SINI
if (data.tiket === 'LAPSUNG') {
  idx = -1;
}
for (let i = normalizedRows.length - 1; i >= 0; i--) {

  const rowInet = (normalizedRows[i][3] || '').trim();
  const rowTiket = (normalizedRows[i][2] || '').trim();

  if (
    rowInet === (data.inet || '').trim() &&
    rowTiket === (data.tiket || '').trim()
  ) {
    idx = i;
    oldCP = normalizedRows[i][4] || '';
    break;
  }
}

// ==========================
// 2. KALAU TIDAK ADA → AMBIL CP SAJA (JANGAN SET IDX)
// ==========================
if (idx === -1) {

  const cpSet = new Set();

  for (let i = normalizedRows.length - 1; i >= 0; i--) {

    const rowInet = (normalizedRows[i][3] || '').trim();

    if (rowInet === (data.inet || '').trim()) {

      const cp = normalizedRows[i][4] || '';

      cp.split('/').forEach(v => {
        v = v.trim();
        if (v) cpSet.add(v);
      });
    }
  }

  oldCP = Array.from(cpSet).join(' / ');
}

  const now = moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');
  const row = [
    now,
    data.status || '',
    data.tiket || '',
    data.inet || '',
    mergeCP(oldCP, data.cp),
    data.penyebab || '',
    data.perbaikan || '',
    data.alamat || '',
    data.odp || '',
    data.petugas || '',
    loc || '',
  ];

  // ✅ Jika ketemu baris lama → update
  // 🔥 FINAL GUARD (ANTI NIBAN TOTAL)
if (
  idx !== -1 &&
  normalizedRows[idx] &&
  (normalizedRows[idx][3] || '').trim() === (data.inet || '').trim() &&
  (normalizedRows[idx][2] || '').trim() === (data.tiket || '').trim()
) {
    const old = normalizedRows[idx];
    old[1] = data.status || old[1];
    old[2] = data.tiket || old[2];
    old[3] = data.inet || old[3];
    old[4] = mergeCP(old[4], data.cp);
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
      resource: { values: [old] },
    });
    return { type: 'update', rowIndex: idx + 1 };
  }

  // ✅ Kalau tidak ditemukan → insert baru
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'RAW',
    resource: { values: [row] },
  });

  return { type: 'insert', rowIndex: rows.length + 1 };
}


// =======================
// 🚀 MAIN
// =======================
bot.on('message', handleMsg);
bot.on('edited_message', handleMsg);

async function handleMsg(msg) {
  try {

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const key = msg.chat.type === 'private'
  ? `${userId}`        // 🔥 japri fix
  : `${chatId}_${userId}`; // grup tetap per user

    // 🔥 ANTI DOUBLE EDIT TRIGGER (PER MESSAGE)
    if (!global.lastProcessedEdit) global.lastProcessedEdit = {};

    const editKey = `${chatId}_${msg.message_id}`;

    if (msg.edit_date && global.lastProcessedEdit[editKey] === msg.edit_date) {
      return;
    }

    if (msg.edit_date) {
      global.lastProcessedEdit[editKey] = msg.edit_date;
    }

    if (msg.text && msg.text.startsWith('/cek')) return;

    lastUser[chatId] = userId;

    const locNow = getLocation(msg);

    if (locNow) {
      lastLocation[chatId] = locNow;
      lastLocationByUser[key] = locNow;
    }

    addBuffer(chatId, msg);
    await delay(1000);

    // 🔥 PATCH BUFFER (ANTI HILANG)
    const tempBuffer = bufferMsg[chatId];

    const combined = tempBuffer
      .map(m => m.text || m.caption || '')
      .join('\n');

    bufferMsg[chatId] = [];

    const mcuText = extractMCU(combined);
  if (!mcuText) {

  const locOnly = getLocation(msg);

  const lastMCU = lastMCUByUser[key];

  // ❌ kalau bukan pengirim MCU → tolak
  if (locOnly && !lastMCU) {
    console.log('❌ Sharelok ditolak (tidak ada MCU dari user ini)');
    return;
  }

  // ✅ kalau valid → lanjut save
  if (locOnly && lastMCU) {

    let res = await saveData(
      { 
        inet: lastMCU.inet,
        tiket: lastMCU.tiket
      },
      locOnly,
      false
    );

    if (res && res.rowIndex) {
      lastRowByUser[key] = res.rowIndex;
      lastRowByChat[chatId] = res.rowIndex;
    }

    await bot.sendMessage(chatId, '📍 sharelok berhasil di-update ke Google Sheet ✅');
  }

  return;
}

    const data = parseMCU(mcuText);
    // 🔥 NORMALISASI TIKET
if (/lapsung/i.test(data.tiket)) {
  data.tiket = 'LAPSUNG';
}

// 🔥 VALIDASI
if (!data.tiket || !data.inet) {
  return;
}
    // 🔥 SIMPAN MCU PER USER (WAJIB)
lastMCUByUser[key] = {
  inet: data.inet,
  tiket: data.tiket
};

    // 🔍 DEBUG
console.log({
  tiket: data.tiket,
  inet: data.inet
});

    if (data.inet) {
      mcuReady[chatId] = true;
      lastInet[chatId] = data.inet; // tetap

    }

    // 🔥 PATCH SHARELOK
let finalLoc = '';

const locFromBuffer = tempBuffer
  ?.map(m => getLocation(m))
  .find(v => v);

if (locFromBuffer) {
  finalLoc = locFromBuffer;

  // simpan ke cache kalau memang ada kiriman baru
  lastLocation[chatId] = finalLoc;
  lastLocationByUser[key] = finalLoc;
}

const emptyFields = getEmptyFields(data);

// 🔥 STOP kalau kosong semua (HARUS DI ATAS)
if (emptyFields === 'ALL_EMPTY') return;

// 🔥 LANGSUNG PROSES (DATA-DRIVEN, BUKAN USER-DRIVEN)
if (data.inet && data.tiket)  {

  // 🔥 REMINDER MCU KURANG LENGKAP
if (emptyFields.length > 0 && !msg.edit_date) {

  const sent = await bot.sendMessage(
    chatId,
    `⚠️ DATA BELUM LENGKAP

👤 ${getUserTag(msg)}

Field kosong:
- ${emptyFields.join('\n- ')}

✏️ Silakan dilengkapi dengan cara EDIT pesan sebelumnya.`,
    {
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id
    }
  );

  lastReminderMsgByUser[key] = sent.message_id;
}

// 🔥 HAPUS REMINDER kalau sudah lengkap
if (emptyFields.length === 0 && lastReminderMsgByUser[key]) {
  try {
    await bot.deleteMessage(chatId, lastReminderMsgByUser[key]);
    delete lastReminderMsgByUser[key];
  } catch (e) {}
}
// 🔥 DEBUG SHARELOK
if (!finalLoc) {
  console.log('📍 Tidak ada sharelok baru, skip update lokasi');
}


  let res = await saveData({ ...data, _key: key }, finalLoc, !!msg.edit_date);

  if (res && res.rowIndex) {
    lastRowByChat[chatId] = res.rowIndex;
    lastRowByUser[key] = res.rowIndex;
  }

  lastInetByUser[key] = data.inet;

  if (res.type === 'insert') {
    await bot.sendMessage(chatId, '🆕 Data MCU baru masuk ke Google Sheet ✅');
  } else {
    await bot.sendMessage(chatId, '🔄 Data MCU berhasil di-update ke Google Sheet ✅');
  }
}




// 🔥 PATCH: SHARELOK SAJA (AMAN PER USER)
if (!data.inet && !data.tiket) {

  if (lastRowByUser[key] && lastLocationByUser[key]) {

    let res = await saveData(
      data,
      finalLoc,
      !!msg.edit_date
    );

    if (res && res.rowIndex) {
      lastRowByChat[chatId] = res.rowIndex;
      lastRowByUser[key] = res.rowIndex;
    }

    if (res.type === 'insert') {
      await bot.sendMessage(chatId, '🆕 Data Baru sudah Dicatet ke Google Sheet ✅');
    } else {
      await bot.sendMessage(chatId, '🔄 Data berhasil di-update ke Google Sheet ✅');
    }

    if (emptyFields.length === 0 && lastReminderMsgByUser[key]) {
      try {
        await bot.deleteMessage(chatId, lastReminderMsgByUser[key]);
        delete lastReminderMsgByUser[key];
      } catch (e) {}
    }

    if (emptyFields.length > 0 && !msg.edit_date) {
      const sent = await bot.sendMessage(
        chatId,
        `⚠️ DATA BELUM LENGKAP

👤 ${getUserTag(msg)}

Field kosong:
- ${emptyFields.join('\n- ')}

✏️ Silakan dilengkapi dengan cara EDIT pesan sebelumnya.`,
        {
          parse_mode: 'Markdown',
          reply_to_message_id: msg.message_id
        }
      );

      lastReminderMsgByUser[key] = sent.message_id;
    }

  } // ✅ tutup IF dalam
} // ✅ tutup IF luar

// ✅ BARU catch
} catch (err) {
  console.log('❌ ERROR:', err.message);
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

    let row = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if ((rows[i][3] || '').trim() === inet) {
        row = rows[i];
        break;
      }
    }

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
🌐  INTERNET : ${row[3] || '-'}
📞 CP : ${row[4] || '-'}
📍 ALAMAT : ${row[7] || '-'}
📡 ODP : ${row[8] || '-'}
`;

    await bot.sendMessage(chatId, text.trim());

  } catch (err) {
  console.log('❌ ERROR:', err.message);
}
});

console.log('🚀 FINAL FIX TANPA MERUBAH FLOW');
