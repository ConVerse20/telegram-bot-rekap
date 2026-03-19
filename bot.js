// =======================
// 🚀 MCU BOT FINAL STABLE (NO RESET WEBHOOK)
// =======================

const { google } = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const express = require('express');

const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 3000;

// 🔥 TANPA polling & TANPA setWebhook
const bot = new TelegramBot(TOKEN);
const app = express();

app.use(express.json());

// ===== WEBHOOK HANDLER (INI YANG DIPAKAI TELEGRAM) =====
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log('🚀 BOT STABIL (WEBHOOK TANPA RESET)');
});

// =======================
// 🔧 UTIL
// =======================
const delay = ms => new Promise(r => setTimeout(r, ms));
const safe = v => v ? v.toString().trim() : '';

function normalizeCP(cp) {
  if (!cp) return '';
  cp = cp.replace(/\s+/g, '');

  let list = cp.split('/');
  list = list.map(n => {
    if (n.startsWith('+62')) return n;
    if (n.startsWith('62')) return '+' + n;
    if (n.startsWith('0')) return '+62' + n.slice(1);
    return n;
  });

  return list.join(' / ');
}

// =======================
// 📍 SHARELOK
// =======================
function getLocation(msg) {
  if (msg.location)
    return `${msg.location.latitude},${msg.location.longitude}`;

  if (msg.reply_to_message?.location)
    return `${msg.reply_to_message.location.latitude},${msg.reply_to_message.location.longitude}`;

  const t = msg.text || msg.caption || '';
  const m = t.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);

  return m ? `${m[1]},${m[2]}` : '';
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
    let clean = p.split(/contoh\s*:/i)[0];
    return "MEDICAL CHECK UP PELANGGAN :" + clean;
  });
}

function get(label, txt) {
  const r = new RegExp(`${label}\\s*:\\s*([^\\n]*)`, 'i');
  const m = txt.match(r);
  return m ? safe(m[1]) : '';
}

function parseMCU(txt) {
  let cp = get('CP PELANGGAN', txt);

  if (/PENYEBAB|LANGKAH|ALAMAT|ODP|PETUGAS/i.test(cp)) cp = '';

  return {
    status: get('STATUS', txt),
    tiket: get('NO TIKET', txt),
    inet: get('INET/TLP', txt),
    cp: normalizeCP(cp),
    penyebab: get('PENYEBAB GANGGUAN', txt),
    perbaikan: get('LANGKAH PERBAIKAN'),
    alamat: get('ALAMAT LENGKAP', txt),
    odp: get('NAMA ODP', txt),
    petugas: get('PETUGAS', txt),
  };
}

// =======================
// 💾 GOOGLE
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
    now, data.status, data.tiket, data.inet,
    data.cp, data.penyebab, data.perbaikan,
    data.alamat, data.odp, data.petugas, loc
  ];

  if (idx !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${idx + 1}:K${idx + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });
    return 'update';
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] }
  });

  return 'insert';
}

// =======================
// 🚀 MAIN
// =======================
bot.on('message', async (msg) => {
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
      if (!data.inet) continue;

      const res = await saveData(data, lastLocation[chatId] || '');

      await bot.sendMessage(chatId,
        res === 'insert'
          ? '🆕 Data Baru sudah Dicatet ke Google Sheet ✅'
          : '🔄 Data berhasil di-update ke Google Sheet ✅'
      );
    }

  } catch (e) {
    console.log(e);
  }
});
