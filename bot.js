const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');

const TOKEN = '8682184665:AAGFO7Wztis-ETyXB0kr8sDf0_f-A8eBAH4';
const ADMIN_GROUP = -167474430;
const ALLOWED_USERS = [246759640,406752113,292115739,122882547,639241715,166577082,120002308,155299727,336877952,6862722575,601292992,114625129,129727898,785391351,123059157];

const TelegramBot = require('node-telegram-bot-api')
const express = require('express')

const TOKEN = process.env.TOKEN || '8682184665:AAGFO7Wztis-ETyXB0kr8sDf0_f-A8eBAH4'
const URL = process.env.RAILWAY_STATIC_URL || 'https://harmonious-endurance-production-460f.up.railway.app'

const bot = new TelegramBot(TOKEN)
const app = express()

app.use(express.json())

// webhook endpoint
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body)
  res.sendStatus(200)
})

// test respon
bot.on('message', (msg) => {
  bot.sendMessage(msg.chat.id, '🔥 BOT WEBHOOK AKTIF')
})

const PORT = process.env.PORT || 3000

app.listen(PORT, async () => {
  console.log('🚀 Server jalan')

  await bot.setWebHook(`${URL}/bot${TOKEN}`)
  console.log('✅ Webhook aktif')
})

// ===== GOOGLE =====
const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SHEET_ID = '1sfRc6ku00NZArsoK-LcBkzK25O0-cj4WZHgIBGiliDo';

// ===== PARSER =====
function parseLaporan(text) {
  const get = (label) => {
    const regex = new RegExp(`${label}\\s*:\\s*(.*)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  };

  return {
    status: get('STATUS'),
    tiket: get('NO TIKET'),
    inet: get('INET/TLP'),
    cp: get('CP PELANGGAN'),
    penyebab: get('PENYEBAB GANGGUAN'),
    perbaikan: get('LANGKAH PERBAIKAN'),
    alamat: get('ALAMAT LENGKAP'),
    odp: get('NAMA ODP'),
    petugas: get('PETUGAS'),
  };
}

// ===== SAVE SHEET =====
async function saveToSheet(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:J',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        moment().format('YYYY-MM-DD HH:mm:ss'),
        data.status,
        data.tiket,
        data.inet,
        data.cp,
        data.penyebab,
        data.perbaikan,
        data.alamat,
        data.odp,
        data.petugas
      ]]
    }
  });
}

// ===== HANDLE TEXT =====
bot.on('message', async (msg) => {
  if (!msg.text) return;
  if (!ALLOWED_USERS.includes(msg.from.id)) return;

  const data = parseLaporan(msg.text);

  if (!data.tiket) {
    return bot.sendMessage(msg.chat.id, '❌ Format salah');
  }

  await saveToSheet(data);

  bot.sendMessage(msg.chat.id, '✅ Tersimpan');

  bot.sendMessage(ADMIN_GROUP, `
📊 LAPORAN MASUK

TIKET: ${data.tiket}
STATUS: ${data.status}
ODP: ${data.odp}
PETUGAS: ${data.petugas}
`);
});

// ===== HANDLE FOTO =====
bot.on('photo', async (msg) => {
  if (!ALLOWED_USERS.includes(msg.from.id)) return;

  const caption = msg.caption || '';
  const data = parseLaporan(caption);

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const file = await bot.getFile(fileId);

  const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
  const fileName = `foto/${Date.now()}_${data.tiket}.jpg`;

  const res = await axios.get(url, { responseType: 'stream' });
  res.data.pipe(fs.createWriteStream(fileName));

  await saveToSheet(data);

  bot.sendMessage(msg.chat.id, '📸 Foto tersimpan');
});

// ===== REKAP HARIAN =====
cron.schedule('0 17 * * *', async () => {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:J',
  });

  const rows = result.data.values.slice(1);
  const today = moment().format('YYYY-MM-DD');

  const rekap = {};

  rows.forEach(r => {
    if (!r[0].includes(today)) return;

    const petugas = r[9];
    if (!petugas) return;

    if (!rekap[petugas]) rekap[petugas] = 0;
    rekap[petugas]++;
  });

  let msg = '📅 REKAP HARI INI\n\n';

  Object.entries(rekap).forEach(([nama, jumlah]) => {
    msg += `${nama}: ${jumlah}\n`;
  });

  bot.sendMessage(ADMIN_GROUP, msg);
});

console.log('🚀 BOT MCU SIAP');