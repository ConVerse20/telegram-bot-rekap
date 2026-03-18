const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();
app.use(cors());

const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const SHEET_ID = '1sfRc6ku00NZArsoK-LcBkzK25O0-cj4WZHgIBGiliDo';

app.get('/data', async (req, res) => {
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
});

app.listen(3000, () => console.log('🚀 API jalan di 3000'));