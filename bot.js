const { google } = require('googleapis');
const moment = require('moment');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 8080;

const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

const lastLocation = {};

// ===== GOOGLE AUTH =====
const creds = JSON.parse(Buffer.from(process.env.GOOGLE_CREDS_BASE64, 'base64').toString());
creds.private_key = creds.private_key.replace(/\\n/g, '\n');

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  bot.processUpdate(req.body);
});

app.listen(PORT, async () => {
  console.log('🚀 BOT SIAP FULL FINAL');
  await bot.deleteWebHook();
  await bot.setWebHook(`${URL}/webhook`);
});

// =============================
// UTIL
// =============================
const delay = ms => new Promise(r => setTimeout(r, ms));

// =============================
// PARSE MCU
// =============================
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

// =============================
// SHARELOK FIX ALL CASE
// =============================
function extractLocation(msg) {
  if (msg.location)
    return `${msg.location.latitude},${msg.location.longitude}`;

  if (msg.venue?.location)
    return `${msg.venue.location.latitude},${msg.venue.location.longitude}`;

  const text = msg.text || msg.caption || '';

  let m = text.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) return `${m[1]},${m[2]}`;

  m = text.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return `${m[1]},${m[2]}`;

  const entities = msg.entities || msg.caption_entities || [];
  for (let e of entities) {
    if (e.type === 'url') {
      const url = text.substring(e.offset, e.offset + e.length);
      let mm = url.match(/(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (mm) return `${mm[1]},${mm[2]}`;
    }
  }

  return '';
}

// =============================
// SAVE / UPDATE
// =============================
async function saveOrUpdate(data, shareloc) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];

  let idx = rows.findIndex(r => r[3] === data.inet);

  let shareChanged = false;

  if (idx !== -1) {
    let row = rows[idx];

    // CP append
    if (data.cp) {
      let cpList = row[4] ? row[4].split(' / ') : [];
      if (!cpList.includes(data.cp)) cpList.push(data.cp);
      row[4] = cpList.join(' / ');
    }

    row[1] = data.status || row[1];
    row[2] = data.tiket || row[2];
    row[5] = data.penyebab || row[5];
    row[6] = data.perbaikan || row[6];
    row[7] = data.alamat || row[7];
    row[8] = data.odp || row[8];
    row[9] = data.petugas || row[9];

    if (shareloc && shareloc !== row[10]) {
      row[10] = shareloc;
      shareChanged = true;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${idx + 1}:K${idx + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });

    return { type: 'update', shareChanged };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss'),
        data.status,
        data.tiket,
        data.inet,
        data.cp,
        data.penyebab,
        data.perbaikan,
        data.alamat,
        data.odp,
        data.petugas,
        shareloc
      ]]
    }
  });

  return { type: 'insert', shareChanged: !!shareloc };
}

// =============================
// /CEK (GRUP + JAPRI FIX)
// =============================
bot.onText(/\/cek (.+)/, async (msg, match) => {
  try {
    const inet = match[1].trim();
    const chatId = msg.chat.id;

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DATA!A:K',
    });

    const rows = res.data.values || [];
    const row = rows.find(r => r[3] === inet);

    if (!row) {
      return bot.sendMessage(chatId, `❌ Data tidak ditemukan (${inet})`);
    }

    const txt =
`📡 INTERNET : ${row[3]}
📞 CP : ${row[4] || '-'}
📍 ALAMAT : ${row[7] || '-'}`;

    // grup
    if (msg.chat.type !== 'private') {
      try {
        await bot.sendMessage(msg.from.id, txt);
        if (row[10]) {
          const [lat, lng] = row[10].split(',');
          await bot.sendLocation(msg.from.id, +lat, +lng);
        }
        await bot.sendMessage(chatId, `📩 Cek dikirim ke japri`);
      } catch {
        await bot.sendMessage(chatId, txt);
      }
      return;
    }

    // japri
    await bot.sendMessage(chatId, txt);
    if (row[10]) {
      const [lat, lng] = row[10].split(',');
      await bot.sendLocation(chatId, +lat, +lng);
    }

  } catch (e) {
    console.log(e);
  }
});

// =============================
// HANDLE MESSAGE
// =============================
bot.on('message', async (msg) => {
  try {
    const text = msg.text || msg.caption || '';

    // ===== SHARELOK BUFFER =====
    const loc = extractLocation(msg);
    if (loc) {
      lastLocation[msg.chat.id] = loc;
      lastLocation[msg.from?.id] = loc;
      lastLocation[msg.chat.id + '_' + msg.from?.id] = loc;
      lastLocation['last'] = loc;
    }

    if (!/MEDICAL\s*CHECK/i.test(text)) return;

    await delay(1500);

    const blocks = extractMCU(text);

    const shareloc =
      lastLocation[msg.chat.id + '_' + msg.from?.id] ||
      lastLocation[msg.from?.id] ||
      lastLocation[msg.chat.id] ||
      lastLocation['last'] || '';

    for (let b of blocks) {
      const data = parseMCU(b);
      if (!data.inet) continue;

      const res = await saveOrUpdate(data, shareloc);

      const user = msg.from?.username
        ? '@' + msg.from.username
        : msg.from.first_name;

      let kosong = [];
      if (!data.odp) kosong.push('ODP');
      if (!data.petugas) kosong.push('PETUGAS');

      if (kosong.length) {
        await bot.sendMessage(msg.chat.id,
          `⚠️ ${user} data belum lengkap (${kosong.join(', ')})`);
      }

      // MCU notif
      if (res.type === 'insert') {
        await bot.sendMessage(msg.chat.id,
          `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
      } else {
        await bot.sendMessage(msg.chat.id,
          `🔄 Data berhasil di-update ke Google Sheet ✅`);
      }

      // SHARELOK notif
      if (res.shareChanged) {
        await bot.sendMessage(msg.chat.id,
          `📍 Sharelok berhasil di-update ke Google Sheet ✅`);
      }
    }

  } catch (err) {
    console.log('ERROR:', err);
  }
});
