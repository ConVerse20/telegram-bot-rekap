const { google } = require('googleapis');
const moment = require('moment-timezone');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cron = require('node-cron');

// ===== CONFIG =====
const TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SPREADSHEET_ID;
const PORT = process.env.PORT || 8080;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';
const GROUP_ID = process.env.GROUP_ID;

if (!TOKEN) throw new Error('BOT_TOKEN kosong');
if (!SHEET_ID) throw new Error('SPREADSHEET_ID kosong');
if (!process.env.GOOGLE_CREDS_BASE64) throw new Error('GOOGLE_CREDS_BASE64 kosong');

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

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
  console.log('🚀 BOT SIAP FULL');
});

// ===== PARSER =====
function parseLaporan(text = '') {
  const result = {
    status: '',
    tiket: '',
    inet: '',
    cp: '',
    penyebab: '',
    perbaikan: '',
    alamat: '',
    odp: '',
    petugas: ''
  };

  text.split('\n').forEach(line => {
    let clean = line.trim();
    if (clean.startsWith('-')) clean = clean.slice(1).trim();

    const parts = clean.split(':');
    if (parts.length < 2) return;

    const key = parts[0].toUpperCase();
    let value = parts.slice(1).join(':').trim();

    if (!value || value === '-' || value === ':') value = '';

    if (key.includes('STATUS')) result.status = value.toUpperCase();
    else if (key.includes('NO TIKET')) result.tiket = value;
    else if (key.includes('INET')) result.inet = value;
    else if (key.includes('CP')) {
      if (value.startsWith('+')) value = `'${value}`;
      result.cp = value;
    }
    else if (key.includes('PENYEBAB')) result.penyebab = value;
    else if (key.includes('LANGKAH')) result.perbaikan = value;
    else if (key.includes('ALAMAT')) result.alamat = value;
    else if (key.includes('ODP')) result.odp = value;
    else if (key.includes('PETUGAS')) result.petugas = value;
  });

  return result;
}

// ===== VALIDASI =====
function validateData(data) {
  const kosong = [];
  if (!data.odp) kosong.push('NAMA ODP');
  if (!data.petugas) kosong.push('PETUGAS');
  return kosong;
}

function getUsername(msg) {
  return msg.from.username
    ? '@' + msg.from.username
    : msg.from.first_name;
}

// ===== MERGE CP =====
function mergeCP(oldCP = '', newCP = '') {
  if (!newCP) return oldCP;

  const list = oldCP
    ? oldCP.split('/').map(x => x.trim()).filter(Boolean)
    : [];

  if (list.includes(newCP)) return oldCP;

  list.push(newCP);
  return list.join(' / ');
}

// ===== SAVE =====
async function saveToSheet(data, location = '') {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(r => r[2] === data.tiket);

  const waktu = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

  if (rowIndex !== -1) {
    const oldCP = rows[rowIndex][4] || '';
    const finalCP = mergeCP(oldCP, data.cp);

    const newRow = [[
      waktu,
      data.status,
      data.tiket,
      data.inet,
      finalCP,
      data.penyebab,
      data.perbaikan,
      data.alamat,
      data.odp,
      data.petugas,
      location || rows[rowIndex][10] || ''
    ]];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `DATA!A${rowIndex + 1}:K${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: newRow }
    });

    return 'update';
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:K',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[
        waktu,
        data.status,
        data.tiket,
        data.inet,
        data.cp,
        data.penyebab,
        data.perbaikan,
        data.alamat,
        data.odp,
        data.petugas,
        location
      ]]
    }
  });

  return 'insert';
}

// ===== HANDLE TEXT =====
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;
    if (!msg.text.toUpperCase().includes('NO TIKET')) return;

    const data = parseLaporan(msg.text);
    const missing = validateData(data);
    const username = getUsername(msg);

    if (missing.length > 0) {
      bot.sendMessage(msg.chat.id,
`⚠️ DATA BELUM LENGKAP

- ${missing.join('\n- ')}

Harap dilengkapi ${username}`);
    }

    const result = await saveToSheet(data);

    bot.sendMessage(msg.chat.id,
      result === 'update'
        ? '🔄 Data berhasil di-update'
        : '🆕 Data baru masuk'
    );

  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, '❌ Error');
  }
});

// ===== REKAP =====
async function kirimRekapHarian() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'DATA!A:J',
  });

  const rows = res.data.values || [];
  const today = moment().tz('Asia/Jakarta').format('YYYY-MM-DD');

  let total = 0, close = 0, open = 0;

  rows.forEach((r, i) => {
    if (i === 0) return;
    if (!r[0]?.includes(today)) return;

    total++;
    if ((r[1] || '').toUpperCase().includes('CLOSE')) close++;
    else open++;
  });

  if (GROUP_ID) {
    bot.sendMessage(GROUP_ID,
`📊 REKAP HARI INI
Tanggal: ${today}

Total: ${total}
Close: ${close}
Open: ${open}`);
  }
}

// ===== CRON =====
cron.schedule('0 17 * * *', kirimRekapHarian);
