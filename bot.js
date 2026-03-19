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

// ===== SHARELOK BUFFER =====
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
  try {
    bot.processUpdate(req.body);
  } catch (e) {
    console.error(e);
  }
});

// ===== START =====
app.listen(PORT, async () => {
  console.log('🚀 BOT SIAP FULL');
  await bot.deleteWebHook();
  await bot.setWebHook(`${URL}/webhook`);
});

// ==============================
// 🔥 PARSER MCU (STABIL)
// ==============================
function extractMCU(text) {
  const parts = text.split(/MEDICAL\s*CHECK\s*UP\s*PELANGGAN\s*:/i);
  parts.shift();
  return parts.map(p => "MEDICAL CHECK UP PELANGGAN :" + p);
}

// 🔥 FIX FIELD BIAR RAPI
function getField(block, label) {
  const regex = new RegExp(`${label}\\s*:\\s*([^\\n]*)`, 'i');
  const match = block.match(regex);

  if (!match) return '';

  let val = match[1]
    .replace(label, '')
    .replace(/:/g, '')
    .trim();

  if (!val || val === '-') return '';

  return val;
}

function parseMCU(block) {
  let cp = getField(block, 'CP PELANGGAN');

  if (cp && cp.startsWith('+')) {
    cp = `'${cp}`;
  }

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
// 💾 SAVE / UPDATE
// ==============================
async function saveOrUpdate(data, shareloc) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];
  let rowIndex = rows.findIndex(r => r[2] === data.tiket);

  // ===== UPDATE =====
  if (rowIndex !== -1) {
    let row = rows[rowIndex];

    if (data.cp && !row[4]?.includes(data.cp)) {
      row[4] = row[4] ? row[4] + ' / ' + data.cp : data.cp;
    }

    row[1] = data.status || row[1];
    row[5] = data.penyebab || row[5];
    row[6] = data.perbaikan || row[6];
    row[7] = data.alamat || row[7];
    row[8] = data.odp || row[8];
    row[9] = data.petugas || row[9];
    row[10] = shareloc || row[10];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${rowIndex + 1}:K${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });

    return 'update';
  }

  // ===== INSERT =====
  const values = [[
    moment().format('YYYY-MM-DD HH:mm:ss'),
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

  bot.sendMessage(msg.chat.id,
`📡 INTERNET : ${row[3]}
📞 CP : ${row[4] || '-'}
📍 ALAMAT : ${row[7]}`);

  if (row[10]) {
    const [lat, lng] = row[10].split(',');
    bot.sendLocation(msg.chat.id, parseFloat(lat), parseFloat(lng));
  }
});

// ==============================
// 🤖 HANDLE MESSAGE
// ==============================
bot.on('message', async (msg) => {
  try {
    let text = msg.text || msg.caption || '';

    // 🔥 SIMPAN SHARELOK
    if (msg.location) {
      lastLocation[msg.from.id] =
        `${msg.location.latitude},${msg.location.longitude}`;
    }

    if (!/MEDICAL\s*CHECK\s*UP/i.test(text)) return;

    const blocks = extractMCU(text);
    const shareloc = lastLocation[msg.from.id] || '';

    for (let block of blocks) {
      const data = parseMCU(block);

      if (!data.tiket && !data.inet && !data.alamat) continue;

      const result = await saveOrUpdate(data, shareloc);

      const username = msg.from?.username
        ? '@' + msg.from.username
        : msg.from.first_name;

      let kosong = [];
      if (!data.odp) kosong.push('ODP');
      if (!data.petugas) kosong.push('PETUGAS');

      if (kosong.length > 0) {
        bot.sendMessage(msg.chat.id,
          `⚠️ ${username} data belum lengkap (${kosong.join(', ')})`);
      }

      if (result === 'insert') {
        bot.sendMessage(msg.chat.id,
          `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
      }

      if (result === 'update') {
        bot.sendMessage(msg.chat.id,
          `🔄 Data berhasil di-update ke Google Sheet ✅`);
      }
    }

  } catch (err) {
    console.error('❌ ERROR:', err);
  }
});
