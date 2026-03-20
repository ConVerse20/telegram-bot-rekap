// =======================
// 🚀 MCU BOT FINAL LEVEL 3 (SAFE UPGRADE)
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

// ===== GUARD =====
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
  let lastErr;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await delay(500);
    }
  }
  throw lastErr;
}

// =======================
// 🧠 UTIL
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

  sheetCache = res.data.values || [];
  lastFetch = Date.now();
  return sheetCache;
}

async function saveData(data, loc, chatId) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const rows = await getSheetRows(sheets);

  let idx = rows.findIndex(r => r[3] === data.inet);
  const now = moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');

  const row = [
    now, data.status, data.tiket, data.inet,
    data.cp, data.penyebab, data.perbaikan,
    data.alamat, data.odp, data.petugas, loc
  ];

  let shareChanged = false;
  let perubahan = [];

  if (idx !== -1) {
    let old = rows[idx];
    while (old.length < 11) old.push('');

    if (data.status && data.status !== old[1]) {
      perubahan.push(`STATUS: ${old[1]} → ${data.status}`);
      old[1] = data.status;
    }

    if (data.cp) old[4] = data.cp;
    if (data.penyebab && data.penyebab !== old[5]) {
      perubahan.push(`PENYEBAB diupdate`);
      old[5] = data.penyebab;
    }

    if (data.perbaikan) old[6] = data.perbaikan;
    if (data.alamat) old[7] = data.alamat;
    if (data.odp) old[8] = data.odp;
    if (data.petugas) old[9] = data.petugas;

    if (loc && loc !== old[10]) {
      old[10] = loc;
      shareChanged = true;
    }

    await retry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `DATA!A${idx + 1}:K${idx + 1}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [old] }
      })
    );

    if (perubahan.length) {
      await bot.sendMessage(chatId,
        `📝 Perubahan:\n- ${perubahan.join('\n- ')}`
      );
    }

    return { type: 'update', shareChanged };
  }

  await retry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'DATA!A:K',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    })
  );

  return { type: 'insert', shareChanged: !!loc };
}

// =======================
// 📊 REKAP HARIAN
// =======================
setInterval(async () => {
  try {
    const now = moment().utcOffset(7);
    if (now.format('HH:mm') !== '20:00') return;

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const rows = await getSheetRows(sheets);

    const today = now.format('YYYY-MM-DD');
    const hariIni = rows.filter(r => r[0]?.startsWith(today));

    const total = hariIni.length;
    const done = hariIni.filter(r => /close|selesai/i.test(r[1])).length;

    await bot.sendMessage(
      process.env.GROUP_ID,
      `📊 REKAP HARIAN\n\nTotal Tiket: ${total}\nSelesai: ${done}`
    );

  } catch (e) {
    console.log("Rekap error:", e.message);
  }
}, 60000);

// =======================
// 🔍 COMMAND /cek
// =======================
bot.onText(/\/cek (.+)/, async (msg, match) => {
  try {
    const chatId = msg.chat.id;
    const inet = match[1].trim();

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const rows = await getSheetRows(sheets);
    const row = rows.find(r => r[3] === inet);

    if (!row) return bot.sendMessage(chatId, `❌ Tidak ditemukan`);

    await bot.sendMessage(chatId,
`📡 DATA
INET: ${row[3]}
STATUS: ${row[1]}
CP: ${row[4]}
ODP: ${row[8]}
📍: ${row[10]}`);
  } catch (e) {
    console.log(e);
  }
});

// =======================
// 🚀 MAIN
// =======================
bot.on('message', handleMsg);
bot.on('edited_message', handleMsg);

async function handleMsg(msg) {
  try {
    if (processing.has(msg.message_id)) return;
    processing.add(msg.message_id);
    setTimeout(() => processing.delete(msg.message_id), 5000);

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

      const shareloc = lastLocation[chatId] || '';

      const fields = {
        inet: data.inet,
        cp: data.cp,
        alamat: data.alamat
      };

      const kosong = Object.keys(fields).filter(k => !fields[k]);

      if (kosong.length) {
        const now = Date.now();
        if (!lastWarn[chatId] || now - lastWarn[chatId] > 10000) {
          lastWarn[chatId] = now;

          await bot.sendMessage(
            chatId,
            `⚠️ Data belum lengkap (${kosong.join(', ')})`
          );
        }
      }

      const res = await saveData(data, shareloc, chatId);

      await bot.sendMessage(chatId,
        res.type === 'insert'
          ? `🆕 Data masuk`
          : `🔄 Data update`
      );

      if (res.shareChanged) {
        await bot.sendMessage(chatId,
          `📍 sharelok update`
        );
      }
    }

  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

// =======================
process.on('unhandledRejection', err => console.error(err));
process.on('uncaughtException', err => console.error(err));

console.log('🚀 BOT LEVEL 3 SIAP');
