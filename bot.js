// =======================
// 🚀 MCU BOT FINAL (ANTI RESPON KOSONG TOTAL FIX)
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
  v = v.replace(/[:\s]/g, '');
  return v;
}

// =======================
// 🧠 PARSER
// =======================
function splitMCU(text) {
  const parts = text.split(/MEDICAL\s*CHECK\s*UP\s*PELANGGAN\s*:/i);
  parts.shift();

  return parts.map(p => {
    return "MEDICAL CHECK UP PELANGGAN :" + p;
  });
}

function get(label, txt) {
  const r = new RegExp(`${label}\\s*:\\s*([^\\n]*)`, 'i');
  const m = txt.match(r);
  return m ? m[1] : '';
}

// =======================
// 🔥 HARD FILTER (INTI FIX)
// =======================
function isAllEmptyBlock(txt) {
  const fields = [
    'STATUS',
    'NO TIKET',
    'INET/TLP',
    'CP PELANGGAN',
    'PENYEBAB GANGGUAN',
    'LANGKAH PERBAIKAN',
    'ALAMAT LENGKAP',
    'NAMA ODP',
    'PETUGAS'
  ];

  return fields.every(f => {
    const val = get(f, txt);
    return clean(val) === '';
  });
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

async function saveData(data) {
  if (!data.inet) return;

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

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
    data.petugas
  ];

  await retry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'DATA!A:J',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    })
  );

  return { type: 'insert' };
}

// =======================
// 🚀 MAIN
// =======================
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';

    if (!/MEDICAL/i.test(text)) return;

    const blocks = splitMCU(text);

    for (let b of blocks) {

      // 🔥 FIX UTAMA
      if (isAllEmptyBlock(b)) {
        continue; // DIAM TOTAL
      }

      const data = {
        status: get('STATUS', b),
        tiket: get('NO TIKET', b),
        inet: get('INET/TLP', b),
        cp: get('CP PELANGGAN', b),
        penyebab: get('PENYEBAB GANGGUAN', b),
        perbaikan: get('LANGKAH PERBAIKAN', b),
        alamat: get('ALAMAT LENGKAP', b),
        odp: get('NAMA ODP', b),
        petugas: get('PETUGAS', b),
      };

      if (!data.inet) continue;

      await saveData(data);

      await bot.sendMessage(chatId,
        `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
    }

  } catch (err) {
    console.error(err);
  }
});

console.log('🚀 BOT FIX FINAL 100%');
