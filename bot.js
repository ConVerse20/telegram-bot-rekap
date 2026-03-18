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
const URL = process.env.RAILWAY_STATIC_URL || 'https://telegram-bot-rekap-production.up.railway.app';

const ALLOWED_USERS = [167474430,246759640,406752113,292115739,122882547,639241715,166577082,120002308,155299727,336877952,6862722575,601292992,114625129,129727898,785391351,123059157]; // ganti ID kamu
const ADMIN_GROUP = -1002498803166; // ganti ID grup

const SHEET_ID = '1sfRc6ku00NZArsoK-LcBkzK25O0-cj4WZHgIBGiliDo';

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();

app.use(express.json());

// ===== WEBHOOK =====
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // ⚡ balas duluan (penting!)
  
  try {
    bot.processUpdate(req.body);
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
  }
});

app.listen(PORT, async () => {
  console.log('🚀 Server jalan di port', PORT);

  console.log('Webhook URL:', `${URL}/webhook`);
  await bot.setWebHook(`${URL}/webhook`);

  console.log('✅ Webhook aktif');
});

// ===== GOOGLE AUTH =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ===== PASTIKAN FOLDER FOTO ADA =====
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

// ===== SAVE KE SHEET =====
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

  } catch (err) {
    console.error('❌ Error save sheet:', err.message);
  }
}

// ===== HANDLE TEXT =====
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;
    if (!ALLOWED_USERS.includes(msg.from.id)) return;

    const data = parseLaporan(msg.text);

    if (!data.tiket) {
      return bot.sendMessage(msg.chat.id, '❌ Format salah / NO TIKET tidak ada');
    }

    await saveToSheet(data);

    await bot.sendMessage(msg.chat.id, '✅ Tersimpan');

    await bot.sendMessage(ADMIN_GROUP, `
📊 LAPORAN MASUK

TIKET: ${data.tiket}
STATUS: ${data.status}
ODP: ${data.odp}
PETUGAS: ${data.petugas}
`);

  } catch (err) {
    console.error('❌ Error message:', err.message);
  }
});

// ===== HANDLE FOTO =====
bot.on('photo', async (msg) => {
  try {
    if (!ALLOWED_USERS.includes(msg.from.id)) return;

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

    await bot.sendMessage(msg.chat.id, '📸 Foto & data tersimpan');

  } catch (err) {
    console.error('❌ Error foto:', err.message);
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

    await bot.sendMessage(ADMIN_GROUP, msg);

  } catch (err) {
    console.error('❌ Error rekap:', err.message);
  }
}, {
  timezone: "Asia/Jakarta"
});

console.log('🚀 BOT MCU SIAP');
