const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

app.get('/', (req, res) => {
  res.send('Bot hidup');
});

app.listen(PORT, () => {
  console.log(`🌐 Server hidup di port ${PORT}`);
});

// ================== STORAGE ==================
let dataRekap = [];

// ================== PARSER ==================
function parseMessage(text) {
  const fields = {
    status: '',
    tiket: '',
    inet: '',
    cp: '',
    gangguan: '',
    perbaikan: '',
    alamat: '',
    odp: '',
    petugas: ''
  };

  const lines = text.split('\n');

  lines.forEach(line => {
    const l = line.toUpperCase();

    if (l.includes('STATUS')) fields.status = line.split(':')[1]?.trim() || '';
    if (l.includes('NO TIKET')) fields.tiket = line.split(':')[1]?.trim() || '';
    if (l.includes('INET/TLP')) fields.inet = line.split(':')[1]?.trim() || '';
    if (l.includes('CP PELANGGAN')) fields.cp = line.split(':')[1]?.trim() || '';
    if (l.includes('PENYEBAB')) fields.gangguan = line.split(':')[1]?.trim() || '';
    if (l.includes('LANGKAH')) fields.perbaikan = line.split(':')[1]?.trim() || '';
    if (l.includes('ALAMAT')) fields.alamat = line.split(':')[1]?.trim() || '';
    if (l.includes('ODP')) fields.odp = line.split(':')[1]?.trim() || '';
    if (l.includes('PETUGAS')) fields.petugas = line.split(':')[1]?.trim() || '';
  });

  return fields;
}

// ================== VALIDASI ==================
function isKosong(data) {
  return Object.values(data).every(v => v === '');
}

// ================== HANDLE MESSAGE ==================
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // command rekap
  if (text === '/rekap') {
    if (dataRekap.length === 0) {
      return bot.sendMessage(chatId, '📭 Belum ada data rekap');
    }

    let hasil = '📋 REKAP TIKET\n\n';

    dataRekap.forEach((d, i) => {
      hasil += `${i + 1}.
STATUS: ${d.status}
TIKET: ${d.tiket}
INET: ${d.inet}
PETUGAS: ${d.petugas}

`;
    });

    return bot.sendMessage(chatId, hasil);
  }

  // parsing input
  const parsed = parseMessage(text);

  // kalau kosong semua → skip
  if (isKosong(parsed)) {
    console.log('⛔ Data kosong, tidak disimpan');
    return;
  }

  // simpan
  dataRekap.push(parsed);

  console.log('✅ DATA MASUK:', parsed);

  bot.sendMessage(chatId, '✅ Data berhasil disimpan');
});
