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

function isHunterFranchiseIntent(query) {
  const n = normalize(query);

  return (
    n === 'охотник' ||
    n === 'охотник охотник' ||
    n.includes('охотник x охотник') ||
    n.includes('hunter x hunter') ||
    n.includes('hunter hunter') ||
    n.includes('хантер')
  );
}

function isHunterFranchiseTitle(value) {
  const title = normalize(value);

  return (
    title.includes('hunter x hunter') ||
    title.includes('hunter hunter') ||
    title.includes('охотник x охотник') ||
    title.includes('охотник охотник') ||
    title.includes('хантер x хантер') ||
    title.includes('хантер хантер')
  );
}

function getSearchQueries(query) {
  const raw = String(query || '').trim();
  const n = normalize(raw);

  if (isHunterFranchiseIntent(n)) {
    return HUNTER_QUERIES;
  }

  return [...new Set([raw, n].filter(Boolean))];
}

async function kodikGet(endpoint, params = {}) {
  if (!KODIK_TOKEN) {
    throw new Error('KODIK_TOKEN is missing');
  }

  const query = new URLSearchParams({
    token: KODIK_TOKEN,
    limit: '100',
    ...params
  });

  const url = `${KODIK_API_BASE}${endpoint}?${query.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`Kodik HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Kodik returned invalid JSON: ${text.slice(0, 200)}`);
    }
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

  const value = String(poster).trim();

  if (value.startsWith('//')) {
    return `https:${value}`;
  }

  if (value.startsWith('http://')) {
    return value.replace(/^http:\/\//i, 'https://');
  }

  return value;
}

function yearOf(item) {
  return item?.year || item?.material_data?.year || '';
}

function typeOf(item) {
  return item?.type || item?.material_data?.type || item?.material_data?.anime_kind || '';
}

function statusOf(item) {
  return item?.material_data?.anime_status || item?.status || '';
}

function descriptionOf(item) {
  return item?.material_data?.description || item?.description || '';
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
  if (q.length >= 2 && title.includes(q)) score += 5000;

  if (isHunterFranchiseIntent(q)) {
    if (!isHunterFranchiseTitle(title)) {
      return -100000;
    }

    score += 25000;

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

    if (String(yearOf(item)) === '1999') score += 5000;
    if (String(yearOf(item)) === '2011') score += 4500;
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
    description: descriptionOf(item),
    poster: posterOf(item),
    status: statusOf(item),
    type: typeOf(item),
    shikimoriId,
    kodikId,
    materialId: materialIdOf(item),
    score,
    matchPriority: numericYear || 9999,
    releaseTs: numericYear || 9999
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
    .sort((a, b) => {
      const yearA = Number(a.year) || 9999;
      const yearB = Number(b.year) || 9999;

      if (yearA !== yearB) return yearA - yearB;
      if (b.score !== a.score) return b.score - a.score;

      return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
    })
    .slice(0, 80);

  searchCache.set(cacheKey, {
    time: Date.now(),
    data: result
  });

  return result;
}

function normalizeKodikLink(link) {
  const value = String(link || '').trim();

  if (!value) return null;

  if (value.startsWith('//')) {
    return `https:${value}`;
  }

  if (value.startsWith('http://')) {
    return value.replace(/^http:\/\//i, 'https://');
  }

  if (!value.startsWith('https://')) {
    return `https://${value.replace(/^\/+/, '')}`;
  }

  return value;
}

function getTranslationTitle(item) {
  return (
    item?.translation?.title ||
    item?.translation?.name ||
    item?.translation_title ||
    item?.translation_name ||
    'Озвучка'
  );
}

function getTranslationId(item) {
  return (
    item?.translation?.id ||
    item?.translation_id ||
    null
  );
}

function getSeasonNumberFromItem(item, fallback = 1) {
  const season =
    Number(item?.season) ||
    Number(item?.season_number) ||
    Number(item?.seasonNumber) ||
    fallback;

  return Number.isFinite(season) && season > 0 ? season : fallback;
}

function getBaseItemLink(item) {
  return normalizeKodikLink(
    item?.link ||
    item?.iframe_url ||
    item?.iframeUrl ||
    item?.url ||
    item?.player_link ||
    item?.playerLink
  );
}

function addEpisodeParams(link, seasonNumber, episodeNumber) {
  const safeLink = normalizeKodikLink(link);
  const safeSeasonNumber = Number(seasonNumber) || 1;
  const safeEpisodeNumber = Number(episodeNumber) || 1;

  if (!safeLink) return null;

  try {
    const url = new URL(safeLink);

    url.searchParams.set('season', String(safeSeasonNumber));
    url.searchParams.set('episode', String(safeEpisodeNumber));

    return url.toString();
  } catch {
    const separator = safeLink.includes('?') ? '&' : '?';

    return `${safeLink}${separator}season=${encodeURIComponent(String(safeSeasonNumber))}&episode=${encodeURIComponent(String(safeEpisodeNumber))}`;
  }
}

function extractEpisodeLink(data) {
  if (!data) return null;

  if (typeof data === 'string') {
    return normalizeKodikLink(data);
  }

  if (typeof data !== 'object') {
    return null;
  }

  return normalizeKodikLink(
    data.link ||
    data.url ||
    data.iframe_url ||
    data.iframeUrl ||
    data.src ||
    data.player_link ||
    data.playerLink
  );
}

function getPreferredEpisodeLink(item, episodeData, seasonNumber, episodeNumber) {
  const baseLink = getBaseItemLink(item);
  const episodeLink = extractEpisodeLink(episodeData);

  if (baseLink) {
    return addEpisodeParams(baseLink, seasonNumber, episodeNumber);
  }

  if (episodeLink) {
    return addEpisodeParams(episodeLink, seasonNumber, episodeNumber);
  }

  return null;
}

function buildEpisode({
  item,
  seasonNumber,
  episodeNumber,
  iframeUrl
}) {
  const translationTitle = getTranslationTitle(item);
  const translationId = getTranslationId(item);

  return {
    videoId: `${item?.id || 'anime'}-${seasonNumber}-${episodeNumber}-${translationId || translationTitle || 't'}`,
    number: episodeNumber,
    season: seasonNumber,
    index: episodeNumber,
    iframeUrl: normalizeKodikLink(iframeUrl),
    dubbing: translationTitle,
    player: translationTitle,
    playerId: translationId,
    translationId,
    translationTitle
  };
}

function extractEpisodesFromEpisodesObject(item) {
  const result = [];
  const episodes = item?.episodes;

  if (!episodes || typeof episodes !== 'object' || Array.isArray(episodes)) {
    return result;
  }

  const seasonNumber = getSeasonNumberFromItem(item, 1);

  for (const [episodeKey, episodeData] of Object.entries(episodes)) {
    const episodeNumber =
      Number(episodeKey) ||
      Number(episodeData?.episode) ||
      Number(episodeData?.number) ||
      Number(episodeData?.episode_number) ||
      1;

    const iframeUrl = getPreferredEpisodeLink(item, episodeData, seasonNumber, episodeNumber);

    if (!iframeUrl) continue;

    result.push(buildEpisode({
      item,
      seasonNumber,
      episodeNumber,
      iframeUrl
    }));
  }

  return result;
}

function extractEpisodesFromSeasonsObject(item) {
  const result = [];
  const seasons = item?.seasons;

  if (!seasons || typeof seasons !== 'object' || Array.isArray(seasons)) {
    return result;
  }

  for (const [seasonKey, seasonData] of Object.entries(seasons)) {
    const seasonNumber =
      Number(seasonKey) ||
      Number(seasonData?.season) ||
      Number(seasonData?.number) ||
      1;

    const episodes = seasonData?.episodes && typeof seasonData.episodes === 'object'
      ? seasonData.episodes
      : seasonData;

    if (!episodes || typeof episodes !== 'object' || Array.isArray(episodes)) {
      continue;
    }

    for (const [episodeKey, episodeData] of Object.entries(episodes)) {
      if (
        episodeKey === 'id' ||
        episodeKey === 'link' ||
        episodeKey === 'url' ||
        episodeKey === 'title' ||
        episodeKey === 'season' ||
        episodeKey === 'episodes'
      ) {
        continue;
      }

      const episodeNumber =
        Number(episodeKey) ||
        Number(episodeData?.episode) ||
        Number(episodeData?.number) ||
        Number(episodeData?.episode_number) ||
        1;

      const iframeUrl = getPreferredEpisodeLink(item, episodeData, seasonNumber, episodeNumber);

      if (!iframeUrl) continue;

      result.push(buildEpisode({
        item,
        seasonNumber,
        episodeNumber,
        iframeUrl
      }));
    }
  }

  return result;
}

function extractSingleVideo(item) {
  const link = getBaseItemLink(item);

  if (!link) return [];

  return [
    buildEpisode({
      item,
      seasonNumber: getSeasonNumberFromItem(item, 1),
      episodeNumber: 1,
      iframeUrl: addEpisodeParams(link, getSeasonNumberFromItem(item, 1), 1) || link
    })
  ];
}

function extractEpisodes(item) {
  const fromSeasons = extractEpisodesFromSeasonsObject(item);
  if (fromSeasons.length) return fromSeasons;

  const fromEpisodes = extractEpisodesFromEpisodesObject(item);
  if (fromEpisodes.length) return fromEpisodes;

  return extractSingleVideo(item);
}

function mergeEpisodes(items) {
  const map = new Map();

  for (const item of items) {
    const episodes = extractEpisodes(item);

    for (const ep of episodes) {
      if (!ep?.iframeUrl) continue;

      const key = [
        ep.season,
        ep.number,
        ep.translationId || ep.translationTitle || ep.player || 'unknown'
      ].join(':');

      if (!map.has(key)) {
        map.set(key, ep);
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;

    if (String(a.player || '') !== String(b.player || '')) {
      return String(a.player || '').localeCompare(String(b.player || ''), 'ru');
    }

    return a.number - b.number;
  });
}

function filterByExactSelection(raw, selected = {}) {
  let candidates = [...raw];

  if (selected.shikimoriId) {
    const wanted = String(selected.shikimoriId);
    const filtered = candidates.filter(item => String(shikimoriIdOf(item) || '') === wanted);

    if (filtered.length) {
      return filtered;
    }
  }

  if (selected.materialId) {
    const wanted = String(selected.materialId);
    const filtered = candidates.filter(item => String(materialIdOf(item) || '') === wanted);

    if (filtered.length) {
      return filtered;
    }
  }

  if (selected.kodikId) {
    const wanted = String(selected.kodikId);
    const filtered = candidates.filter(item => String(item?.id || '') === wanted);

    if (filtered.length) {
      return filtered;
    }
  }

  return candidates;
}

function dedupeRawItems(items) {
  const map = new Map();

  for (const item of items) {
    const key = [
      item?.id || '',
      shikimoriIdOf(item) || '',
      materialIdOf(item) || '',
      getTranslationId(item) || getTranslationTitle(item) || '',
      getBaseItemLink(item) || ''
    ].join(':');

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return [...map.values()];
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

  if (selected.kodikId && !selected.shikimoriId) {
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
        }),
        kodikGet('/list', {
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

  const candidates = filterByExactSelection(dedupeRawItems(raw), selected);

  const sorted = candidates
    .map(item => ({
      item,
      score: getScore(item, selected.title || titleOf(item))
    }))
    .filter(x => x.score > -100000)
    .sort((a, b) => {
      const yearA = Number(yearOf(a.item)) || 9999;
      const yearB = Number(yearOf(b.item)) || 9999;

      if (yearA !== yearB) return yearA - yearB;
      return b.score - a.score;
    })
    .map(x => x.item);

  const first = sorted[0] || candidates[0];
  const videos = mergeEpisodes(sorted.length ? sorted : candidates);

  const shikimoriId = shikimoriIdOf(first);
  const kodikId = first?.id || null;
  const animeId = shikimoriId ? `shikimori:${shikimoriId}` : `kodik:${kodikId || 'unknown'}`;

  return {
    animeId,
    animeUrl: animeId,
    title: titleOf(first),
    description: descriptionOf(first),
    poster: posterOf(first),
    year: yearOf(first),
    type: typeOf(first),
    status: statusOf(first),
    shikimoriId,
    kodikId,
    episodes: videos.length || null,
    videos
  };
}

module.exports = {
  searchAnime,
  animeBySelection
};