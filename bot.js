const { google } = require('googleapis');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 8080;

// 🔥 HARDCODE BIAR GAK ERROR ENV
const URL = 'https://telegram-bot-rekap-production.up.railway.app';

const ADMIN_GROUP = null; // isi kalau perlu

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
  res.sendStatus(200);

  try {
    console.log('📩 UPDATE MASUK');
    bot.processUpdate(req.body);
  } catch (err) {
    console.error('❌ Webhook error:', err);
  }
});

// ===== START SERVER =====
app.listen(PORT, async () => {
  console.log('🌐 Server hidup di port', PORT);

  const webhookUrl = `${URL}/webhook`;
  console.log('🌐 Set webhook:', webhookUrl);

  try {
    await bot.deleteWebHook();
    await bot.setWebHook(webhookUrl);
    console.log('✅ Webhook aktif');
  } catch (err) {
    console.error('❌ Gagal webhook:', err);
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

// ===== SAVE KE SHEET =====
async function saveToSheet(data) {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DATA!A:J',
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

    console.log('✅ MASUK SHEET');

  } catch (err) {
    console.error('❌ ERROR ASLI:', err); // 🔥 INI PENTING
    throw err;
  }
}
// ===== START COMMAND =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🤖 BOT AKTIF 🔥');
});

// ===== HANDLE TEXT =====
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;

    const data = parseLaporan(msg.text);

    if (!data.tiket) return;

    await saveToSheet(data);

    bot.sendMessage(msg.chat.id, '✅ Data masuk Google Sheet');

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
    console.error('❌ ERROR MESSAGE:', err);
    bot.sendMessage(msg.chat.id, '❌ Gagal simpan ke sheet');
  }
});

// ===== FOTO (OPSIONAL) =====
bot.on('photo', async (msg) => {
  try {
    const caption = msg.caption || '';
    const data = parseLaporan(caption);

    if (!data.tiket) {
      return bot.sendMessage(msg.chat.id, '❌ Caption wajib ada NO TIKET');
    }

    await saveToSheet(data);

    bot.sendMessage(msg.chat.id, '📸 Foto + data tersimpan');

  } catch (err) {
    console.error(err);
  }
});

// ===== REKAP =====
cron.schedule('0 17 * * *', async () => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DATA!A:J',
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
    console.error('❌ ERROR REKAP:', err);
  }
}, {
  timezone: "Asia/Jakarta"
});

console.log('🚀 BOT SIAP FULL');
