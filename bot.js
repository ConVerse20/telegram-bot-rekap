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

// ===== START =====
app.listen(PORT, async () => {
  await bot.deleteWebHook();
  await bot.setWebHook(`${URL}/webhook`);
  console.log('🚀 BOT READY');
});

// ===== WIB =====
const now = () => moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');

// ===== MEMORY SHARELOC =====
let lastTicketByUser = {};
let lastRowByTicket = {};

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

// ===== VALIDASI FILTER =====
function isValid(data, text) {
  if (!data.tiket) return false;

  // ❌ skip template kosong
  if (text.includes('contoh')) return false;

  // ❌ skip kalau semua kosong
  if (!data.inet && !data.cp && !data.penyebab) return false;

  return true;
}

// ===== SAVE =====
async function save(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];
  const index = rows.findIndex(r => r[2] === data.tiket);

  if (index !== -1) {
    return { type: 'update', row: index + 1 };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        now(),
        data.status,
        data.tiket,
        data.inet,
        data.cp,
        data.penyebab,
        data.perbaikan,
        data.alamat,
        data.odp,
        data.petugas,
        ''
      ]]
    }
  });

  return { type: 'insert', row: rows.length + 1 };
}

// ===== UPDATE SHARELOC =====
async function updateLocation(row, loc) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `DATA!K${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[loc]]
    }
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

  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][3] || '') === inet) {
      return rows[i];
    }
  }
  return null;
}

// ===== COMMAND CEK =====
bot.onText(/\/cek (.+)/, async (msg, match) => {
  if (msg.chat.type !== 'private') {
    return bot.sendMessage(msg.chat.id, '❌ Gunakan di japri bot');
  }

  const data = await cekData(match[1]);

  if (!data) return bot.sendMessage(msg.chat.id, '❌ Tidak ditemukan');

  const text = `
📡 DATA PELANGGAN

🌐 Internet : ${data[3]}
📞 CP       : ${data[4]}
📍 Alamat   : ${data[7]}
📌 Lokasi   : ${data[10] || '-'}
`;

  await bot.sendMessage(msg.chat.id, text);

  if (data[10]) {
    const [lat, lon] = data[10].split(',');
    await bot.sendLocation(msg.chat.id, lat, lon);
  }
});

// ===== HANDLE TEXT =====
bot.on('message', async (msg) => {
  try {

    // SHARELOC HANDLER
    if (msg.location) {
      const user = msg.from.id;
      const tiket = lastTicketByUser[user];

      if (!tiket) return;

      const row = lastRowByTicket[tiket];
      if (!row) return;

      const loc = `${msg.location.latitude},${msg.location.longitude}`;

      await updateLocation(row, loc);

      return bot.sendMessage(msg.chat.id, '📍 Sharelok tersimpan');
    }

    if (!msg.text) return;
    if (!msg.text.includes('NO TIKET')) return;

    const data = parse(msg.text);

    // FILTER DATA JELEK
    if (!isValid(data, msg.text)) return;

    const result = await save(data);

    // SIMPAN MEMORY
    lastTicketByUser[msg.from.id] = data.tiket;
    lastRowByTicket[data.tiket] = result.row;

    bot.sendMessage(msg.chat.id, '✅ Masuk sheet');

  } catch (e) {
    console.error(e);
    bot.sendMessage(msg.chat.id, '❌ Error');
  }
});
