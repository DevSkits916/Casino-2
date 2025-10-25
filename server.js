const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'balances.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { players: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
}

function loadData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    const data = JSON.parse(raw);
    if (!data.players || typeof data.players !== 'object') {
      data.players = {};
    }
    return data;
  } catch (err) {
    console.error('Failed to parse balances.json, resetting.', err);
    const fallback = { players: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getOrCreatePlayer(data, username) {
  if (!data.players[username]) {
    data.players[username] = {
      balance: 1000,
      history: [],
    };
    appendHistory(data.players[username], {
      ts: new Date().toISOString(),
      game: 'system',
      delta: 0,
      desc: 'auto-created profile',
    });
    saveData(data);
  }
  return data.players[username];
}

function appendHistory(player, entry) {
  player.history.push(entry);
}

ensureDataFile();
let dataCache = loadData();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function parseInteger(value) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

app.get('/api/profile', (req, res) => {
  const username = (req.query.username || '').trim();
  if (!username) {
    return res.status(400).json({ ok: false, error: 'USERNAME_REQUIRED' });
  }
  dataCache = loadData();
  const player = getOrCreatePlayer(dataCache, username);
  saveData(dataCache);
  res.json({ ok: true, username, balance: player.balance });
});

app.post('/api/profile/save', (req, res) => {
  const username = (req.body.username || '').trim();
  const balanceValue = parseInteger(req.body.balance);

  if (!username) {
    return res.status(400).json({ ok: false, error: 'USERNAME_REQUIRED' });
  }
  if (balanceValue === null || balanceValue < 0) {
    return res.status(400).json({ ok: false, error: 'INVALID_BALANCE' });
  }

  dataCache = loadData();
  const player = getOrCreatePlayer(dataCache, username);
  player.balance = balanceValue;
  appendHistory(player, {
    ts: new Date().toISOString(),
    game: 'manual-save',
    delta: 0,
    desc: 'session save',
  });
  saveData(dataCache);
  res.json({ ok: true });
});

app.post('/api/game/charge', (req, res) => {
  const username = (req.body.username || '').trim();
  const game = (req.body.game || '').trim() || 'unknown';
  const amountValue = parseInteger(req.body.amount);
  const desc = (req.body.desc || '').trim() || 'game charge';

  if (!username) {
    return res.status(400).json({ ok: false, error: 'USERNAME_REQUIRED' });
  }
  if (amountValue === null || amountValue <= 0) {
    return res.status(400).json({ ok: false, error: 'INVALID_AMOUNT' });
  }

  dataCache = loadData();
  const player = getOrCreatePlayer(dataCache, username);
  if (player.balance - amountValue < 0) {
    return res.json({ ok: false, error: 'INSUFFICIENT_FUNDS' });
  }

  player.balance -= amountValue;
  appendHistory(player, {
    ts: new Date().toISOString(),
    game,
    delta: -amountValue,
    desc,
  });
  saveData(dataCache);
  res.json({ ok: true, balance: player.balance });
});

app.post('/api/game/payout', (req, res) => {
  const username = (req.body.username || '').trim();
  const game = (req.body.game || '').trim() || 'unknown';
  const amountValue = parseInteger(req.body.amount);
  const desc = (req.body.desc || '').trim() || 'game payout';

  if (!username) {
    return res.status(400).json({ ok: false, error: 'USERNAME_REQUIRED' });
  }
  if (amountValue === null || amountValue <= 0) {
    return res.status(400).json({ ok: false, error: 'INVALID_AMOUNT' });
  }

  dataCache = loadData();
  const player = getOrCreatePlayer(dataCache, username);
  player.balance += amountValue;
  appendHistory(player, {
    ts: new Date().toISOString(),
    game,
    delta: amountValue,
    desc,
  });
  saveData(dataCache);
  res.json({ ok: true, balance: player.balance });
});

app.get('/api/admin/users', (req, res) => {
  dataCache = loadData();
  const users = Object.entries(dataCache.players).map(([username, info]) => ({
    username,
    balance: info.balance,
  }));
  res.json({ ok: true, users });
});

app.get('/api/admin/user-detail', (req, res) => {
  const username = (req.query.username || '').trim();
  if (!username) {
    return res.status(400).json({ ok: false, error: 'USERNAME_REQUIRED' });
  }
  dataCache = loadData();
  const player = getOrCreatePlayer(dataCache, username);
  saveData(dataCache);
  res.json({
    ok: true,
    username,
    balance: player.balance,
    history: player.history,
  });
});

app.post('/api/admin/set-balance', (req, res) => {
  const username = (req.body.username || '').trim();
  const balanceValue = parseInteger(req.body.balance);
  const note = (req.body.note || '').trim() || 'admin adjustment';

  if (!username) {
    return res.status(400).json({ ok: false, error: 'USERNAME_REQUIRED' });
  }
  if (balanceValue === null || balanceValue < 0) {
    return res.status(400).json({ ok: false, error: 'INVALID_BALANCE' });
  }

  dataCache = loadData();
  const player = getOrCreatePlayer(dataCache, username);
  const delta = balanceValue - player.balance;
  player.balance = balanceValue;
  appendHistory(player, {
    ts: new Date().toISOString(),
    game: 'admin-adjust',
    delta,
    desc: note,
  });
  saveData(dataCache);
  res.json({ ok: true, balance: player.balance });
});

app.post('/api/admin/delete-user', (req, res) => {
  const username = (req.body.username || '').trim();
  if (!username) {
    return res.status(400).json({ ok: false, error: 'USERNAME_REQUIRED' });
  }
  dataCache = loadData();
  if (dataCache.players[username]) {
    delete dataCache.players[username];
    saveData(dataCache);
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Casino prototype server running on port ${PORT}`);
});

