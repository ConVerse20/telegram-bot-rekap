const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const SHEET_ID = '1sfRc6ku00NZArsoK-LcBkzK25O0-cj4WZHgIBGiliDo';

// API DATA
app.get('/data', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:J',
    });

    const rows = result.data.values;
    const header = rows[0];

    const data = rows.slice(1).map(r => {
      let obj = {};
      header.forEach((h, i) => obj[h] = r[i] || '');
      return obj;
    });

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error ambil data');
  }
});

// WEBHOOK
app.get('/webhook', (req, res) => {
  res.send('Webhook aktif 🚀');
});

app.post('/webhook', (req, res) => {
  console.log('Webhook masuk:', req.body);
  res.sendStatus(200);
});

// PORT RAILWAY
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server jalan di ${PORT}`));
