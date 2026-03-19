// =======================
// 🚀 MCU BOT FINAL ALL-IN-ONE (WEBHOOK SAFE - RAILWAY)
// =======================

const { google } = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const express = require('express');

// ===== ENV =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 3000;

// 🔥 PAKAI ENV YANG SUDAH ADA (JANGAN TAMBAH BARU)
const BASE_URL = process.env.BASE_URL || process.env.RAILWAY_STATIC_URL;

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

// ===== WEBHOOK (JANGAN DIUBAH LAGI) =====
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  try {
    if (!BASE_URL) {
      console.log('❌ BASE_URL / RAILWAY_STATIC_URL tidak ada');
      return;
    }

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
const safe = v => (v ? v.toString().trim() : '');

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
// 📍 SHARELOK (GRUP + FORWARD + REPLY)
// =======================
function getLocation(msg) {
  if (msg.location) {
    return `${msg.location.latitude},${msg.location.longitude}`;
  }

  if (msg.reply_to_message?.location) {
    return `${msg.reply_to_message.location.latitude},${msg.reply_to_message.location.longitude}`;
  }

  const text = msg.text || msg.caption || '';

  let m = text.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) return `${m[1]},${m[2]}`;

  m = text.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return `${m[1]},${m[2]}`;

  return '';
}

// =======================
// 📦 BUFFER (ANTI MISS FORWARD)
// =======================
const bufferMsg = {};
const lastLocation = {};

function addBuffer(chatId, msg) {
  if (!bufferMsg[chatId]) bufferMsg[chatId] = [];
  bufferMsg[chatId].push(msg);
}

// =======================
// 🧠 PARSER MCU (PANJANG / PENDEK / MULTI)
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

  // anti kebawa field lain
  if (/PENYEBAB|LANGKAH|ALAMAT|ODP|PETUGAS/i.test(cp)) cp = '';

  return {
    status: get('STATUS', txt),
    tiket: get('NO TIKET', txt),
    inet: get('INET/TLP', txt),
    cp: normalizeCP(cp),
    penyebab: get('PENYEBAB GANGGUAN', txt),
    perbaikan: get('LANGKAH PERBAIKAN', txt),
    alamat: get('ALAMAT LENGKAP', txt),
    odp: get('NAMA ODP', txt),
    petugas: get('PETUGAS', txt),
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
    safe(data.status),
    safe(data.tiket),
    safe(data.inet),
    safe(data.cp),
    safe(data.penyebab),
    safe(data.perbaikan),
    safe(data.alamat),
    safe(data.odp),
    safe(data.petugas),
    safe(loc),
  ];

  let shareChanged = false;

  if (idx !== -1) {
    let old = rows[idx];
    while (old.length < 11) old.push('');

    // CP nambah (tidak overwrite)
    if (data.cp) {
      let list = old[4] ? old[4].split(' / ') : [];
      if (!list.includes(data.cp)) list.push(data.cp);
      old[4] = list.join(' / ');
    }

    old[1] = data.status || old[1];
    old[2] = data.tiket || old[2];
    old[5] = data.penyebab || old[5];
    old[6] = data.perbaikan || old[6];
    old[7] = data.alamat || old[7];
    old[8] = data.odp || old[8];
    old[9] = data.petugas || old[9];

    if (loc && loc !== old[10]) {
      old[10] = loc;
      shareChanged = true;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${idx + 1}:K${idx + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [old] }
    });

    return { type: 'update', shareChanged };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] }
  });

  return { type: 'insert', shareChanged: !!loc };
}

// =======================
// 🔎 /CEK (GRUP & JAPRI)
// =======================
bot.onText(/\/cek (.+)/, async (msg, match) => {
  try {
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
      return bot.sendMessage(msg.chat.id, '❌ Data tidak ditemukan');
    }

    const text = `
📡 INTERNET : ${row[3]}
📞 CP : ${row[4] || '-'}
📍 ALAMAT : ${row[7] || '-'}
🌐 ODP : ${row[8] || '-'}
`;

    await bot.sendMessage(msg.chat.id, text);

    if (row[10]) {
      const [lat, lon] = row[10].split(',');
      await bot.sendLocation(msg.chat.id, +lat, +lon);
    }

  } catch (e) {
    console.log(e);
  }
});

// =======================
// 🚀 MAIN ENGINE
// =======================
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';

    // ambil sharelok
    const loc = getLocation(msg);
    if (loc) lastLocation[chatId] = loc;

    // buffer anti miss
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

      // ===== REMINDER MULTI FIELD =====
      const fields = {
        CP: data.cp,
        ODP: data.odp,
        PETUGAS: data.petugas
      };

      const kosong = Object.keys(fields).filter(k => !fields[k]);
      const semuaKosong = Object.values(fields).every(v => !v);

      if (kosong.length && !semuaKosong) {
        const user = msg.from.username
          ? '@' + msg.from.username
          : msg.from.first_name;

        await bot.sendMessage(
          chatId,
          `⚠️ ${user} data belum lengkap (${kosong.join(', ')})`
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
});

console.log('🚀 BOT FINAL ALL-IN-ONE WEBHOOK STABIL SIAP');
