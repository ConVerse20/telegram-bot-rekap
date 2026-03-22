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
// 🔥 MERGE CP (TAMBAHAN)
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

// =======================
// 📦 BUFFER
// =======================
const bufferMsg = {};
const lastLocation = {};
const lastInet = {};

// 🔥 FIX USER BASED
const lastUserInet = {};
const lastUserLoc = {};

function getUsername(msg) {
  return msg.from.username || `id_${msg.from.id}`;
}

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

  if (kosong.length === Object.keys(fields).length) return [];

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

async function saveData(data, loc) {
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

  const now = moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');

  // 🔥 SHARELOK ONLY UPDATE
  if (!data.tiket && data.inet && loc) {
    let idx = -1;

    for (let i = normalizedRows.length - 1; i >= 0; i--) {
      if ((normalizedRows[i][3] || '').trim() === data.inet.trim()) {
        idx = i;
        break;
      }
    }

    if (idx !== -1) {
      let old = normalizedRows[idx];

      if (loc !== old[10]) {
        old[10] = loc;

        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `DATA!A${idx + 1}:K${idx + 1}`,
          valueInputOption: 'RAW',
          resource: { values: [old] }
        });

        return { type: 'update', shareChanged: true };
      }
    }

    return { type: 'update', shareChanged: false };
  }

  // 🔥 AMBIL CP LAMA
  let oldCP = '';
  for (let i = normalizedRows.length - 1; i >= 0; i--) {
    if ((normalizedRows[i][3] || '').trim() === (data.inet || '').trim()) {
      oldCP = normalizedRows[i][4] || '';
      break;
    }
  }

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

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'RAW',
    resource: { values: [row] }
  });

  return { type: 'insert', shareChanged: !!loc };
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
    const username = getUsername(msg);

    const locNow = getLocation(msg);

    // 🔥 SHARELOK USER SAFE
    if (locNow && lastUserInet[username]) {
      lastUserLoc[username] = locNow;

      await saveData(
        { inet: lastUserInet[username] },
        locNow
      );

      await bot.sendMessage(chatId, '📍 sharelok berhasil di-update ke Google Sheet ✅');
      return;
    }

    const loc = getLocation(msg);
    if (loc) lastLocation[chatId] = loc;

    addBuffer(chatId, msg);
    await delay(1000);

    const combined = bufferMsg[chatId]
      .map(m => m.text || m.caption || '')
      .join('\n');

    bufferMsg[chatId] = [];

    const mcuText = extractMCU(combined);
    if (!mcuText) return;

    const data = parseMCU(mcuText);

    const allFields = Object.values(data);
    const isAllEmpty = allFields.every(v => !v || v.toString().trim() === '');
    if (isAllEmpty) return;

    const emptyFields = getEmptyFields(data);
    const userTag = getUserTag(msg);

    if (data.inet) {
      lastUserInet[username] = data.inet;
    }

    const shareloc = lastUserLoc[username] || undefined;

    const res = await saveData(data, shareloc);

    if (res.type === 'insert') {
      await bot.sendMessage(chatId, '🆕 Data Baru sudah Dicatet ke Google Sheet ✅');
    } else {
      await bot.sendMessage(chatId, '🔄 Data berhasil di-update ke Google Sheet ✅');
    }

    if (res.shareChanged) {
      await bot.sendMessage(chatId, '📍 sharelok berhasil di-update ke Google Sheet ✅');
    }

    if (emptyFields.length > 0 && !msg.edit_date) {
      await bot.sendMessage(
        chatId,
        `⚠️ DATA BELUM LENGKAP

👤 ${userTag}

Field kosong:
- ${emptyFields.join('\n- ')}

✏️ Silakan dilengkapi dengan cara *EDIT pesan sebelumnya*, tidak perlu kirim ulang.`,
        {
          parse_mode: 'Markdown',
          reply_to_message_id: msg.message_id
        }
      );
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

console.log('🚀 FINAL PERFECT FIX (NO OVERWRITE + CP MERGE + SHARELOK AMAN)');
