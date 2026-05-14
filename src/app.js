const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const {
  searchAnime,
  animeBySelection
} = require('./services/kodik');

const { isAllowedOrigin } = require('./server-config');

const app = express();

app.set('trust proxy', 1);

function isProductionRequest(req) {
  return process.env.NODE_ENV === 'production' || Boolean(req.headers['x-forwarded-proto']);
}

function getRequestProtocol(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();

  if (forwardedProto) {
    return forwardedProto;
  }

  return req.protocol;
}

function getRequestHost(req) {
  return String(req.headers.host || '').toLowerCase();
}

function shouldRedirectToCanonicalHost(req) {
  if (!isProductionRequest(req)) {
    return false;
  }

  const host = getRequestHost(req);
  const protocol = getRequestProtocol(req);

  if (!host) {
    return false;
  }

  if (host === 'localhost:3000' || host.startsWith('127.0.0.1')) {
    return false;
  }

  return protocol !== 'https' || host !== 'anivmeste.ru';
}

function redirectToCanonicalHost(req, res, next) {
  if (!shouldRedirectToCanonicalHost(req)) {
    return next();
  }

  const targetUrl = `https://anivmeste.ru${req.originalUrl || '/'}`;
  return res.redirect(301, targetUrl);
}

app.use(redirectToCanonicalHost);

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
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

app.use(express.json({ limit: '1mb' }));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});

app.use(globalLimiter);
app.use('/api', apiLimiter);

app.get('/robots.txt', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.sendFile(path.join(__dirname, '../public/robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.sendFile(path.join(__dirname, '../public/sitemap.xml'));
});

app.use(express.static(path.join(__dirname, '../public'), {
  extensions: false,
  index: false,
  maxAge: '1h'
}));

app.get('/api/kodik/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Введите минимум 2 символа для поиска' });
    }

    const result = await searchAnime(q);
    return res.json(result);
  } catch (error) {
    console.error('KODIK SEARCH ERROR:', error.message);
    return res.status(500).json({ error: 'Ошибка поиска', details: error.message });
  }
});

app.post('/api/kodik/anime/by-selection', async (req, res) => {
  try {
    const selected = req.body || {};

    if (!selected?.title && !selected?.shikimoriId && !selected?.kodikId) {
      return res.status(400).json({ error: 'Недостаточно данных для выбора аниме' });
    }

    const result = await animeBySelection(selected);

    if (!result) {
      return res.status(404).json({ error: 'Не удалось точно определить выбранное аниме' });
    }

    return res.json(result);
  } catch (error) {
    console.error('KODIK ANIME BY SELECTION ERROR:', error.message);
    return res.status(500).json({ error: 'Не удалось загрузить аниме', details: error.message });
  }
});

app.get('/api/yummy/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Введите минимум 2 символа для поиска' });
    }

    const result = await searchAnime(q);
    return res.json(result);
  } catch (error) {
    console.error('YUMMY SEARCH ERROR:', error.message);
    return res.status(500).json({ error: 'Ошибка поиска', details: error.message });
  }
});

app.post('/api/yummy/anime/by-selection', async (req, res) => {
  try {
    const selected = req.body || {};

    if (!selected?.title && !selected?.shikimoriId && !selected?.kodikId) {
      return res.status(400).json({ error: 'Недостаточно данных для выбора аниме' });
    }

    const result = await animeBySelection(selected);

    if (!result) {
      return res.status(404).json({ error: 'Не удалось точно определить выбранное аниме' });
    }

    return res.json(result);
  } catch (error) {
    console.error('YUMMY ANIME BY SELECTION ERROR:', error.message);
    return res.status(500).json({ error: 'Не удалось загрузить аниме', details: error.message });
  }
});

app.get('/room.html', (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.redirect(301, '/');
});

app.get('/room/:roomId', (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.sendFile(path.join(__dirname, '../public/room.html'));
});

app.get('/room/:roomId/*', (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.sendFile(path.join(__dirname, '../public/room.html'));
});

app.get(/^\/anime(?:\/.*)?$/, (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/support', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.sendFile(path.join(__dirname, '../public/support.html'));
});

app.get('/support.html', (req, res) => {
  return res.redirect(301, '/support');
});

app.use('/api', (req, res) => {
  return res.status(404).json({
    error: 'API route not found',
    method: req.method,
    path: req.originalUrl
  });
});

app.use((req, res) => {
  res.status(404);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;