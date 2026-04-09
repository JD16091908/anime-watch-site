window.ANIME_CATALOG = [
  {
    id: 'shikimori:11061',
    title: 'Хантер х Хантер (2011)',
    originalTitle: 'Hunter x Hunter (2011)',
    poster: 'https://shikimori.one/system/animes/original/11061.jpg',
    aliases: [
      'хантер',
      'хантерхантер',
      'хантер х хантер',
      'хантер x хантер',
      'охотник',
      'охотник х охотник',
      'охотник x охотник',
      'hunter',
      'hunter x hunter',
      'hunter x hunter 2011'
    ]
  },
  {
    id: 'shikimori:136',
    title: 'Хантер х Хантер (1999)',
    originalTitle: 'Hunter x Hunter',
    poster: 'https://shikimori.one/system/animes/original/136.jpg',
    aliases: [
      'хантер',
      'хантерхантер',
      'хантер х хантер',
      'хантер x хантер',
      'охотник',
      'охотник х охотник',
      'охотник x охотник',
      'hunter',
      'hunter x hunter',
      'hunter x hunter 1999'
    ]
  },
  {
    id: 'naruto',
    title: 'Наруто',
    originalTitle: 'Naruto',
    seasons: [
      { id: 'naruto-classic', title: 'Наруто', code: 'naruto', episodes: 220 },
      { id: 'naruto-shippuden', title: 'Наруто: Ураганные хроники', code: 'naruto-shippuuden', episodes: 500 }
    ]
  },
  {
    id: 'bleach',
    title: 'Блич',
    originalTitle: 'Bleach',
    seasons: [
      { id: 'bleach-classic', title: 'Блич', code: 'bleach', episodes: 366 },
      { id: 'bleach-tybw', title: 'Блич: Тысячелетняя кровавая война', code: 'bleach-sennen-kessen-hen', episodes: 13 }
    ]
  },
  {
    id: 'attack-on-titan',
    title: 'Атака титанов',
    originalTitle: 'Shingeki no Kyojin',
    seasons: [
      { id: 'aot-s1', title: 'Атака титанов — Сезон 1', code: 'shingeki-no-kyojin', episodes: 25 },
      { id: 'aot-s2', title: 'Атака титанов — Сезон 2', code: 'shingeki-no-kyojin-2', episodes: 12 }
    ]
  }
];

window.ANIME_CATALOG_ALIASES = {
  'хантер': ['hunter x hunter', 'охотник x охотник', 'охотник х охотник', 'хантер х хантер', 'хантер x хантер'],
  'хантерхантер': ['hunter x hunter', 'охотник x охотник', 'охотник х охотник', 'хантер х хантер'],
  'охотник': ['hunter x hunter', 'хантер х хантер', 'хантер x хантер']
};

function normalizeCatalogQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[×х]/g, ' x ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCatalogQueryVariants(rawQuery) {
  const normalized = normalizeCatalogQuery(rawQuery);
  if (!normalized) return [];

  const variants = new Set();
  variants.add(normalized);
  variants.add(normalized.replace(/\s+/g, ''));

  const directAliases = window.ANIME_CATALOG_ALIASES[normalized] || [];
  directAliases.forEach((a) => {
    const n = normalizeCatalogQuery(a);
    if (!n) return;
    variants.add(n);
    variants.add(n.replace(/\s+/g, ''));
  });

  normalized.split(' ').filter(Boolean).forEach((token) => {
    const tokenAliases = window.ANIME_CATALOG_ALIASES[token] || [];
    tokenAliases.forEach((a) => {
      const n = normalizeCatalogQuery(a);
      if (!n) return;
      variants.add(n);
      variants.add(n.replace(/\s+/g, ''));
    });
  });

  return Array.from(variants);
}

function collectCatalogSearchTexts(item) {
  const result = [];
  result.push(item.title || '');
  result.push(item.originalTitle || '');

  (item.aliases || []).forEach((a) => result.push(a));
  (item.seasons || []).forEach((season) => result.push(season.title || ''));

  return result
    .map((t) => normalizeCatalogQuery(t))
    .filter(Boolean);
}

function scoreCatalogItem(item, variants) {
  const texts = collectCatalogSearchTexts(item);
  let score = 0;

  for (const text of texts) {
    for (const v of variants) {
      if (!v || !text) continue;

      if (text === v) score = Math.max(score, 1000);
      else if (text.startsWith(v)) score = Math.max(score, 700);
      else if (text.includes(v)) score = Math.max(score, 450);

      const textNoSpace = text.replace(/\s+/g, '');
      if (textNoSpace === v) score = Math.max(score, 900);
      else if (textNoSpace.includes(v)) score = Math.max(score, 500);
    }
  }

  return score;
}

window.searchAnimeCatalog = function searchAnimeCatalog(query) {
  const variants = getCatalogQueryVariants(query);
  if (!variants.length) return [];

  return window.ANIME_CATALOG
    .map((item) => ({ ...item, _score: scoreCatalogItem(item, variants) }))
    .filter((item) => item._score > 0)
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...item }) => item);
};