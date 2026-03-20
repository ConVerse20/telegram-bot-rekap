// =======================
// 🚀 MCU BOT FINAL ALL-IN-ONE (WEBHOOK SAFE + FIX GSHEET RAPI)
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
    console.log('🚀 WEBHOOK AKTIF:', webhookUrl);
  } catch (e) {
    console.log('❌ WEBHOOK ERROR:', e.message);
  }
});

// =======================
// 🧠 UTIL
// =======================
const delay = ms => new Promise(r => setTimeout(r, ms));

// 🔥 FIX CLEAN (tidak ubah logic, hanya bersihin prefix)
function clean(v) {
  if (!v) return '';

  v = v.trim();

  // hapus "- " di depan
  v = v.replace(/^-\s*/g, '');

  // hapus "LABEL :"
  v = v.replace(/^[A-Z\s\/]+:\s*/i, '');

  if (v === '-' || v === ':' || v === 'x') return '';
  if (/nama odp/i.test(v)) return '';
  if (/petugas/i.test(v)) return '';

  return v.trim();
}

// =======================
// 📱 CP (ASLI)
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

// 🔥 FIX GET (biar label tidak ikut)
function get(label, txt) {
  const r = new RegExp(`${label}\\s*:\\s*([^\\n-]*)`, 'i');
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

  let shareChanged = false;

  if (idx !== -1) {
    let old = rows[idx];
    while (old.length < 11) old.push('');

    if (data.cp) {
      let existingRaw = old[4] ? old[4].split(' / ') : [];
      let existingClean = existingRaw.map(e => normalizeCompare(e));
      let newClean = explodeCP(data.cp);

      newClean.forEach(n => {
        if (!existingClean.includes(n)) {
          existingRaw.push('+62' + n.replace(/^62/, ''));
        }
      });

      old[4] = existingRaw.join(' / ');
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

    // 🔥 FIX ANTI GESER
    const fixedRow = [
      old[0] || now,
      old[1] || '',
      old[2] || '',
      old[3] || data.inet,
      old[4] || '',
      old[5] || '',
      old[6] || '',
      old[7] || '',
      old[8] || '',
      old[9] || '',
      old[10] || ''
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${idx + 1}:K${idx + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [fixedRow] }
    });

    return { type: 'update', shareChanged };
  }

  const newRow = [
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

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [newRow] }
  });

  return { type: 'insert', shareChanged: !!loc };
}

// =======================
// 🚀 MAIN (TIDAK DIUBAH)
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

      const data = parseMCU(b);

      const adaIsi = Object.values(data).some(v => v);
      if (!adaIsi) continue;
      if (!data.inet) continue;

      const shareloc = lastLocation[chatId] || '';

      const fields = {
        "INET/TLP": data.inet,
        "CP PELANGGAN": data.cp,
        "ALAMAT LENGKAP": data.alamat,
        "NAMA ODP": data.odp,
        "PETUGAS": data.petugas
      };

      const kosong = Object.keys(fields).filter(k => !fields[k]);
      const semuaKosong = Object.values(fields).every(v => !v);

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
        await bot.sendMessage(chatId,
          `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
      } else {
        await bot.sendMessage(chatId,
          `🔄 Data berhasil di-update ke Google Sheet ✅`);
      }

      if (res.shareChanged) {
        await bot.sendMessage(chatId,
          `📍 sharelok berhasil di-update ke Google Sheet ✅`);
      }
    }

  } catch (err) {
    console.log(err);
  }
}

console.log('🚀 BOT FINAL FIX GSHEET RAPI (FITUR UTUH)');
