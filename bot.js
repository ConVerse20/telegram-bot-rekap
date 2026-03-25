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

// 🔥 PATCH CHAT BASE (BIAR GA ERROR)
const lastRowByChat = {};

// 🔥 TRACK REMINDER MESSAGE
const lastReminderMsg = {};

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
  const r = new RegExp(`${label}\\s*:\\s*([^\\n]*)`, 'i');
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

  for (let i = normalizedRows.length - 1; i >= 0; i--) {

    const rowInet = (normalizedRows[i][3] || '').trim();
    const rowTiket = (normalizedRows[i][2] || '').trim();

    if (!data.tiket) {
      if (rowInet === (data.inet || '').trim()) {
        idx = i;
        oldCP = normalizedRows[i][4] || '';
        break;
      }
    } else {
      if (
        rowInet === (data.inet || '').trim() &&
        rowTiket === (data.tiket || '').trim()
      ) {
        idx = i;
        oldCP = normalizedRows[i][4] || '';
        break;
      }
    }
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

  if (idx !== -1) {
    let old = normalizedRows[idx];

    old[0] = now;
    old[1] = data.status || old[1];
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
      resource: { values: [old] }
    });

    return { type: 'update', rowIndex: idx + 1 }; // 🔥 PATCH
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'RAW',
    resource: { values: [row] }
  });

  return { type: 'insert', rowIndex: rows.length + 1 }; // 🔥 PATCH
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
    const userId = msg.from.id;
    const key = `${chatId}_${userId}`;

    lastUser[chatId] = userId;

    const locNow = getLocation(msg);

    if (locNow) {
  lastLocation[chatId] = locNow; // tetap (jangan dihapus)
  lastLocationByUser[key] = locNow; // 🔥 tambahan
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

  // 🔥 hanya proses kalau BENAR2 sharelok
  if (locOnly && lastInetByUser[key]) {

    await saveData(
      { inet: lastInetByUser[key] },
      locOnly,
      false
    );

    await bot.sendMessage(chatId, '📍 sharelok berhasil di-update ke Google Sheet ✅');
  }

  return;
}
    await saveData(
      { inet: lastInetByUser[key] },
      lastLocationByUser[key],
      false
    );

    await bot.sendMessage(chatId, '📍 sharelok berhasil di-update ke Google Sheet ✅');
  }

  return;
}

    const data = parseMCU(mcuText);

    if (data.inet) {
      mcuReady[chatId] = true;
      lastInet[chatId] = data.inet; // tetap
lastInetByUser[key] = data.inet; // 🔥 tambahan
    }

    // 🔥 PATCH SHARELOK
    let finalLoc = lastLocation[chatId] || '';

    const locFromBuffer = tempBuffer
      ?.map(m => getLocation(m))
      .find(v => v);

    if (locFromBuffer) finalLoc = locFromBuffer;

    const emptyFields = getEmptyFields(data);
    // =======================
// 🔥 PATCH: SHARELOK SAJA (UPDATE KE DATA TERAKHIR)
// =======================
 

// 🔥 PATCH: JANGAN SAVE MCU KOSONG
if (emptyFields === 'ALL_EMPTY') return;

// 🔥 PATCH: SHARELOK SAJA (AMAN PER USER)
if (!data.inet && !data.tiket) {

  if (lastRowByUser[key] && lastLocationByUser[key]) {

    await saveData(
      { inet: lastInetByUser[key] },
      lastLocationByUser[key],
      false
    );

    await bot.sendMessage(chatId, '📍 sharelok berhasil di-update ke Google Sheet ✅');
  }

  return;
}

    const res = await saveData(
      data,
      finalLoc,
      !!msg.edit_date
    );

    // 🔥 PATCH ROW TRACK
    if (res && res.rowIndex) {
      lastRowByChat[chatId] = res.rowIndex; // tetap
lastRowByUser[key] = res.rowIndex;    // 🔥 tambahan
    }

    if (res.type === 'insert') {
      await bot.sendMessage(chatId, '🆕 Data Baru sudah Dicatet ke Google Sheet ✅');
    } else {
      await bot.sendMessage(chatId, '🔄 Data berhasil di-update ke Google Sheet ✅');
    }
    // 🔥 AUTO HAPUS REMINDER JIKA SUDAH LENGKAP
if (emptyFields.length === 0 && lastReminderMsg[chatId]) {
  try {
    await bot.deleteMessage(chatId, lastReminderMsg[chatId]);
    delete lastReminderMsg[chatId];
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

  // 🔥 simpan id reminder
  lastReminderMsg[chatId] = sent.message_id;
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
    console.log(err);
  }
});

console.log('🚀 FINAL FIX TANPA MERUBAH FLOW');
