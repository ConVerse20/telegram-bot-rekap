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
// 📍 SHARELOK FIX
// ==============================
function extractLocation(msg) {
  if (msg.location) return `${msg.location.latitude},${msg.location.longitude}`;

  if (msg.venue && msg.venue.location)
    return `${msg.venue.location.latitude},${msg.venue.location.longitude}`;

  const text = msg.text || msg.caption || '';

  let match = text.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (match) return `${match[1]},${match[2]}`;

  match = text.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (match) return `${match[1]},${match[2]}`;

  match = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (match) return `${match[1]},${match[2]}`;

  const entities = msg.entities || msg.caption_entities || [];
  for (let ent of entities) {
    if (ent.type === 'url') {
      const url = text.substring(ent.offset, ent.offset + ent.length);
      let m = url.match(/(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (m) return `${m[1]},${m[2]}`;
    }
  }

  return '';
}

// ==============================
// 💾 SAVE / UPDATE (RETURN DETAIL)
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

  let sharelokChanged = false;

  if (rowIndex !== -1) {
    let row = rows[rowIndex];

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

    if (shareloc && shareloc !== row[10]) {
      row[10] = shareloc;
      sharelokChanged = true;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${rowIndex + 1}:K${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] }
    });

    return { type: 'update', sharelokChanged };
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

  return { type: 'insert', sharelokChanged: !!shareloc };
}

// ==============================
// 🤖 HANDLE MESSAGE
// ==============================
bot.on('message', async (msg) => {
  try {
    const text = msg.text || msg.caption || '';

    // ===== SIMPAN SHARELOK =====
    const loc = extractLocation(msg);
    if (loc) {
      lastLocation[msg.chat.id] = loc;
      if (msg.from?.id) {
        lastLocation[msg.from.id] = loc;
        lastLocation[msg.chat.id + '_' + msg.from.id] = loc;
      }
      lastLocation['last'] = loc;
    }

    if (!/MEDICAL\s*CHECK\s*UP/i.test(text)) return;

    await delay(1500);

    const blocks = extractMCU(text);

    const shareloc =
      lastLocation[msg.chat.id + '_' + msg.from?.id] ||
      lastLocation[msg.from?.id] ||
      lastLocation[msg.chat.id] ||
      lastLocation['last'] ||
      '';

    for (let block of blocks) {
      const data = parseMCU(block);
      if (!data.inet) continue;

      const result = await saveOrUpdate(data, shareloc);

      // ===== NOTIF MCU =====
      if (result.type === 'insert') {
        await bot.sendMessage(msg.chat.id,
          `🆕 Data Baru sudah Dicatet ke Google Sheet ✅`);
      }

      if (result.type === 'update') {
        await bot.sendMessage(msg.chat.id,
          `🔄 Data berhasil di-update ke Google Sheet ✅`);
      }

      // ===== NOTIF SHARELOK =====
      if (result.sharelokChanged) {
        if (result.type === 'insert') {
          await bot.sendMessage(msg.chat.id,
            `📍 Sharelok Baru sudah Dicatet ke Google Sheet ✅`);
        } else {
          await bot.sendMessage(msg.chat.id,
            `📍 Sharelok berhasil di-update ke Google Sheet ✅`);
        }
      }
    }

  } catch (err) {
    console.error(err);
  }
});
