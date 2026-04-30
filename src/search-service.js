const fs = require('fs');
const path = require('path');

const SEARCH_ALIASES_FILE = path.join(__dirname, '..', 'search-aliases.json');

/* ================= NORMALIZE ================= */

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[×х]/g, ' x ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ================= TRANSLIT ================= */

const RU_TO_LAT = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',
  й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',
  т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',
  ы:'y',э:'e',ю:'yu',я:'ya'
};

function translitRuToLat(str) {
  return normalize(str)
    .split('')
    .map(c => RU_TO_LAT[c] ?? c)
    .join('');
}

function translitLatToRu(str) {
  return normalize(str)
    .replace(/hunter/g, 'хантер')
    .replace(/naruto/g, 'наруто')
    .replace(/boruto/g, 'боруто')
    .replace(/x/g, ' х ')
    .replace(/sh/g, 'ш')
    .replace(/ch/g, 'ч')
    .replace(/ya/g, 'я')
    .replace(/yu/g, 'ю')
    .replace(/zh/g, 'ж');
}

/* ================= ALIASES ================= */

let ALIASES = {};

function loadAliases() {
  try {
    if (!fs.existsSync(SEARCH_ALIASES_FILE)) return {};

    const raw = fs.readFileSync(SEARCH_ALIASES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

ALIASES = loadAliases();

/* ================= EXPAND ================= */

function expandQuery(q) {
  const base = normalize(q);
  const set = new Set();

  if (!base) return [];

  set.add(base);
  set.add(base.replace(/\s+/g, ''));

  const lat = translitRuToLat(base);
  const ru = translitLatToRu(base);

  if (lat) {
    set.add(lat);
    set.add(lat.replace(/\s+/g, ''));
  }

  if (ru) {
    set.add(ru);
    set.add(ru.replace(/\s+/g, ''));
  }

  const alias = ALIASES[base];
  if (alias) {
    alias.forEach(a => set.add(normalize(a)));
  }

  return [...set].slice(0, 20);
}

/* ================= SCORE ================= */

function score(title, queries) {
  const t = normalize(title);
  let s = 0;

  for (const q of queries) {
    if (t === q) s += 10000;
    else if (t.startsWith(q)) s += 5000;
    else if (t.includes(q)) s += 2000;
  }

  return s;
}

/* ================= EXPORT ================= */

module.exports = {
  normalize,
  expandQuery,
  score
};