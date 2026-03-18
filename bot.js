const { google } = require('googleapis');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const URL = process.env.RAILWAY_STATIC_URL;

const ALLOWED_USERS = []; // kosongkan dulu biar semua bisa akses
const ADMIN_GROUP = -100xxxxxxxxxx; // isi nanti

const SHEET_ID = '1sfRc6ku00NZArsoK-LcBkzK25O0-cj4WZHgIBGiliDo';

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();

app.use(express.json());

// ===== GLOBAL ERROR =====
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ===== WEBHOOK =====
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // ⚡ WAJIB cepat

  try {
    console.log('📩 UPDATE MASUK');
    bot.processUpdate(req.body);
  } catch (err) {
    console.error('❌ Webhook error:', err);
  }
});

// ===== START SERVER =====
app.listen(PORT, async () => {
  console.log('🚀 Server jalan di port', PORT);

  const webhookUrl = `${URL}/webhook`;
  console.log('🌐 Webhook:', webhookUrl);

  try {
    await bot.deleteWebHook();
    await bot.setWebHook(webhookUrl);
    console.log('✅ Webhook aktif');
  } catch (err) {
    console.error('❌ Gagal set webhook:', err);
  }
});

// ===== GOOGLE AUTH =====
let credentials;

try {
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
} catch (err) {
  console.error('❌ GOOGLE_CREDENTIALS ERROR:', err);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ===== FOLDER FOTO =====
if (!fs.existsSync('foto')) {
  fs.mkdirSync('foto');
}

// ===== PARSER =====
function parseLaporan(text = '') {
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

// ===== COMMAND START =====
bot.onText(/\/start/, (msg) => {
  console.log('START dari:', msg.from.id);
  bot.sendMessage(msg.chat.id, '🤖 BOT AKTIF 🔥');
});

// ===== HANDLE TEXT =====
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;

    if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(msg.from.id)) return;

    const data = parseLaporan(msg.text);

    if (!data.tiket) return;

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

console.log('🚀 BOT SIAP FULL');
