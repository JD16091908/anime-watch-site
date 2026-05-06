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

const SEO_ANIME = [
  { slug: 'naruto', title: 'Наруто', year: '2002', description: 'Смотрите Наруто вместе с друзьями на AniVmeste: создавайте комнату, приглашайте друзей и синхронно смотрите аниме онлайн.' },
  { slug: 'naruto-shippuden', title: 'Наруто: Ураганные хроники', year: '2007', description: 'Смотрите Наруто: Ураганные хроники вместе на AniVmeste в комнате совместного просмотра.' },
  { slug: 'one-piece', title: 'Ван-Пис', year: '1999', description: 'Смотрите Ван-Пис вместе с друзьями онлайн на AniVmeste с синхронизацией просмотра и чатом.' },
  { slug: 'attack-on-titan', title: 'Атака титанов', year: '2013', description: 'Смотрите Атаку титанов вместе на AniVmeste: удобные комнаты, чат и синхронный просмотр.' },
  { slug: 'jujutsu-kaisen', title: 'Магическая битва', year: '2020', description: 'Смотрите Магическую битву онлайн вместе с друзьями через комнату AniVmeste.' },
  { slug: 'demon-slayer', title: 'Клинок, рассекающий демонов', year: '2019', description: 'Смотрите Клинок, рассекающий демонов вместе на AniVmeste с друзьями и синхронизацией.' },
  { slug: 'hunter-x-hunter', title: 'Охотник х Охотник', year: '2011', description: 'Смотрите Охотник х Охотник онлайн вместе с друзьями на AniVmeste.' },
  { slug: 'death-note', title: 'Тетрадь смерти', year: '2006', description: 'Смотрите Тетрадь смерти вместе онлайн на AniVmeste: создавайте комнату и приглашайте друзей.' },
  { slug: 'tokyo-ghoul', title: 'Токийский гуль', year: '2014', description: 'Смотрите Токийский гуль вместе с друзьями в комнате AniVmeste.' },
  { slug: 'bleach', title: 'Блич', year: '2004', description: 'Смотрите Блич онлайн вместе на AniVmeste с синхронизацией просмотра.' },
  { slug: 'solo-leveling', title: 'Поднятие уровня в одиночку', year: '2024', description: 'Смотрите Поднятие уровня в одиночку вместе с друзьями на AniVmeste.' },
  { slug: 'chainsaw-man', title: 'Человек-бензопила', year: '2022', description: 'Смотрите Человека-бензопилу онлайн вместе с друзьями на AniVmeste.' },
  { slug: 'fullmetal-alchemist-brotherhood', title: 'Стальной алхимик: Братство', year: '2009', description: 'Смотрите Стального алхимика: Братство вместе онлайн на AniVmeste.' },
  { slug: 'my-hero-academia', title: 'Моя геройская академия', year: '2016', description: 'Смотрите Мою геройскую академию вместе с друзьями через комнату AniVmeste.' },
  { slug: 'black-clover', title: 'Чёрный клевер', year: '2017', description: 'Смотрите Чёрный клевер вместе онлайн на AniVmeste.' },
  { slug: 'dragon-ball', title: 'Драконий жемчуг', year: '1986', description: 'Смотрите Драконий жемчуг вместе с друзьями на AniVmeste.' },
  { slug: 'dragon-ball-z', title: 'Драконий жемчуг Z', year: '1989', description: 'Смотрите Драконий жемчуг Z онлайн вместе через AniVmeste.' },
  { slug: 'dragon-ball-super', title: 'Драконий жемчуг Супер', year: '2015', description: 'Смотрите Драконий жемчуг Супер вместе с друзьями на AniVmeste.' },
  { slug: 'fairy-tail', title: 'Хвост Феи', year: '2009', description: 'Смотрите Хвост Феи онлайн вместе с друзьями на AniVmeste.' },
  { slug: 'sword-art-online', title: 'Мастера меча онлайн', year: '2012', description: 'Смотрите Мастера меча онлайн вместе через комнату AniVmeste.' },
  { slug: 're-zero', title: 'Re:Zero. Жизнь с нуля в альтернативном мире', year: '2016', description: 'Смотрите Re:Zero вместе онлайн с синхронизацией на AniVmeste.' },
  { slug: 'steins-gate', title: 'Врата Штейна', year: '2011', description: 'Смотрите Врата Штейна вместе с друзьями на AniVmeste.' },
  { slug: 'code-geass', title: 'Код Гиас', year: '2006', description: 'Смотрите Код Гиас онлайн вместе через AniVmeste.' },
  { slug: 'evangelion', title: 'Евангелион', year: '1995', description: 'Смотрите Евангелион вместе с друзьями в комнате AniVmeste.' },
  { slug: 'cowboy-bebop', title: 'Ковбой Бибоп', year: '1998', description: 'Смотрите Ковбой Бибоп онлайн вместе на AniVmeste.' },
  { slug: 'vinland-saga', title: 'Сага о Винланде', year: '2019', description: 'Смотрите Сагу о Винланде вместе с друзьями на AniVmeste.' },
  { slug: 'mob-psycho-100', title: 'Моб Психо 100', year: '2016', description: 'Смотрите Моб Психо 100 онлайн вместе через AniVmeste.' },
  { slug: 'one-punch-man', title: 'Ванпанчмен', year: '2015', description: 'Смотрите Ванпанчмена вместе с друзьями на AniVmeste.' },
  { slug: 'haikyuu', title: 'Волейбол!!', year: '2014', description: 'Смотрите Волейбол!! онлайн вместе на AniVmeste.' },
  { slug: 'blue-lock', title: 'Синяя тюрьма: Блю Лок', year: '2022', description: 'Смотрите Блю Лок вместе с друзьями в комнате AniVmeste.' },
  { slug: 'spy-x-family', title: 'Семья шпиона', year: '2022', description: 'Смотрите Семью шпиона онлайн вместе через AniVmeste.' },
  { slug: 'dr-stone', title: 'Доктор Стоун', year: '2019', description: 'Смотрите Доктор Стоун вместе с друзьями на AniVmeste.' },
  { slug: 'fire-force', title: 'Пламенная бригада пожарных', year: '2019', description: 'Смотрите Пламенную бригаду пожарных онлайн вместе на AniVmeste.' },
  { slug: 'noragami', title: 'Бездомный бог', year: '2014', description: 'Смотрите Бездомного бога вместе с друзьями на AniVmeste.' },
  { slug: 'parasyte', title: 'Паразит: Учение о жизни', year: '2014', description: 'Смотрите Паразит онлайн вместе через AniVmeste.' },
  { slug: 'erased', title: 'Город, в котором меня нет', year: '2016', description: 'Смотрите Город, в котором меня нет вместе с друзьями на AniVmeste.' },
  { slug: 'your-lie-in-april', title: 'Твоя апрельская ложь', year: '2014', description: 'Смотрите Твою апрельскую ложь онлайн вместе на AniVmeste.' },
  { slug: 'violet-evergarden', title: 'Вайолет Эвергарден', year: '2018', description: 'Смотрите Вайолет Эвергарден вместе с друзьями на AniVmeste.' },
  { slug: 'clannad', title: 'Кланнад', year: '2007', description: 'Смотрите Кланнад онлайн вместе через AniVmeste.' },
  { slug: 'toradora', title: 'Торадора!', year: '2008', description: 'Смотрите Торадора! вместе с друзьями на AniVmeste.' },
  { slug: 'kaguya-sama', title: 'Госпожа Кагуя: в любви как на войне', year: '2019', description: 'Смотрите Госпожу Кагую онлайн вместе на AniVmeste.' },
  { slug: 'konosuba', title: 'Этот замечательный мир!', year: '2016', description: 'Смотрите Этот замечательный мир! вместе с друзьями через AniVmeste.' },
  { slug: 'overlord', title: 'Повелитель', year: '2015', description: 'Смотрите Повелителя онлайн вместе на AniVmeste.' },
  { slug: 'mushoku-tensei', title: 'Реинкарнация безработного', year: '2021', description: 'Смотрите Реинкарнацию безработного вместе с друзьями на AniVmeste.' },
  { slug: 'that-time-i-got-reincarnated-as-a-slime', title: 'О моём перерождении в слизь', year: '2018', description: 'Смотрите О моём перерождении в слизь онлайн вместе через AniVmeste.' },
  { slug: 'classroom-of-the-elite', title: 'Добро пожаловать в класс превосходства', year: '2017', description: 'Смотрите Класс превосходства вместе с друзьями на AniVmeste.' },
  { slug: 'made-in-abyss', title: 'Созданный в Бездне', year: '2017', description: 'Смотрите Созданный в Бездне онлайн вместе на AniVmeste.' },
  { slug: 'black-butler', title: 'Тёмный дворецкий', year: '2008', description: 'Смотрите Тёмного дворецкого вместе с друзьями через AniVmeste.' },
  { slug: 'hellsing', title: 'Хеллсинг', year: '2001', description: 'Смотрите Хеллсинг онлайн вместе на AniVmeste.' },
  { slug: 'berserk', title: 'Берсерк', year: '1997', description: 'Смотрите Берсерк вместе с друзьями в комнате AniVmeste.' },
  { slug: 'monster', title: 'Монстр', year: '2004', description: 'Смотрите Монстр онлайн вместе через AniVmeste.' },
  { slug: 'pluto', title: 'Плутон', year: '2023', description: 'Смотрите Плутон вместе с друзьями на AniVmeste.' },
  { slug: 'dandadan', title: 'Дандадан', year: '2024', description: 'Смотрите Дандадан онлайн вместе на AniVmeste.' }
];

const SEO_ANIME_BY_SLUG = new Map(SEO_ANIME.map(item => [item.slug, item]));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildAnimeSeoPage(anime) {
  const canonicalUrl = `https://anivmeste.ru/anime/${encodeURIComponent(anime.slug)}`;
  const title = `${anime.title} смотреть вместе онлайн — AniVmeste`;
  const description = anime.description;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${canonicalUrl}" />

  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/favicon.png" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:site_name" content="AniVmeste" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="https://anivmeste.ru/og-image.png" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="https://anivmeste.ru/og-image.png" />

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": ${JSON.stringify(title)},
    "url": ${JSON.stringify(canonicalUrl)},
    "description": ${JSON.stringify(description)},
    "isPartOf": {
      "@type": "WebSite",
      "name": "AniVmeste",
      "url": "https://anivmeste.ru"
    }
  }
  </script>

  <style>
    :root {
      --bg-main: #09101d;
      --bg-main-2: #0d1527;
      --text-main: #ffffff;
      --text-soft: #dbe7ff;
      --text-muted: #aebad6;
      --blue: #7bb4ff;
      --violet: #9180ff;
      --pink: #ff84a8;
      --line: rgba(255, 255, 255, 0.10);
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top left, rgba(123, 180, 255, 0.16), transparent 24%),
        radial-gradient(circle at top right, rgba(255, 132, 168, 0.14), transparent 22%),
        linear-gradient(180deg, var(--bg-main) 0%, var(--bg-main-2) 100%);
      color: var(--text-main);
      font-family: "Segoe UI", Roboto, Arial, sans-serif;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .page {
      min-height: 100vh;
      padding: 24px 20px 72px;
    }

    .header {
      width: min(100%, 1120px);
      margin: 0 auto 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 16px;
      background: rgba(18, 26, 46, 0.88);
      border: 1px solid var(--line);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
    }

    .brand img {
      width: 30px;
      height: 30px;
      object-fit: contain;
    }

    .brand span {
      font-size: 20px;
      font-weight: 900;
      letter-spacing: -0.03em;
    }

    .home-link {
      min-height: 42px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
      border-radius: 14px;
      color: #ffffff;
      font-weight: 800;
      background: linear-gradient(90deg, #5f7cff 0%, #7d74ff 50%, #ff6d97 100%);
      box-shadow: 0 10px 28px rgba(108, 98, 255, 0.28);
    }

    .card {
      width: min(100%, 1120px);
      margin: 0 auto;
      padding: 36px;
      border-radius: 30px;
      background: linear-gradient(180deg, rgba(18, 26, 46, 0.96), rgba(13, 20, 36, 0.96));
      border: 1px solid var(--line);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.42);
      overflow: hidden;
      position: relative;
    }

    .card::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 15% 0%, rgba(123, 180, 255, 0.10), transparent 22%),
        radial-gradient(circle at 100% 30%, rgba(255, 132, 168, 0.08), transparent 20%);
      pointer-events: none;
    }

    .content {
      position: relative;
      z-index: 1;
      max-width: 760px;
    }

    .badge {
      display: inline-flex;
      margin-bottom: 18px;
      padding: 10px 14px;
      border-radius: 999px;
      background: linear-gradient(135deg, rgba(123, 180, 255, 0.16), rgba(255, 132, 168, 0.16));
      border: 1px solid var(--line);
      color: #f7faff;
      font-size: 14px;
      font-weight: 800;
    }

    h1 {
      margin: 0 0 14px;
      font-size: clamp(36px, 5vw, 58px);
      line-height: 1.06;
      font-weight: 950;
      letter-spacing: -0.04em;
    }

    .meta {
      margin: 0 0 20px;
      color: #ffb0c4;
      font-size: 16px;
      font-weight: 700;
    }

    .description {
      margin: 0 0 28px;
      color: var(--text-soft);
      font-size: 18px;
      line-height: 1.7;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .btn {
      min-height: 54px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 20px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      font-size: 16px;
      font-weight: 900;
    }

    .btn-primary {
      background: linear-gradient(90deg, #5f7cff 0%, #7d74ff 50%, #ff6d97 100%);
      box-shadow: 0 10px 28px rgba(108, 98, 255, 0.28);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.07);
      color: #dce7ff;
    }

    .links {
      width: min(100%, 1120px);
      margin: 18px auto 0;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .links a {
      color: #adc2ff;
      font-weight: 700;
    }

    @media (max-width: 768px) {
      .page {
        padding: 14px 12px 48px;
      }

      .header {
        flex-direction: column;
        align-items: stretch;
      }

      .brand,
      .home-link {
        width: 100%;
      }

      .brand {
        justify-content: center;
      }

      .card {
        padding: 24px 18px;
        border-radius: 24px;
      }

      .actions {
        flex-direction: column;
      }

      .btn {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <a class="brand" href="/" aria-label="AniVmeste">
        <img src="/favicon.svg" alt="" />
        <span>AniVmeste</span>
      </a>
      <a class="home-link" href="/">На главную</a>
    </header>

    <article class="card">
      <div class="content">
        <div class="badge">Совместный просмотр аниме</div>
        <h1>${escapeHtml(anime.title)} смотреть вместе онлайн</h1>
        <p class="meta">${escapeHtml(anime.year)} • аниме • совместный просмотр</p>
        <p class="description">${escapeHtml(description)}</p>

        <div class="actions">
          <a class="btn btn-primary" href="/room/solo?anime=${encodeURIComponent(anime.title)}">Смотреть в соло режиме</a>
          <a class="btn btn-secondary" href="/?anime=${encodeURIComponent(anime.title)}">Создать комнату</a>
        </div>
      </div>
    </article>

    <section class="links">
      <p>
        AniVmeste помогает смотреть аниме вместе: создайте комнату, отправьте ссылку друзьям и обсуждайте просмотр в чате.
      </p>
      <p>
        Популярные страницы:
        <a href="/anime/naruto">Наруто</a>,
        <a href="/anime/one-piece">Ван-Пис</a>,
        <a href="/anime/attack-on-titan">Атака титанов</a>,
        <a href="/anime/hunter-x-hunter">Охотник х Охотник</a>.
      </p>
    </section>
  </main>
</body>
</html>`;
}

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
    const result = await animeBySelection(req.body || {});

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
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/support', (req, res) => {
  return res.sendFile(path.join(__dirname, '../public/support.html'));
});

app.get('/support.html', (req, res) => {
  return res.sendFile(path.join(__dirname, '../public/support.html'));
});

app.use('/api', (req, res) => {
  return res.status(404).json({
    error: 'API route not found',
    method: req.method,
    path: req.originalUrl
  });
});

app.use((req, res) => {
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;