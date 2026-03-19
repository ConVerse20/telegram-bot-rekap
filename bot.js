const { google } = require('googleapis');
const moment = require('moment');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 8080;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

// ===== BUFFER SHARELOK =====
const lastLocation = {};

// ===== GOOGLE AUTH =====
const creds = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDS_BASE64, 'base64').toString()
);
creds.private_key = creds.private_key.replace(/\\n/g, '\n');

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ===== WEBHOOK =====
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  bot.processUpdate(req.body);
});

// ===== START =====
app.listen(PORT, async () => {
  console.log('🚀 BOT SIAP FULL');
  await bot.deleteWebHook();
  await bot.setWebHook(`${URL}/webhook`);
});

// ==============================
// 🧰 UTIL
// ==============================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==============================
// 🔥 PARSER MCU
// ==============================
function extractMCU(text) {
  const parts = text.split(/MEDICAL\s*CHECK\s*UP\s*PELANGGAN\s*:/i);
  parts.shift();
  return parts.map(p => "MEDICAL CHECK UP PELANGGAN :" + p);
}

function getField(block, label) {
  const regex = new RegExp(`${label}\\s*:\\s*([^\\n]*)`, 'i');
  const match = block.match(regex);
  if (!match) return '';

  let val = match[1].replace(/:/g, '').trim();
  if (!val || val === '-') return '';

  return val;
}

function parseMCU(block) {
  let cp = getField(block, 'CP PELANGGAN');

  cp = cp.replace(/\s+/g, '');
  if (cp && cp.startsWith('+')) cp = `'${cp}`;

  return {
    status: getField(block, 'STATUS'),
    tiket: getField(block, 'NO TIKET'),
    inet: getField(block, 'INET/TLP'),
    cp,
    penyebab: getField(block, 'PENYEBAB GANGGUAN'),
    perbaikan: getField(block, 'LANGKAH PERBAIKAN'),
    alamat: getField(block, 'ALAMAT LENGKAP'),
    odp: getField(block, 'NAMA ODP'),
    petugas: getField(block, 'PETUGAS'),
  };
}

// ==============================
// 📍 SHARELOK SUPER FIX (ALL CASE)
// ==============================
function extractLocation(msg) {
  // 1. normal
  if (msg.location) {
    return `${msg.location.latitude},${msg.location.longitude}`;
  }

  // 2. venue
  if (msg.venue && msg.venue.location) {
    return `${msg.venue.location.latitude},${msg.venue.location.longitude}`;
  }

  const text = msg.text || msg.caption || '';

  // 3. koordinat langsung
  let match = text.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (match) return `${match[1]},${match[2]}`;

  // 4. maps url
  match = text.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (match) return `${match[1]},${match[2]}`;

  match = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (match) return `${match[1]},${match[2]}`;

  // 5. entities (forward map 🔥)
  const entities = msg.entities || msg.caption_entities || [];

  for (let ent of entities) {
    if (ent.type === 'url') {
      const url = text.substring(ent.offset, ent.offset + ent.length);

      let m = url.match(/(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (m) return `${m[1]},${m[2]}`;

      m = url.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (m) return `${m[1]},${m[2]}`;
    }
  }

  return '';
}

// ==============================
// 💾 SAVE / UPDATE (BY INET)
// ==============================
async function saveOrUpdate(data, shareloc) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];

  let rowIndex = rows.findIndex(r =>
    r[3] && data.inet && r[3].trim() === data.inet.trim()
  );

  if (rowIndex !== -1) {
    let row = rows[rowIndex];

    // CP append
    if (data.cp) {
      let existing = row[4] ? row[4].split(' / ') : [];
      if (!existing.includes(data.cp)) existing.push(data.cp);
      row[4] = existing.join(' / ');
    }

    row[1] = data.status || row[1];
    row[2] = data.tiket || row[2];
    row[5] = data.penyebab || row[5];
    row[6] = data.perbaikan || row[6];
    row[7] = data.alamat || row[7];
    row[8] = data.odp || row[8];
    row[9] = data.petugas || row[9];

    if (shareloc) row[10] = shareloc;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${rowIndex + 1}:K${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });

    return 'update';
  }

  const values = [[
    moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss'),
    data.status || '',
    data.tiket || '',
    data.inet || '',
    data.cp || '',
    data.penyebab || '',
    data.perbaikan || '',
    data.alamat || '',
    data.odp || '',
    data.petugas || '',
    shareloc || ''
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values }
  });

  return 'insert';
}

// ==============================
// 🔍 /cek
// ==============================
bot.onText(/\/cek (.+)/, async (msg, match) => {
  if (msg.chat.type !== 'private') return;

  const inet = match[1];

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];
  const row = rows.find(r => r[3] === inet);

  if (!row) return bot.sendMessage(msg.chat.id, '❌ Data tidak ditemukan');

  await bot.sendMessage(msg.chat.id,
`📡 INTERNET : ${row[3]}
📞 CP : ${row[4] || '-'}
📍 ALAMAT : ${row[7]}`);

  if (row[10]) {
    const [lat, lng] = row[10].split(',');
    await bot.sendLocation(msg.chat.id, parseFloat(lat), parseFloat(lng));
  }
});

// ==============================
// 🤖 HANDLE MESSAGE
// ==============================
bot.on('message', async (msg) => {
  try {
    const text = msg.text || msg.caption || '';

    const loc = extractLocation(msg);
    if (loc) {
      lastLocation[msg.from.id] = loc;
      lastLocation[msg.chat.id] = loc;
    }

    if (!/MEDICAL\s*CHECK\s*UP/i.test(text)) return;

    await delay(1500); // 🔥 anti miss sharelok

    const blocks = extractMCU(text);

    const shareloc =
      lastLocation[msg.from.id] ||
      lastLocation[msg.chat.id] ||
      '';

    for (let block of blocks) {
      const data = parseMCU(block);

      if (!data.inet) continue;

      const result = await saveOrUpdate(data, shareloc);

      const username = msg.from?.username
        ? '@' + msg.from.username
        : msg.from.first_name;

      let kosong = [];
      if (!data.odp) kosong.push('ODP');
      if (!data.petugas) kosong.push('PETUGAS');

      if (kosong.length > 0) {
        await bot.sendMessage(msg.chat.id,
          `⚠️ ${username} data belum lengkap (${kosong.join(', ')})`);
      }

      if (result === 'insert') {
        await bot.sendMessage(msg.chat.id,
          `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
      }

      if (result === 'update') {
        await bot.sendMessage(msg.chat.id,
          `🔄 Data berhasil di-update ke Google Sheet ✅`);
      }
    }

  } catch (err) {
    console.error('❌ ERROR:', err);
  }
});
