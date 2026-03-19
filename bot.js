const { google } = require('googleapis');
const moment = require('moment');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 8080;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';

const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

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

app.listen(PORT, async () => {
  await bot.deleteWebHook();
  await bot.setWebHook(`${URL}/webhook`);
  console.log('🚀 BOT READY');
});

// ===== TIME WIB =====
const now = () => moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');

// ===== MEMORY =====
let lastTicketByUser = {};
let lastRowByTicket = {};
let bufferText = {};

// ===== AMBIL MCU (ANTI CHAT PANJANG) =====
function extractMCU(text) {
  text = text.replace(/\r/g, '');
  const regex = /MEDICAL CHECK UP PELANGGAN\s*:[\s\S]*?(?=\n\n|$)/gi;
  return text.match(regex) || [];
}

// ===== PARSER =====
function parse(text) {
  const get = (key) => {
    const r = new RegExp(`${key}\\s*:\\s*(.*)`, 'i');
    const m = text.match(r);
    if (!m) return '';

    let v = m[1].trim();
    if (!v || v === ':' || v === '-') return '';

    return v;
  };

  let cp = get('CP PELANGGAN');
  if (cp.startsWith('+')) cp = `'${cp}`;

  return {
    status: get('STATUS'),
    tiket: get('NO TIKET'),
    inet: get('INET/TLP'),
    cp,
    penyebab: get('PENYEBAB GANGGUAN'),
    perbaikan: get('LANGKAH PERBAIKAN'),
    alamat: get('ALAMAT LENGKAP'),
    odp: get('NAMA ODP'),
    petugas: get('PETUGAS'),
  };
}

// ===== VALIDASI =====
function isValid(data) {
  return (
    data.inet ||
    data.cp ||
    data.penyebab ||
    data.perbaikan ||
    data.alamat ||
    data.odp ||
    data.petugas
  );
}

// ===== SAVE / UPDATE =====
async function save(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];
  const index = rows.findIndex(r => r[2] === data.tiket);

  const values = [[
    now(),
    data.status || '',
    data.tiket || '',
    data.inet || '',
    data.cp || '',
    data.penyebab || '',
    data.perbaikan || '',
    data.alamat || '',
    data.odp || '',
    data.petugas || '',
    ''
  ]];

  if (index !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${index + 1}:K${index + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });

    return { type: 'update', row: index + 1 };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: { values }
  });

  return { type: 'insert', row: rows.length + 1 };
}

// ===== SHARELOC =====
async function updateLocation(row, loc) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `DATA!K${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[loc]] }
  });
}

// ===== CEK DATA =====
async function cekData(inet) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];
  const row = rows.find(r => r[3] == inet);

  if (!row) return null;

  return {
    inet: row[3],
    cp: row[4],
    alamat: row[7],
    shareloc: row[10],
  };
}

// ===== COMMAND /CEK =====
bot.onText(/\/cek (.+)/, async (msg, match) => {
  if (msg.chat.type !== 'private') {
    return bot.sendMessage(msg.chat.id, '❌ Gunakan di japri bot');
  }

  const data = await cekData(match[1]);

  if (!data) {
    return bot.sendMessage(msg.chat.id, '❌ Data tidak ditemukan');
  }

  await bot.sendMessage(msg.chat.id, `
🔎 HASIL CEK DATA

🌐 Internet : ${data.inet || '-'}
📞 CP       : ${data.cp || '-'}
🏠 Alamat   : ${data.alamat || '-'}
📍 Lokasi   : ${data.shareloc || '-'}
`);

  if (data.shareloc?.includes(',')) {
    const [lat, lon] = data.shareloc.split(',');
    bot.sendLocation(msg.chat.id, lat, lon);
  }
});

// ===== HANDLE MESSAGE =====
bot.on('message', async (msg) => {
  try {
    const userId = msg.from.id;

    // ===== SHARELOC =====
    if (msg.location) {
      const tiket = lastTicketByUser[userId];
      const row = lastRowByTicket[tiket];
      if (!row) return;

      const loc = `${msg.location.latitude},${msg.location.longitude}`;
      await updateLocation(row, loc);

      return bot.sendMessage(msg.chat.id, '📍 Sharelok tersimpan');
    }

    if (!msg.text) return;

    // biar /cek gak ketabrak
    if (msg.text.startsWith('/cek')) return;

    // buffer (forward banyak chat)
    bufferText[userId] = (bufferText[userId] || '') + '\n' + msg.text;

    setTimeout(async () => {
      const text = bufferText[userId];
      delete bufferText[userId];

      if (!text.toUpperCase().includes('NO TIKET')) return;

      const blocks = extractMCU(text);

      for (const block of blocks) {
        const data = parse(block);

        if (!data.tiket) continue;
        if (!isValid(data)) continue;

        const result = await save(data);

        lastTicketByUser[userId] = data.tiket;
        lastRowByTicket[data.tiket] = result.row;

        // ===== REMINDER =====
        let warning = [];
        if (!data.odp) warning.push('NAMA ODP');
        if (!data.petugas) warning.push('PETUGAS');

        if (warning.length) {
          const user = msg.from.username ? `@${msg.from.username}` : 'teknisi';
          bot.sendMessage(msg.chat.id,
            `⚠️ ${user} mohon lengkapi: ${warning.join(', ')}`
          );
        }

        await bot.sendMessage(msg.chat.id,
          result.type === 'update'
            ? `🔄 Data ${data.tiket} berhasil di-update ke Google Sheet ✅`
            : `🆕 Data ${data.tiket} sudah Dicatet ke Google Sheet ✅`
        );
      }

    }, 1500);

  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, '❌ Error');
  }
});
