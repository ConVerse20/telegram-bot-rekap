const { google } = require('googleapis');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const URL = 'https://telegram-bot-rekap-production.up.railway.app';

const ALLOWED_USERS = [167474430,246759640,406752113,292115739,122882547,639241715,166577082,120002308,155299727,336877952,6862722575,601292992,114625129,129727898,785391351,123059157];
const ADMIN_GROUP = -1002498803166;

const SHEET_ID = '1sfRc6ku00NZArsoK-LcBkzK25O0-cj4WZHgIBGiliDo';

// ===== INIT EXPRESS =====
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🚀 BOT AKTIF');
});

// ===== INIT BOT =====
const bot = new TelegramBot(TOKEN, {
  webHook: true
});

// ===== SET & CEK WEBHOOK (ANTI RESET) =====
async function initWebhook() {
  try {
    console.log('🔄 SET WEBHOOK...');

    const res = await bot.setWebHook(`${URL}/webhook`);
    console.log('✅ SET WEBHOOK:', res);

    const info = await bot.getWebHookInfo();
    console.log('📡 WEBHOOK INFO:', info);

    if (!info.url) {
      console.log('⚠️ WEBHOOK MASIH KOSONG!');
    }

  } catch (err) {
    console.error('❌ WEBHOOK ERROR:', err.message);
  }
}

initWebhook();

// ===== WEBHOOK =====
app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  try {
    console.log('📩 UPDATE MASUK');
    bot.processUpdate(req.body);
  } catch (err) {
    console.error('❌ Webhook error:', err);
  }
});

// ===== GOOGLE AUTH =====
let credentials;

try {
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
} catch (err) {
  console.error('❌ GOOGLE_CREDENTIALS ERROR:', err.message);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ===== FOLDER FOTO =====
if (!fs.existsSync('foto')) {
  fs.mkdirSync('foto');
}

// ===== PARSER (ANTI GAGAL) =====
function parseLaporan(text = '') {
  const clean = text.replace(/\r/g, '');

  const get = (label) => {
    const regex = new RegExp(`[-•]?\\s*${label}\\s*:\\s*(.+)`, 'i');
    const match = clean.match(regex);
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

// ===== SAVE TO SHEET =====
async function saveToSheet(data) {
  try {
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

    console.log('✅ Masuk sheet');

  } catch (err) {
    console.error('❌ Error sheet:', err.message);
  }
}

// ===== COMMAND =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 BOT AKTIF 🔥');
});

// ===== HANDLE TEXT =====
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;

    // ❗ skip command biar gak bentrok
    if (msg.text.startsWith('/')) return;

    console.log('📥 MASUK:', msg.text);

    // ❗ filter user
    if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(msg.from.id)) {
      console.log('⛔ USER TIDAK DIIZINKAN:', msg.from.id);
      return;
    }

    const data = parseLaporan(msg.text);
    console.log('📊 PARSED:', data);

    if (!data.tiket) {
      console.log('❌ TIKET TIDAK KEBACA');
      return;
    }

    await saveToSheet(data);

    bot.sendMessage(msg.chat.id, '✅ Tersimpan');

    if (ADMIN_GROUP) {
      bot.sendMessage(ADMIN_GROUP, `
📊 LAPORAN MASUK

TIKET: ${data.tiket}
STATUS: ${data.status}
ODP: ${data.odp}
PETUGAS: ${data.petugas}
`);
    }

  } catch (err) {
    console.error('❌ Error message:', err);
  }
});

// ===== HANDLE FOTO =====
bot.on('photo', async (msg) => {
  try {
    const caption = msg.caption || '';
    const data = parseLaporan(caption);

    if (!data.tiket) {
      return bot.sendMessage(msg.chat.id, '❌ Caption wajib ada NO TIKET');
    }

    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const file = await bot.getFile(fileId);

    const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
    const fileName = `foto/${Date.now()}_${data.tiket}.jpg`;

    const res = await axios.get(url, { responseType: 'stream' });
    const writer = fs.createWriteStream(fileName);

    res.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    await saveToSheet(data);

    bot.sendMessage(msg.chat.id, '📸 Foto & data tersimpan');

  } catch (err) {
    console.error('❌ Error foto:', err);
  }
});

// ===== REKAP HARIAN =====
cron.schedule('0 17 * * *', async () => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:J',
    });

    const rows = result.data.values?.slice(1) || [];
    const today = moment().format('YYYY-MM-DD');

    const rekap = {};

    rows.forEach(r => {
      if (!r[0] || !r[0].includes(today)) return;

      const petugas = r[9];
      if (!petugas) return;

      if (!rekap[petugas]) rekap[petugas] = 0;
      rekap[petugas]++;
    });

    let msg = '📅 REKAP HARI INI\n\n';

    Object.entries(rekap).forEach(([nama, jumlah]) => {
      msg += `${nama}: ${jumlah}\n`;
    });

    if (ADMIN_GROUP) {
      bot.sendMessage(ADMIN_GROUP, msg);
    }

  } catch (err) {
    console.error('❌ Error rekap:', err);
  }
}, {
  timezone: "Asia/Jakarta"
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server jalan di port', PORT);
});

console.log('🚀 BOT SIAP FULL');
