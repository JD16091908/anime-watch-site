const KODIK_TOKEN = String(process.env.KODIK_TOKEN || '').trim();
const KODIK_API_BASE = 'https://kodik-api.com';

const CACHE_TTL = 10 * 60 * 1000;
const searchCache = new Map();

const KODIK_TYPES = 'anime-serial,anime,anime-film,anime-ova,anime-special';

const HUNTER_QUERIES = [
  'hunter x hunter',
  'hunter hunter',
  'hunter x hunter 2011',
  'hunter x hunter tv',
  'охотник х охотник',
  'охотник x охотник',
  'хантер х хантер',
  'хантер x хантер'
];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[×✕]/g, ' x ')
    .replace(/(^|[^\p{L}\p{N}])([xх])(?=$|[^\p{L}\p{N}])/giu, '$1 x')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHunterQuery(q) {
  const n = normalize(q);
  return (
    n.includes('hunter') ||
    n.includes('хантер') ||
    n.includes('охотник')
  );
}

function getSearchQueries(query) {
  const n = normalize(query);

  if (isHunterQuery(n)) {
    return HUNTER_QUERIES;
  }

  return [query, n].filter(Boolean);
}

async function kodikGet(endpoint, params = {}) {
  if (!KODIK_TOKEN) {
    throw new Error('KODIK_TOKEN is missing');
  }

  const query = new URLSearchParams({
    token: KODIK_TOKEN,
    limit: '80',
    ...params
  });

  const url = `${KODIK_API_BASE}${endpoint}?${query.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`Kodik HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function titleOf(item) {
  return (
    item?.title ||
    item?.ru_title ||
    item?.material_data?.title ||
    item?.material_data?.ru_title ||
    item?.material_data?.anime_title ||
    item?.material_data?.full_title ||
    'Без названия'
  );
}

function posterOf(item) {
  const poster =
    item?.poster_url ||
    item?.poster ||
    item?.material_data?.poster_url ||
    item?.material_data?.poster ||
    '';

  if (!poster) return '';
  return poster.startsWith('//') ? `https:${poster}` : poster;
}

function yearOf(item) {
  return item?.year || item?.material_data?.year || '';
}

function typeOf(item) {
  return item?.type || item?.material_data?.type || item?.material_data?.anime_kind || '';
}

function shikimoriIdOf(item) {
  return item?.shikimori_id || item?.material_data?.shikimori_id || null;
}

function materialIdOf(item) {
  return item?.material_id || item?.material_data?.id || null;
}

function isSerial(item) {
  return String(typeOf(item)).toLowerCase().includes('serial');
}

function getScore(item, query) {
  const q = normalize(query);
  const title = normalize(titleOf(item));
  const type = normalize(typeOf(item));

  let score = 0;

  if (title === q) score += 10000;
  if (title.includes(q)) score += 5000;

  if (isHunterQuery(q)) {
    const hunterTitle =
      title.includes('hunter') ||
      title.includes('охотник') ||
      title.includes('хантер');

    if (hunterTitle) score += 12000;
    if (isSerial(item)) score += 8000;

    if (
      title.includes('movie') ||
      title.includes('фильм') ||
      title.includes('ova') ||
      title.includes('ова') ||
      type.includes('film') ||
      type.includes('ova')
    ) {
      score -= 9000;
    }

    if (String(yearOf(item)) === '2011') score += 5000;
    if (String(yearOf(item)) === '1999') score += 2500;
  }

  if (posterOf(item)) score += 100;
  if (shikimoriIdOf(item)) score += 300;

  return score;
}

function mapSearchItem(item, query) {
  const shikimoriId = shikimoriIdOf(item);
  const kodikId = item?.id || null;
  const animeId = shikimoriId ? `shikimori:${shikimoriId}` : `kodik:${kodikId || 'unknown'}`;
  const score = getScore(item, query);
  const year = yearOf(item);
  const numericYear = Number(year) || 0;

  return {
    animeId,
    animeUrl: animeId,
    title: titleOf(item),
    altTitles: [
      item?.title,
      item?.ru_title,
      item?.material_data?.title,
      item?.material_data?.ru_title,
      item?.material_data?.anime_title,
      item?.material_data?.full_title
    ].filter(Boolean),
    year,
    description: item?.material_data?.description || item?.description || '',
    poster: posterOf(item),
    status: item?.material_data?.anime_status || item?.status || '',
    type: typeOf(item),
    shikimoriId,
    kodikId,
    materialId: materialIdOf(item),
    score,
    matchPriority: -score,
    releaseTs: numericYear ? -numericYear : 0
  };
}

function dedupe(items) {
  const map = new Map();

  for (const item of items) {
    const key = item.shikimoriId
      ? `shiki:${item.shikimoriId}`
      : `${normalize(item.title)}:${item.year}:${item.type}`;

    const old = map.get(key);

    if (!old || item.score > old.score) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}

async function searchAnime(query) {
  const cacheKey = normalize(query);
  const cached = searchCache.get(cacheKey);

  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const queries = getSearchQueries(query);

  const responses = await Promise.allSettled(
    queries.map(q =>
      kodikGet('/search', {
        title: q,
        with_material_data: 'true',
        with_episodes: 'false',
        types: KODIK_TYPES
      })
    )
  );

  const raw = [];

  for (const response of responses) {
    if (response.status === 'fulfilled' && Array.isArray(response.value?.results)) {
      raw.push(...response.value.results);
    }
  }

  const mapped = raw
    .map(item => mapSearchItem(item, query))
    .filter(item => item.score > 0);

  const result = dedupe(mapped)
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);

  searchCache.set(cacheKey, {
    time: Date.now(),
    data: result
  });

  return result;
}

function buildIframe(link) {
  if (!link) return null;
  return String(link).startsWith('//') ? `https:${link}` : link;
}

function extractEpisodes(item) {
  const result = [];

  if (item?.episodes && typeof item.episodes === 'object') {
    for (const [num, data] of Object.entries(item.episodes)) {
      const iframeUrl = buildIframe(
        typeof data === 'string' ? data : data?.link || data?.url
      );

      if (!iframeUrl) continue;

      result.push({
        videoId: `${item.id || 'anime'}-${num}-${item?.translation?.id || 't'}`,
        number: Number(num) || 1,
        season: Number(item?.season) || 1,
        index: Number(num) || 1,
        iframeUrl,
        dubbing: item?.translation?.title || item?.translation?.name || '',
        player: item?.translation?.title || item?.translation?.name || '',
        playerId: item?.translation?.id || null,
        translationId: item?.translation?.id || null,
        translationTitle: item?.translation?.title || item?.translation?.name || ''
      });
    }
  }

  if (result.length) return result;

  const link = buildIframe(item?.link);
  if (link) {
    result.push({
      videoId: `${item.id || 'movie'}-1-${item?.translation?.id || 't'}`,
      number: 1,
      season: 1,
      index: 1,
      iframeUrl: link,
      dubbing: item?.translation?.title || item?.translation?.name || '',
      player: item?.translation?.title || item?.translation?.name || '',
      playerId: item?.translation?.id || null,
      translationId: item?.translation?.id || null,
      translationTitle: item?.translation?.title || item?.translation?.name || ''
    });
  }

  return result;
}

function mergeEpisodes(items) {
  const map = new Map();

  for (const item of items) {
    for (const ep of extractEpisodes(item)) {
      const key = `${ep.season}:${ep.number}:${ep.translationId || ep.translationTitle}`;
      if (!map.has(key)) map.set(key, ep);
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    return a.number - b.number;
  });
}

function filterByExactSelection(raw, selected = {}) {
  let candidates = [...raw];

  if (selected.shikimoriId) {
    const wanted = String(selected.shikimoriId);
    const filtered = candidates.filter(item => String(shikimoriIdOf(item) || '') === wanted);
    if (filtered.length) candidates = filtered;
  }

  if (selected.kodikId) {
    const wanted = String(selected.kodikId);
    const filtered = candidates.filter(item => String(item?.id || '') === wanted);
    if (filtered.length) candidates = filtered;
  }

  if (selected.materialId) {
    const wanted = String(selected.materialId);
    const filtered = candidates.filter(item => String(materialIdOf(item) || '') === wanted);
    if (filtered.length) candidates = filtered;
  }

  return candidates;
}

async function animeBySelection(selected = {}) {
  const requests = [];

  if (selected.shikimoriId) {
    requests.push(
      kodikGet('/search', {
        shikimori_id: selected.shikimoriId,
        with_material_data: 'true',
        with_episodes: 'true',
        types: KODIK_TYPES
      }),
      kodikGet('/list', {
        shikimori_id: selected.shikimoriId,
        with_material_data: 'true',
        with_episodes: 'true',
        types: KODIK_TYPES
      })
    );
  }

  if (selected.kodikId) {
    requests.push(
      kodikGet('/search', {
        id: selected.kodikId,
        with_material_data: 'true',
        with_episodes: 'true',
        types: KODIK_TYPES
      }),
      kodikGet('/list', {
        id: selected.kodikId,
        with_material_data: 'true',
        with_episodes: 'true',
        types: KODIK_TYPES
      })
    );
  }

  if (selected.title) {
    for (const q of getSearchQueries(selected.title)) {
      requests.push(
        kodikGet('/search', {
          title: q,
          with_material_data: 'true',
          with_episodes: 'true',
          types: KODIK_TYPES
        })
      );
    }
  }

  const responses = await Promise.allSettled(requests);
  const raw = [];

  for (const response of responses) {
    if (response.status === 'fulfilled' && Array.isArray(response.value?.results)) {
      raw.push(...response.value.results);
    }
  }

  if (!raw.length) return null;

  const candidates = filterByExactSelection(raw, selected);

  const sorted = candidates
    .map(item => ({
      item,
      score: getScore(item, selected.title || titleOf(item))
    }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);

  const first = sorted[0];
  const videos = mergeEpisodes(sorted);

  const shikimoriId = shikimoriIdOf(first);
  const kodikId = first?.id || null;
  const animeId = shikimoriId ? `shikimori:${shikimoriId}` : `kodik:${kodikId || 'unknown'}`;

  return {
    animeId,
    animeUrl: animeId,
    title: titleOf(first),
    description: first?.material_data?.description || first?.description || '',
    poster: posterOf(first),
    year: yearOf(first),
    type: typeOf(first),
    status: first?.material_data?.anime_status || first?.status || '',
    shikimoriId,
    episodes: videos.length || null,
    videos
  };
}

module.exports = {
  searchAnime,
  animeBySelection
};