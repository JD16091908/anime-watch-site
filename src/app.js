const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const {
  searchAnime,
  animeBySelection
} = require('./services/kodik');

const app = express();
app.set('trust proxy', 1);

/* ================= CONFIG ================= */

const ALLOWED_ORIGINS = new Set([
  'https://anivmeste.ru',
  'https://www.anivmeste.ru',
  'https://anivmeste.onrender.com'
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

/* ================= MIDDLEWARE ================= */

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const origin = req.headers.origin;

    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
  }

  next();
});

app.use(helmet({
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '1mb' }));

/* ================= RATE LIMIT ================= */

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120
});

app.use(globalLimiter);
app.use('/api', apiLimiter);

/* ================= STATIC ================= */

app.use(express.static(path.join(__dirname, '../public'), {
  index: false,
  maxAge: '1h'
}));

/* ================= API ================= */

// 🔍 поиск
app.get('/api/kodik/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Минимум 2 символа' });
    }

    const result = await searchAnime(q);
    res.json(result);
  } catch (e) {
    console.error('SEARCH ERROR:', e.message);
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// 🎬 получение аниме
app.post('/api/kodik/anime/by-selection', async (req, res) => {
  try {
    const selected = req.body || {};

    const result = await animeBySelection(selected);

    if (!result) {
      return res.status(404).json({ error: 'Аниме не найдено' });
    }

    res.json(result);
  } catch (e) {
    console.error('ANIME ERROR:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки аниме' });
  }
});

// алиасы (оставляем как было)
app.get('/api/yummy/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const result = await searchAnime(q);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/yummy/anime/by-selection', async (req, res) => {
  try {
    const result = await animeBySelection(req.body);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Ошибка' });
  }
});

/* ================= PAGES ================= */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/support.html'));
});

/* ================= 404 ================= */

app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'API route not found',
    path: req.originalUrl
  });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;