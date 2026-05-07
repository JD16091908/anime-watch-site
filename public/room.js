const socket = io();

const CONFIG = window.AnivmesteConfig || {};
const SUPPORT_CONFIG = CONFIG.support || {};
const BOOSTY_URL = SUPPORT_CONFIG.boostyUrl || '#';
const DONATIONALERTS_URL = SUPPORT_CONFIG.donationAlertsUrl || '#';

if (window.location.pathname === '/room.html') {
  window.location.replace('/');
}

const params = new URLSearchParams(window.location.search);
const roomId = decodeURIComponent(window.location.pathname.split('/room/')[1] || '');

const SEARCH_ENDPOINTS = ['/api/kodik/search', '/api/yummy/search'];
const SELECT_ENDPOINTS = ['/api/kodik/anime/by-selection', '/api/yummy/anime/by-selection'];

const SYNC_TOLERANCE_SEC = 1.35;
const SYNC_HARD_SEEK_SEC = 4.5;
const SYNC_DRIFT_INTERVAL = 1500;
const SYNC_SEEK_COOLDOWN = 1400;
const HOST_BROADCAST_INTERVAL = 700;
const USER_TIME_INTERVAL = 1000;
const USER_TIME_STALE_MS = 15000;
const RESYNC_AFTER_IFRAME_MS = 1200;
const REQUEST_SYNC_INTERVAL = 7000;

const USER_KEY_STORAGE = 'anivmeste_user_key';
const USERNAME_STORAGE = 'username';
const MANUAL_USERNAME_STORAGE = 'saved_username_manual';

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_CLIENT_CACHE_TTL_MS = 3 * 60 * 1000;
const SEARCH_CLIENT_CACHE_MAX = 70;

const RANDOM_NICK_ADJECTIVES = [
  'Swift', 'Silent', 'Crimson', 'Silver', 'Golden', 'Shadow', 'Lunar', 'Solar', 'Misty', 'Stormy',
  'Frozen', 'Burning', 'Shining', 'Dark', 'Bright', 'Wild', 'Calm', 'Rapid', 'Lucky', 'Cosmic',
  'Electric', 'Ancient', 'Hidden', 'Secret', 'Fierce', 'Gentle', 'Brave', 'Noble', 'Clever', 'Crazy',
  'Dreamy', 'Ghostly', 'Royal', 'Tiny', 'Mega', 'Hyper', 'Epic', 'Magic', 'Cyber', 'Neon',
  'Velvet', 'Iron', 'Crystal', 'Phantom', 'Thunder', 'Ashen', 'Scarlet', 'Emerald', 'Ivory', 'Obsidian',
  'Azure', 'Ruby', 'Sapphire', 'Amber', 'Pearl', 'Snowy', 'Windy', 'Dizzy', 'Mellow', 'Glowing',
  'Stealthy', 'Vivid', 'Arcane', 'Quantum', 'Pixel', 'Turbo', 'Nova', 'Stellar', 'Void', 'Night',
  'Dawn', 'Dusk', 'Blazing', 'Chill', 'Savage', 'Elegant', 'Fearless', 'Wicked', 'Radiant', 'Hollow'
];

const RANDOM_NICK_NOUNS = [
  'Fox', 'Wolf', 'Tiger', 'Dragon', 'Phoenix', 'Raven', 'Falcon', 'Hawk', 'Panda', 'Rabbit',
  'Samurai', 'Ninja', 'Ronin', 'Knight', 'Wizard', 'Mage', 'Hunter', 'Rider', 'Pirate', 'Guardian',
  'Otter', 'Bear', 'Eagle', 'Shark', 'Panther', 'Lynx', 'Crow', 'Viper', 'Leopard', 'Cobra',
  'Kitsune', 'Tanuki', 'Yokai', 'Spirit', 'Ghost', 'Demon', 'Angel', 'Comet', 'Meteor', 'Star',
  'Moon', 'Blade', 'Arrow', 'Storm', 'Flame', 'Frost', 'Thunder', 'Shadow', 'Spark', 'Stone',
  'Echo', 'Whisper', 'Glitch', 'Pixel', 'Byte', 'Cipher', 'Nova', 'Orbit', 'Voyager', 'Drifter',
  'Wanderer', 'Sage', 'Monk', 'Brawler', 'Sniper', 'Scout', 'Captain', 'King', 'Queen', 'Prince',
  'Princess', 'Beast', 'Slayer', 'Seeker', 'Walker', 'Chaser', 'Nomad', 'Reaper', 'Sentinel', 'Alchemist'
];

const clientSearchCache = new Map();

let username = resolveInitialUsername();
let isHost = false;
let selectedAnime = null;
let selectedPlayer = null;
let selectedSeason = null;
let latestSearchToken = 0;
let pendingPlaybackApply = null;
let userInteractedWithPlayer = false;
let hostTimeBroadcastTimer = null;
let userTimeBroadcastTimer = null;
let driftCheckTimer = null;
let requestSyncTimer = null;
let hasShownHostMessage = false;
let lastKnownHostTime = null;
let lastKnownHostTimeAt = 0;
let lastAppliedTargetTime = null;
let lastAppliedAt = 0;
let lastForcedSyncAt = 0;
let firstEpisodeHintAnimeId = null;
let audioContext = null;
let latestRoomUsers = [];
let usersRenderTicker = null;
let showAllSearchResults = false;
let lastSearchResults = [];
let lastSearchQueryNormalized = '';
let activeSearchAbortController = null;
let lastRenderedSearchSignature = '';
let lastUserTimeEmitAtClient = 0;
let currentLoadedEmbedUrl = null;
let roomSupportCloseTimer = null;
let isUsersPanelOpen = false;

const userKey = getOrCreateUserKey();

let currentState = {
  animeId: null,
  animeUrl: null,
  episodeNumber: null,
  embedUrl: null,
  title: null,
  duration: 0,
  playback: {
    paused: true,
    currentTime: null,
    updatedAt: 0
  }
};

const hostBadge = document.getElementById('hostBadge');
const usersList = document.getElementById('usersList');
const animeList = document.getElementById('animeList');
const searchInput = document.getElementById('searchInput');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const cinemaModeBtn = document.getElementById('cinemaModeBtn');
const supportRoomBtn = document.getElementById('supportRoomBtn');
const roomPage = document.getElementById('roomPage');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const searchStatus = document.getElementById('searchStatus');
const selectedAnimeInfo = document.getElementById('selectedAnimeInfo');
const hostSearchHint = document.getElementById('hostSearchHint');
const nicknameInput = document.getElementById('nicknameInput');
const saveNicknameBtn = document.getElementById('saveNicknameBtn');
const toggleUsersPanelBtn = document.getElementById('toggleUsersPanelBtn');
const usersDropdownPanel = document.getElementById('usersDropdownPanel');

const roomSupportModal = document.getElementById('roomSupportModal');
const roomSupportModalBackdrop = document.getElementById('roomSupportModalBackdrop');
const closeRoomSupportModalBtn = document.getElementById('closeRoomSupportModalBtn');
const roomSupportDescription = document.getElementById('roomSupportDescription');
const roomSupportThanks = document.getElementById('roomSupportThanks');
const roomSupportBoostyLink = document.getElementById('roomSupportBoostyLink');
const roomSupportDonationAlertsLink = document.getElementById('roomSupportDonationAlertsLink');

function updateRoomDocumentMeta(currentRoomId) {
  const title = currentRoomId === 'solo' ? 'Одиночный просмотр' : 'Комната просмотра';
  document.title = `${title} — Anivmeste`;

  const roomTitleEl = document.getElementById('roomTitle');
  if (roomTitleEl) roomTitleEl.textContent = title;
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function sanitizeUsername(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 30);
}

function normalizeSearchQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[×✕]/g, ' x ')
    .replace(/(^|[^\p{L}\p{N}])([xх])(?=$|[^\p{L}\p{N}])/giu, '$1 x')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ');
}

function pickRandomItem(items) {
  if (!Array.isArray(items) || !items.length) return null;
  return items[Math.floor(Math.random() * items.length)] || null;
}

function generateRandomNickname() {
  const adjective = pickRandomItem(RANDOM_NICK_ADJECTIVES) || 'Guest';
  const noun = pickRandomItem(RANDOM_NICK_NOUNS) || 'User';
  return `${adjective} ${noun}`.slice(0, 30);
}

function resolveInitialUsername() {
  const usernameFromQuery = sanitizeUsername(params.get('username'));
  const savedUsername = sanitizeUsername(safeLocalStorageGet(USERNAME_STORAGE));
  const hasManualUsername = safeLocalStorageGet(MANUAL_USERNAME_STORAGE) === '1';

  if (usernameFromQuery) {
    safeLocalStorageSet(USERNAME_STORAGE, usernameFromQuery);
    safeLocalStorageSet(MANUAL_USERNAME_STORAGE, '1');
    return usernameFromQuery;
  }

  if (hasManualUsername && savedUsername) return savedUsername;

  const randomUsername = generateRandomNickname();
  safeLocalStorageSet(USERNAME_STORAGE, randomUsername);
  safeLocalStorageSet(MANUAL_USERNAME_STORAGE, '0');
  return randomUsername;
}

function getOrCreateUserKey() {
  let key = safeLocalStorageGet(USER_KEY_STORAGE);

  if (!key) {
    key = `uk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    safeLocalStorageSet(USER_KEY_STORAGE, key);
  }

  return key;
}

function ensureAudioContext() {
  if (audioContext) return audioContext;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  audioContext = new AudioCtx();
  return audioContext;
}

function unlockAudioContext() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function playChatSound() {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    const gain2 = ctx.createGain();
    const masterGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(1320, now);
    osc1.frequency.exponentialRampToValueAtTime(1760, now + 0.045);
    osc2.frequency.setValueAtTime(990, now);
    osc2.frequency.exponentialRampToValueAtTime(1320, now + 0.05);

    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.018, now + 0.006);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    gain2.gain.setValueAtTime(0.0001, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.006);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, now);
    filter.Q.setValueAtTime(0.6, now);
    masterGain.gain.setValueAtTime(0.9, now);

    osc1.connect(gain1);
    osc2.connect(gain2);
    gain1.connect(filter);
    gain2.connect(filter);
    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.085);
    osc2.stop(now + 0.085);
  } catch (error) {
    console.warn('Не удалось воспроизвести звук чата:', error);
  }
}

function openRoomSupportModal(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!roomSupportModal) return;

  if (roomSupportCloseTimer) {
    clearTimeout(roomSupportCloseTimer);
    roomSupportCloseTimer = null;
  }

  roomSupportModal.style.setProperty('display', 'flex', 'important');
  roomSupportModal.classList.remove('hidden', 'is-hiding');
  roomSupportModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  requestAnimationFrame(() => {
    roomSupportModal.classList.add('is-visible');
  });
}

function closeRoomSupportModal(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!roomSupportModal) return;

  if (roomSupportCloseTimer) {
    clearTimeout(roomSupportCloseTimer);
    roomSupportCloseTimer = null;
  }

  roomSupportModal.classList.remove('is-visible');
  roomSupportModal.classList.add('is-hiding');
  roomSupportModal.setAttribute('aria-hidden', 'true');

  roomSupportCloseTimer = setTimeout(() => {
    roomSupportModal.classList.add('hidden');
    roomSupportModal.classList.remove('is-hiding');
    roomSupportModal.style.setProperty('display', 'none', 'important');
    document.body.classList.remove('modal-open');
    roomSupportCloseTimer = null;
  }, 240);
}

function canControl() {
  return roomId === 'solo' || isHost;
}

function getMoscowTimeString() {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

function sys(text) {
  if (!text) return;

  if (chatMessages && window.ChatModule) {
    window.ChatModule.appendSystemMessage(chatMessages, text);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function readJsonSafely(response) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!contentType.includes('application/json')) {
    throw new Error(`Сервер вернул не JSON. HTTP ${response.status}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Сервер вернул битый JSON');
  }
}

async function fetchJsonFallback(endpoints, options = {}) {
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, options);
      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(data?.code || data?.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Сервис временно недоступен');
}

function formatWatchTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getEffectivePlaybackTime(playback = currentState.playback) {
  const safe = playback || {};
  const base = typeof safe.currentTime === 'number' && !Number.isNaN(safe.currentTime)
    ? safe.currentTime
    : null;

  if (base === null) return null;
  if (safe.paused) return base;

  const updatedAt = Number(safe.updatedAt || Date.now()) || Date.now();
  const elapsed = Math.max(0, (Date.now() - updatedAt) / 1000);

  return base + elapsed;
}

function getPlayerActualTimeFallback() {
  if (window.PlayerModule && typeof window.PlayerModule.getCurrentTime === 'function') {
    const playerTime = Number(window.PlayerModule.getCurrentTime());
    if (Number.isFinite(playerTime) && playerTime >= 0) return playerTime;
  }

  return getEffectivePlaybackTime(currentState.playback);
}

function getPlayerName(video) {
  return String(video?.player || video?.dubbing || 'unknown').trim();
}

function getEpisodeNumber(video) {
  return Number(video?.number) || Number(video?.index) || 0;
}

function getSeasonNumber(video) {
  const season = Number(video?.season);
  return season > 0 ? season : 1;
}

function getIframeUrl(video) {
  return video?.iframeUrl || video?.iframe_url || null;
}

function getUniquePlayers(videos) {
  const map = new Map();

  for (const video of videos || []) {
    const iframeUrl = getIframeUrl(video);
    if (!iframeUrl) continue;

    const name = getPlayerName(video);
    if (!map.has(name)) {
      map.set(name, {
        name,
        episodeNumbers: new Set()
      });
    }

    const epNum = getEpisodeNumber(video);
    if (epNum > 0) map.get(name).episodeNumbers.add(epNum);
  }

  return [...map.values()]
    .map((player) => ({
      name: player.name,
      count: player.episodeNumbers.size || 1
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'ru');
    });
}

function getUniqueSeasons(videos) {
  const map = new Map();

  for (const video of videos || []) {
    const season = getSeasonNumber(video);

    if (!map.has(season)) {
      map.set(season, {
        season,
        count: 1
      });
    } else {
      map.get(season).count += 1;
    }
  }

  return [...map.values()].sort((a, b) => a.season - b.season);
}

function getUniqueEpisodes(videos) {
  const map = new Map();

  for (const video of videos || []) {
    const ep = getEpisodeNumber(video);
    const url = getIframeUrl(video);

    if (!ep || !url) continue;
    if (!map.has(ep)) map.set(ep, { ...video, episodeNumber: ep });
  }

  return [...map.values()].sort((a, b) => a.episodeNumber - b.episodeNumber);
}

function findDefaultContext(videos) {
  const players = getUniquePlayers(videos);
  if (!players.length) return null;

  const player = players[0].name;
  const byPlayer = (videos || []).filter((video) => getPlayerName(video) === player && !!getIframeUrl(video));
  const seasons = getUniqueSeasons(byPlayer);
  const season = seasons[0]?.season || 1;
  const bySeason = byPlayer.filter((video) => getSeasonNumber(video) === season);
  const episodes = getUniqueEpisodes(bySeason);
  const episode = episodes[0] || null;

  if (!episode) return null;

  return {
    player,
    season,
    episode
  };
}

function getInterpolatedHostTime() {
  if (lastKnownHostTime === null) return null;
  if (currentState.playback.paused) return lastKnownHostTime;

  const elapsed = (Date.now() - lastKnownHostTimeAt) / 1000;
  return lastKnownHostTime + elapsed;
}

function normalizePlaybackFromServer(playback) {
  if (!playback) return null;

  const safeTime = typeof playback.currentTime === 'number' && !Number.isNaN(playback.currentTime)
    ? playback.currentTime
    : null;

  return {
    paused: !!playback.paused,
    currentTime: safeTime,
    updatedAt: Number(playback.updatedAt || Date.now()) || Date.now()
  };
}

function applyPlaybackState(playback, { force = false, reason = 'sync' } = {}) {
  if (!window.PlayerModule || !playback) return;

  const normalized = normalizePlaybackFromServer(playback);
  if (!normalized) return;

  const now = Date.now();
  let targetTime = normalized.currentTime;

  if (targetTime !== null && !normalized.paused && normalized.updatedAt) {
    const networkDelay = Math.max(0, (now - normalized.updatedAt) / 1000);
    targetTime += networkDelay;
  }

  if (targetTime !== null) {
    const actualTime = getPlayerActualTimeFallback();
    const actualDrift = typeof actualTime === 'number' ? Math.abs(actualTime - targetTime) : Infinity;
    const timeSinceLastApply = now - lastAppliedAt;
    const targetDrift = Math.abs((lastAppliedTargetTime ?? -999) - targetTime);

    const shouldSeek =
      force ||
      actualDrift >= SYNC_HARD_SEEK_SEC ||
      (actualDrift >= SYNC_TOLERANCE_SEC && timeSinceLastApply > SYNC_SEEK_COOLDOWN) ||
      (targetDrift > SYNC_TOLERANCE_SEC && timeSinceLastApply > SYNC_SEEK_COOLDOWN);

    if (shouldSeek) {
      try {
        window.PlayerModule.seekTo(targetTime);
      } catch {}

      lastAppliedTargetTime = targetTime;
      lastAppliedAt = now;
    }
  }

  if (normalized.paused) {
    try {
      window.PlayerModule.pause();
    } catch {}
  } else {
    try {
      window.PlayerModule.play();
    } catch {}
  }

  if (reason !== 'local') {
    currentState.playback = {
      paused: normalized.paused,
      currentTime: targetTime !== null ? targetTime : normalized.currentTime,
      updatedAt: Date.now()
    };
  }
}

function checkDrift() {
  if (isHost || roomId === 'solo') return;
  if (!currentState.embedUrl) return;
  if (currentState.playback.paused) return;

  const hostTime = getInterpolatedHostTime();
  if (hostTime === null) return;

  const myTime = getPlayerActualTimeFallback();
  if (typeof myTime !== 'number' || Number.isNaN(myTime)) return;

  const drift = Math.abs(myTime - hostTime);
  const now = Date.now();

  if (drift > SYNC_HARD_SEEK_SEC && now - lastForcedSyncAt > SYNC_SEEK_COOLDOWN) {
    try {
      window.PlayerModule.seekTo(hostTime);
      window.PlayerModule.play();
    } catch {}

    lastAppliedTargetTime = hostTime;
    lastAppliedAt = now;
    lastForcedSyncAt = now;
    return;
  }

  if (drift > SYNC_TOLERANCE_SEC && now - lastForcedSyncAt > SYNC_SEEK_COOLDOWN) {
    try {
      window.PlayerModule.seekTo(hostTime);
    } catch {}

    lastAppliedTargetTime = hostTime;
    lastAppliedAt = now;
    lastForcedSyncAt = now;
  }
}

function startDriftCheck() {
  stopDriftCheck();

  if (roomId === 'solo' || isHost) return;
  driftCheckTimer = setInterval(checkDrift, SYNC_DRIFT_INTERVAL);
}

function stopDriftCheck() {
  if (!driftCheckTimer) return;

  clearInterval(driftCheckTimer);
  driftCheckTimer = null;
}

function startRequestSyncTimer() {
  stopRequestSyncTimer();

  if (roomId === 'solo') return;

  requestSyncTimer = setInterval(() => {
    if (!socket.connected) return;
    if (isHost) return;
    socket.emit('request-sync', { roomId });
  }, REQUEST_SYNC_INTERVAL);
}

function stopRequestSyncTimer() {
  if (!requestSyncTimer) return;

  clearInterval(requestSyncTimer);
  requestSyncTimer = null;
}

function updateLocalPlaybackTimeFromPlayer() {
  const ct = getPlayerActualTimeFallback();

  if (typeof ct !== 'number' || Number.isNaN(ct) || ct < 0) {
    return null;
  }

  currentState.playback.currentTime = ct;
  currentState.playback.updatedAt = Date.now();

  return ct;
}

function emitCurrentUserTime({ force = false } = {}) {
  if (roomId === 'solo' || !currentState.embedUrl) return;

  const now = Date.now();

  if (!force && now - lastUserTimeEmitAtClient < 450) return;
  lastUserTimeEmitAtClient = now;

  const ct = updateLocalPlaybackTimeFromPlayer();

  if (typeof ct === 'number' && ct >= 0) {
    socket.emit('update-user-time', {
      roomId,
      currentTime: ct,
      paused: !!currentState.playback.paused
    });
  }
}

function startHostTimers() {
  stopHostTimers();

  if (!isHost || roomId === 'solo') return;

  hostTimeBroadcastTimer = setInterval(() => {
    if (!isHost || roomId === 'solo' || !currentState.embedUrl) return;

    const ct = updateLocalPlaybackTimeFromPlayer();

    if (typeof ct === 'number' && ct >= 0) {
      socket.emit('player-control', {
        roomId,
        action: 'timeupdate',
        currentTime: ct
      });

      emitCurrentUserTime({ force: true });
    }
  }, HOST_BROADCAST_INTERVAL);
}

function stopHostTimers() {
  if (!hostTimeBroadcastTimer) return;

  clearInterval(hostTimeBroadcastTimer);
  hostTimeBroadcastTimer = null;
}

function startUserTimeTimer() {
  stopUserTimeTimer();

  if (roomId === 'solo') return;

  emitCurrentUserTime({ force: true });

  userTimeBroadcastTimer = setInterval(() => {
    emitCurrentUserTime();
  }, USER_TIME_INTERVAL);
}

function stopUserTimeTimer() {
  if (!userTimeBroadcastTimer) return;

  clearInterval(userTimeBroadcastTimer);
  userTimeBroadcastTimer = null;
}

function updateControlState() {
  const disabled = !canControl();

  if (searchInput) {
    searchInput.disabled = disabled;
    searchInput.placeholder = disabled
      ? 'Только хост может искать аниме'
      : 'Введите название аниме...';
  }

  if (hostSearchHint) {
    hostSearchHint.textContent = disabled
      ? 'Искать и выбирать тайтл может только хост комнаты'
      : 'Вы можете искать тайтлы и запускать плеер для всей комнаты';
  }

  if (hostBadge) {
    hostBadge.textContent = canControl() ? '👑 Хост' : '👀 Зритель';
  }

  animeList?.querySelectorAll('button').forEach((button) => {
    button.disabled = disabled;
  });
}

function updateSelectedAnimeInfoContent(anime = null) {
  if (!selectedAnimeInfo) return;

  if (!anime) {
    selectedAnimeInfo.innerHTML = `
      <div class="empty-selected-anime">
        <p>Пока ничего не выбрано</p>
        <p class="small-note">Начните поиск аниме в поле выше.</p>
      </div>
    `;
    return;
  }

  const players = getUniquePlayers(anime?.videos || []);
  const seasons = getUniqueSeasons(anime?.videos || []);
  const episodes = getUniqueEpisodes(anime?.videos || []);
  const descriptionContent = anime.description
    ? `<p class="selected-anime-description">${escapeHtml(anime.description)}</p>`
    : '';

  selectedAnimeInfo.innerHTML = `
    <div class="selected-anime-layout">
      ${anime.poster ? `<img class="selected-anime-poster" src="${escapeHtml(anime.poster)}" loading="lazy" alt="${escapeHtml(anime.title)}">` : ''}
      <div class="selected-anime-body">
        <h3 class="selected-anime-title">${escapeHtml(anime.title)}</h3>
        <div class="selected-anime-meta">
          ${anime.year ? escapeHtml(String(anime.year)) : ''}${anime.type ? ` • ${escapeHtml(anime.type)}` : ''}${anime.status ? ` • ${escapeHtml(anime.status)}` : ''}
        </div>
        ${descriptionContent}
        <div class="selected-anime-extra">Озвучек: ${players.length} • Сезонов: ${seasons.length} • Серий: ${episodes.length}</div>
      </div>
    </div>
  `;
}

function showPlaceholderUi(title = 'Ничего не выбрано', description = 'Выберите аниме') {
  const playerWrapper = document.getElementById('playerWrapper');
  if (!playerWrapper || !window.PlayerModule) return;

  currentLoadedEmbedUrl = null;
  window.PlayerModule.showPlaceholder(playerWrapper, {
    title,
    description
  });
}

function showBlockedAnimeMessage(message = 'Данное аниме запрещено на территории вашей страны') {
  selectedAnime = null;
  selectedPlayer = null;
  selectedSeason = null;
  currentLoadedEmbedUrl = null;

  currentState = {
    animeId: null,
    animeUrl: null,
    episodeNumber: null,
    embedUrl: null,
    title: null,
    duration: 0,
    playback: {
      paused: true,
      currentTime: 0,
      updatedAt: Date.now()
    }
  };

  updateSelectedAnimeInfoContent(null);
  showPlaceholderUi('Просмотр недоступен', message);
}

function showViewerHint(text = 'Если видео не стартовало автоматически, кликните по плееру один раз.') {
  if (isHost || roomId === 'solo') return;
  sys(text);
}

function hideViewerHintOverlay() {
  const playerWrapper = document.getElementById('playerWrapper');
  if (!playerWrapper) return;

  const placeholderEl = playerWrapper.querySelector('.placeholder');
  if (!placeholderEl) return;
  if (!placeholderEl.classList.contains('placeholder-click-through')) return;

  placeholderEl.style.display = 'none';
}

function showFirstEpisodeHintForHost() {
  if (!isHost || roomId === 'solo') return;

  const animeId = currentState.animeId || currentState.animeUrl || currentState.title || 'unknown';

  if (firstEpisodeHintAnimeId === animeId) return;

  firstEpisodeHintAnimeId = animeId;
  sys('После загрузки первой серии при необходимости кликните по плееру один раз и нажмите play.');
}

function setUsersPanelOpen(nextOpen) {
  if (!usersDropdownPanel || !toggleUsersPanelBtn) return;

  isUsersPanelOpen = !!nextOpen;
  usersDropdownPanel.classList.toggle('is-open', isUsersPanelOpen);
  toggleUsersPanelBtn.setAttribute('aria-expanded', String(isUsersPanelOpen));
}

let bridge = {
  playerType: 'unknown',
  iframeWindow: null
};

function resetBridge() {
  bridge = {
    playerType: 'unknown',
    iframeWindow: null
  };
}

function loadIframe(embedUrl) {
  const playerWrapper = document.getElementById('playerWrapper');
  if (!playerWrapper || !window.PlayerModule) return;

  if (!embedUrl) {
    currentLoadedEmbedUrl = null;
    showPlaceholderUi('Серия не запущена', 'У выбранного тайтла отсутствует iframe');
    return;
  }

  stopHostTimers();
  stopUserTimeTimer();
  stopDriftCheck();
  resetBridge();

  lastKnownHostTime = null;
  lastKnownHostTimeAt = 0;
  lastAppliedTargetTime = null;
  lastAppliedAt = 0;
  lastForcedSyncAt = 0;
  lastUserTimeEmitAtClient = 0;

  window.PlayerModule.mountIframe(playerWrapper, {
    src: embedUrl,
    title: currentState.title
  });

  currentLoadedEmbedUrl = embedUrl;

  bridge.playerType = typeof window.PlayerModule.detectPlayerType === 'function'
    ? window.PlayerModule.detectPlayerType(embedUrl)
    : 'unknown';

  if (!isHost && roomId !== 'solo') {
    setTimeout(() => {
      try {
        window.PlayerModule.pause();
      } catch {}
    }, 200);
  }

  startUserTimeTimer();

  if (isHost) {
    startHostTimers();
    showFirstEpisodeHintForHost();
  } else if (roomId !== 'solo') {
    startDriftCheck();
  }

  if (!isHost && roomId !== 'solo') {
    setTimeout(() => {
      if (!userInteractedWithPlayer) {
        showViewerHint('Если серия не стартовала, нажмите по плееру один раз.');
      }
    }, 800);

    setTimeout(() => {
      socket.emit('request-sync', { roomId });
    }, RESYNC_AFTER_IFRAME_MS);
  }
}

function launchEpisode(episode, anime) {
  if (!episode) return;

  const embedUrl = getIframeUrl(episode);
  const season = getSeasonNumber(episode);
  const episodeNumber = getEpisodeNumber(episode);
  const playerName = getPlayerName(episode);
  const title = `${anime?.title || 'Аниме'} — ${playerName}, сезон ${season}, серия ${episodeNumber}`;

  currentState = {
    animeId: anime?.animeId ?? null,
    animeUrl: anime?.animeUrl ?? null,
    episodeNumber,
    embedUrl,
    title,
    duration: 0,
    playback: {
      paused: true,
      currentTime: 0,
      updatedAt: Date.now()
    }
  };

  selectedSeason = season;
  selectedPlayer = playerName;
  userInteractedWithPlayer = true;
  pendingPlaybackApply = null;

  loadIframe(embedUrl);

  if (roomId !== 'solo') {
    socket.emit('change-video', {
      roomId,
      embedUrl,
      title,
      animeId: currentState.animeId,
      animeUrl: currentState.animeUrl,
      episodeNumber
    });
  } else {
    sys(`Вы выбрали: ${title}`);
  }
}

function extractTbIndex(title) {
  const value = String(title || '');
  const match = value.match(/\[(?:tb|тв|tv)[- ]?(\d+)\]/i) || value.match(/\b(?:tb|тв|tv)[- ]?(\d+)\b/i);

  if (!match) return null;

  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function getComparableYear(item) {
  const year = Number(item?.year);
  return Number.isFinite(year) && year > 0 ? year : 9999;
}

function getTitleMatchWeight(item, query) {
  const title = normalizeSearchQuery(item?.title || '');
  const q = normalizeSearchQuery(query || '');

  if (!q) return 0;
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (title.includes(q)) return 2;

  const words = q.split(' ').filter(Boolean);
  if (words.length && words.every((word) => title.includes(word))) return 3;

  return 4;
}

function sortSearchResults(items, query = '') {
  return [...(items || [])].sort((a, b) => {
    const matchA = getTitleMatchWeight(a, query);
    const matchB = getTitleMatchWeight(b, query);

    if (matchA !== matchB) return matchA - matchB;

    const yearA = getComparableYear(a);
    const yearB = getComparableYear(b);

    if (yearA !== yearB) return yearA - yearB;

    const tbA = extractTbIndex(a?.title);
    const tbB = extractTbIndex(b?.title);

    if (tbA !== null || tbB !== null) {
      if (tbA === null) return 1;
      if (tbB === null) return -1;
      if (tbA !== tbB) return tbA - tbB;
    }

    const scoreA = Number(a?.score) || 0;
    const scoreB = Number(b?.score) || 0;

    if (scoreB !== scoreA) return scoreB - scoreA;

    return String(a?.title || '').localeCompare(String(b?.title || ''), 'ru');
  });
}

function buildSearchSignature(items, expanded) {
  const ids = (items || [])
    .map((item) => `${item.animeId || ''}:${item.title || ''}:${item.year || ''}:${Number(item.score) || 0}`)
    .join('|');

  return `${expanded ? '1' : '0'}::${ids}`;
}

function pruneClientSearchCache() {
  const now = Date.now();

  for (const [key, entry] of clientSearchCache.entries()) {
    if (!entry || now - entry.createdAt > SEARCH_CLIENT_CACHE_TTL_MS) {
      clientSearchCache.delete(key);
    }
  }

  if (clientSearchCache.size <= SEARCH_CLIENT_CACHE_MAX) return;

  const entries = [...clientSearchCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);

  while (entries.length && clientSearchCache.size > SEARCH_CLIENT_CACHE_MAX) {
    const [oldestKey] = entries.shift();
    clientSearchCache.delete(oldestKey);
  }
}

function getClientCachedSearch(query) {
  pruneClientSearchCache();

  const entry = clientSearchCache.get(query);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > SEARCH_CLIENT_CACHE_TTL_MS) {
    clientSearchCache.delete(query);
    return null;
  }

  return entry.data;
}

function setClientCachedSearch(query, data) {
  pruneClientSearchCache();
  clientSearchCache.set(query, {
    createdAt: Date.now(),
    data
  });
}

function clearSearchResultsUi() {
  if (animeList) {
    animeList.innerHTML = '';
    animeList.classList.remove('visible');
  }

  lastRenderedSearchSignature = '';
}

function hideSearchResultsUi() {
  animeList?.classList.remove('visible');
}

function renderAnimeResults(items) {
  if (!animeList) return;

  if (!items.length) {
    clearSearchResultsUi();
    return;
  }

  const visibleItems = showAllSearchResults ? items : items.slice(0, 5);
  const needToggle = items.length > 5;
  const nextSignature = buildSearchSignature(items, showAllSearchResults);

  if (lastRenderedSearchSignature === nextSignature && animeList.innerHTML.trim()) {
    animeList.classList.add('visible');

    animeList.querySelectorAll('button').forEach((button) => {
      button.disabled = !canControl();
    });

    return;
  }

  animeList.innerHTML = `
    ${visibleItems.map((item) => `
      <button
        type="button"
        class="search-result-item ${item.animeId === selectedAnime?.animeId ? 'active' : ''}"
        data-anime-id="${escapeHtml(item.animeId)}"
      >
        ${item.poster
          ? `<img class="search-result-poster" src="${escapeHtml(item.poster)}" loading="lazy" alt="${escapeHtml(item.title)}">`
          : '<div class="search-result-poster search-result-poster-empty"></div>'}
        <div class="search-result-content">
          <div class="search-result-title">${escapeHtml(item.title)}</div>
          <div class="search-result-meta">${escapeHtml(item.year || '')}${item.type ? ` • ${escapeHtml(item.type)}` : ''}</div>
        </div>
      </button>
    `).join('')}
    ${needToggle ? `
      <button type="button" class="search-results-toggle" id="searchResultsToggleBtn">
        ${showAllSearchResults ? 'СВЕРНУТЬ РЕЗУЛЬТАТЫ' : 'ОТКРЫТЬ ВСЕ РЕЗУЛЬТАТЫ'}
      </button>
    ` : ''}
  `;

  animeList.classList.add('visible');
  lastRenderedSearchSignature = nextSignature;

  animeList.querySelectorAll('.search-result-item').forEach((button) => {
    button.disabled = !canControl();

    button.addEventListener('click', async () => {
      const selectedItemFromResults = items.find((item) => item.animeId === button.dataset.animeId);
      if (!selectedItemFromResults) return;

      hideSearchResultsUi();
      await selectAnime(selectedItemFromResults);
    });
  });

  const toggleBtn = document.getElementById('searchResultsToggleBtn');

  if (toggleBtn) {
    toggleBtn.disabled = !canControl();

    toggleBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    toggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      showAllSearchResults = !showAllSearchResults;
      lastRenderedSearchSignature = '';
      renderAnimeResults(lastSearchResults);

      animeList?.classList.add('visible');
    });
  }
}

async function fetchSearchResults(rawQuery, token) {
  const normalizedQuery = normalizeSearchQuery(rawQuery);
  const cached = getClientCachedSearch(normalizedQuery);

  if (cached) {
    if (token !== latestSearchToken) return;

    lastSearchQueryNormalized = normalizedQuery;
    lastSearchResults = cached;
    renderAnimeResults(lastSearchResults);

    if (searchStatus) {
      searchStatus.textContent = lastSearchResults.length ? `Найдено: ${lastSearchResults.length}` : 'Ничего не найдено';
    }

    return;
  }

  if (activeSearchAbortController) activeSearchAbortController.abort();
  activeSearchAbortController = new AbortController();

  const queryString = `q=${encodeURIComponent(rawQuery)}`;
  const endpoints = SEARCH_ENDPOINTS.map((base) => `${base}?${queryString}`);

  const data = await fetchJsonFallback(endpoints, {
    signal: activeSearchAbortController.signal,
    headers: {
      Accept: 'application/json'
    }
  });

  if (token !== latestSearchToken) return;

  const prepared = sortSearchResults(Array.isArray(data) ? data : [], rawQuery);
  setClientCachedSearch(normalizedQuery, prepared);

  lastSearchQueryNormalized = normalizedQuery;
  lastSearchResults = prepared;
  renderAnimeResults(lastSearchResults);

  if (searchStatus) {
    searchStatus.textContent = lastSearchResults.length ? `Найдено: ${lastSearchResults.length}` : 'Ничего не найдено';
  }
}

async function triggerSearchNow(rawQuery) {
  const value = String(rawQuery || '').trim();
  const normalized = normalizeSearchQuery(value);

  if (!value || normalized.length < SEARCH_MIN_LENGTH) return;
  if (!canControl()) return;

  latestSearchToken += 1;
  const token = latestSearchToken;
  showAllSearchResults = false;

  if (searchStatus) searchStatus.textContent = 'Поиск...';

  try {
    await fetchSearchResults(value, token);
  } catch (error) {
    if (token !== latestSearchToken) return;
    if (error?.name === 'AbortError') return;

    if (searchStatus) searchStatus.textContent = 'Ошибка поиска. Попробуйте ещё раз.';
    clearSearchResultsUi();
  }
}

function reopenSearchDropdownFromInput() {
  if (!searchInput || !canControl()) return;

  const rawQuery = String(searchInput.value || '').trim();
  const normalizedQuery = normalizeSearchQuery(rawQuery);

  if (!rawQuery || normalizedQuery.length < SEARCH_MIN_LENGTH) return;

  const cached = getClientCachedSearch(normalizedQuery);

  if (lastSearchResults.length && lastSearchQueryNormalized === normalizedQuery) {
    renderAnimeResults(lastSearchResults);
    if (searchStatus) searchStatus.textContent = `Найдено: ${lastSearchResults.length}`;
    return;
  }

  if (cached && cached.length) {
    lastSearchQueryNormalized = normalizedQuery;
    lastSearchResults = sortSearchResults(cached, rawQuery);
    renderAnimeResults(lastSearchResults);

    if (searchStatus) searchStatus.textContent = `Найдено: ${lastSearchResults.length}`;
    return;
  }

  triggerSearchNow(rawQuery);
}

if (!window.AnivmesteDebounce) {
  window.AnivmesteDebounce = function debounce(fn, wait = 300) {
    let timer = null;

    const wrapped = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };

    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  };
}

const debouncedSearchAnime = window.AnivmesteDebounce(async (query) => {
  const rawQuery = String(query || '').trim();
  const normalizedQuery = normalizeSearchQuery(rawQuery);

  if (!rawQuery || normalizedQuery.length < SEARCH_MIN_LENGTH) {
    latestSearchToken += 1;

    if (activeSearchAbortController) {
      activeSearchAbortController.abort();
      activeSearchAbortController = null;
    }

    lastSearchResults = [];
    lastSearchQueryNormalized = '';
    showAllSearchResults = false;
    clearSearchResultsUi();

    if (searchStatus) searchStatus.textContent = 'Введите минимум 2 символа';
    return;
  }

  if (!canControl()) return;

  latestSearchToken += 1;
  const token = latestSearchToken;
  showAllSearchResults = false;

  if (searchStatus) searchStatus.textContent = 'Поиск...';

  try {
    await fetchSearchResults(rawQuery, token);
  } catch (error) {
    if (token !== latestSearchToken) return;
    if (error?.name === 'AbortError') return;

    if (searchStatus) searchStatus.textContent = 'Ошибка поиска. Попробуйте ещё раз.';
    clearSearchResultsUi();
  }
}, SEARCH_DEBOUNCE_MS);

async function selectAnime(item) {
  if (!item || !canControl()) return;
  if (selectedAnimeInfo) selectedAnimeInfo.innerHTML = 'Загрузка...';

  try {
    const data = await fetchJsonFallback(SELECT_ENDPOINTS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        animeUrl: item.animeUrl,
        animeId: item.animeId,
        title: item.title,
        year: item.year,
        shikimoriId: item.shikimoriId,
        kodikId: item.kodikId
      })
    });

    selectedAnime = {
      ...data,
      shikimoriId: item.shikimoriId || data.shikimoriId || null,
      videos: Array.isArray(data?.videos) ? data.videos : []
    };

    const context = findDefaultContext(selectedAnime.videos);

    if (!context) {
      updateSelectedAnimeInfoContent(selectedAnime);
      showPlaceholderUi('Нет доступных серий', 'Для выбранного тайтла не удалось найти рабочий плеер');
      return;
    }

    selectedPlayer = context.player;
    selectedSeason = context.season;

    updateSelectedAnimeInfoContent(selectedAnime);
    launchEpisode(context.episode, selectedAnime);
  } catch (error) {
    if (String(error?.message || '').includes('ANIME_BLOCKED_BY_COUNTRY')) {
      showBlockedAnimeMessage();
      return;
    }

    selectedAnime = null;
    selectedPlayer = null;
    selectedSeason = null;
    updateSelectedAnimeInfoContent(null);
    showPlaceholderUi('Ошибка', error.message || 'Не удалось загрузить аниме');
  }
}

function saveNickname() {
  const newUsername = sanitizeUsername(nicknameInput?.value);

  if (!newUsername) {
    alert('Введите ник');
    nicknameInput?.focus();
    return;
  }

  const oldUsername = username;
  username = newUsername;

  safeLocalStorageSet(USERNAME_STORAGE, username);
  safeLocalStorageSet(MANUAL_USERNAME_STORAGE, '1');

  if (nicknameInput) nicknameInput.value = username;

  if (roomId !== 'solo') {
    socket.emit('change-username', {
      roomId,
      username
    });
  } else if (oldUsername !== username) {
    sys(`Теперь вы ${username}`);
  }
}

function getDisplayedUserTime(user) {
  const safeCurrentTime = Number(user?.currentTime);
  const hasTime = Number.isFinite(safeCurrentTime) && safeCurrentTime >= 0;
  const baseTime = hasTime ? safeCurrentTime : 0;
  const paused = !!user?.playbackPaused;
  const updatedAt = Number(user?.timeUpdatedAt || 0);

  if (paused || !updatedAt) return baseTime;

  const elapsed = Math.max(0, (Date.now() - updatedAt) / 1000);
  return baseTime + elapsed;
}

function renderUsers(users) {
  if (!usersList) return;

  if (Array.isArray(users)) {
    latestRoomUsers = users.map((user) => ({ ...user }));
  }

  if (!Array.isArray(latestRoomUsers) || latestRoomUsers.length === 0) {
    usersList.innerHTML = `<div class="empty-state">Зрителей пока нет</div>`;
    return;
  }

  usersList.innerHTML = latestRoomUsers.map((user) => {
    const displayTime = getDisplayedUserTime(user);
    const timeText = formatWatchTime(displayTime);
    const lastUpdateAt = Number(user?.timeUpdatedAt || 0);
    const isFresh = lastUpdateAt > 0 && (Date.now() - lastUpdateAt) <= USER_TIME_STALE_MS;
    const isLive = !user?.playbackPaused && isFresh;
    const userName = String(user?.username || 'Гость').trim() || 'Гость';
    const avatarLetter = userName.charAt(0).toUpperCase();

    return `
      <div class="user-item ${user.isHost ? 'is-host' : ''}">
        <div class="user-avatar" aria-hidden="true">${escapeHtml(avatarLetter)}</div>

        <div class="user-content">
          <div class="user-main">
            <div class="user-identity">
              <span class="user-name">${escapeHtml(userName)}</span>
              ${user.isHost
                ? `<span class="host-label">Хост</span>`
                : `<span class="viewer-label">Зритель</span>`}
            </div>

            <div
              class="user-time ${isLive ? 'is-live' : 'is-paused'}"
              title="${isLive ? 'Сейчас смотрит' : 'На паузе'}"
            >${escapeHtml(timeText)}</div>
          </div>

          <div class="user-subline">
            <span class="user-watch-state ${isLive ? 'is-live' : 'is-paused'}">
              ${isLive ? 'Смотрит сейчас' : 'На паузе'}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function startUsersRenderTicker() {
  if (usersRenderTicker) clearInterval(usersRenderTicker);
  usersRenderTicker = setInterval(() => renderUsers(), 1000);
}

function initializeRoomSupportModal() {
  if (roomSupportDescription) roomSupportDescription.textContent = SUPPORT_CONFIG.description || '';
  if (roomSupportThanks) roomSupportThanks.textContent = SUPPORT_CONFIG.thanksText || '';
  if (roomSupportBoostyLink) roomSupportBoostyLink.href = BOOSTY_URL;
  if (roomSupportDonationAlertsLink) roomSupportDonationAlertsLink.href = DONATIONALERTS_URL;

  if (!roomSupportModal) return;

  roomSupportModal.classList.add('hidden');
  roomSupportModal.classList.remove('is-visible', 'is-hiding');
  roomSupportModal.setAttribute('aria-hidden', 'true');
  roomSupportModal.style.setProperty('display', 'none', 'important');
}

function bindPlayerEvents() {
  window.addEventListener('player:time-update', (event) => {
    const seconds = event.detail?.time;
    if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return;

    currentState.playback.currentTime = seconds;
    currentState.playback.updatedAt = Date.now();

    if (isHost) {
      lastKnownHostTime = seconds;
      lastKnownHostTimeAt = Date.now();
    }

    emitCurrentUserTime();
  });

  window.addEventListener('player:duration-update', (event) => {
    const duration = event.detail?.duration;
    if (typeof duration === 'number' && duration > 0) {
      currentState.duration = duration;
    }
  });

  window.addEventListener('player:play', () => {
    const currentTime = updateLocalPlaybackTimeFromPlayer();

    currentState.playback.paused = false;
    currentState.playback.currentTime = typeof currentTime === 'number' ? currentTime : currentState.playback.currentTime;
    currentState.playback.updatedAt = Date.now();

    emitCurrentUserTime({ force: true });

    if (!isHost || roomId === 'solo') return;

    socket.emit('player-control', {
      roomId,
      action: 'play',
      currentTime: currentState.playback.currentTime
    });
  });

  window.addEventListener('player:pause', () => {
    const currentTime = updateLocalPlaybackTimeFromPlayer();

    currentState.playback.paused = true;
    currentState.playback.currentTime = typeof currentTime === 'number' ? currentTime : currentState.playback.currentTime;
    currentState.playback.updatedAt = Date.now();

    emitCurrentUserTime({ force: true });

    if (!isHost || roomId === 'solo') return;

    socket.emit('player-control', {
      roomId,
      action: 'pause',
      currentTime: currentState.playback.currentTime
    });
  });

  window.addEventListener('player:local-play', () => {
    currentState.playback.paused = false;
    currentState.playback.updatedAt = Date.now();
    emitCurrentUserTime({ force: true });
  });

  window.addEventListener('player:local-pause', () => {
    const currentTime = updateLocalPlaybackTimeFromPlayer();

    currentState.playback.paused = true;
    currentState.playback.currentTime = typeof currentTime === 'number' ? currentTime : currentState.playback.currentTime;
    currentState.playback.updatedAt = Date.now();

    emitCurrentUserTime({ force: true });
  });
}

function bindSocketEvents() {
  socket.on('connect', () => {
    if (roomId !== 'solo') {
      socket.emit('join-room', {
        roomId,
        username,
        userKey
      });

      startRequestSyncTimer();
    } else {
      isHost = true;

      if (window.PlayerModule) {
        window.PlayerModule.setHostState(true);
      }

      updateControlState();
      updateSelectedAnimeInfoContent(selectedAnime);
      showPlaceholderUi(currentState.title || 'Ничего не выбрано', 'Выберите аниме');
    }
  });

  socket.on('join-error', ({ message }) => {
    alert(message || 'Не удалось войти в комнату');
    window.location.href = '/';
  });

  socket.on('disconnect', () => {
    stopHostTimers();
    stopUserTimeTimer();
    stopDriftCheck();
    stopRequestSyncTimer();
  });

  socket.on('you-are-host', () => {
    isHost = true;

    if (window.PlayerModule) {
      window.PlayerModule.setHostState(true);
    }

    updateControlState();
    stopDriftCheck();

    if (currentState.embedUrl) {
      startHostTimers();
    }

    if (!hasShownHostMessage) {
      sys('Вы хост комнаты');
      hasShownHostMessage = true;
    }
  });

  socket.on('sync-state', (state) => {
    const nextEmbedUrl = state.embedUrl ?? null;

    isHost = !!state.isHost;

    if (window.PlayerModule) {
      window.PlayerModule.setHostState(isHost);
    }

    updateControlState();

    const playback = normalizePlaybackFromServer(state.playback) || {
      paused: true,
      currentTime: 0,
      updatedAt: 0
    };

    currentState = {
      animeId: state.animeId ?? null,
      animeUrl: state.animeUrl ?? null,
      episodeNumber: state.episodeNumber ?? null,
      embedUrl: nextEmbedUrl,
      title: state.title ?? null,
      duration: currentState.duration || 0,
      playback
    };

    if (typeof playback.currentTime === 'number') {
      lastKnownHostTime = playback.currentTime;
      lastKnownHostTimeAt = Date.now();
    }

    if (nextEmbedUrl) {
      if (currentLoadedEmbedUrl !== nextEmbedUrl) {
        loadIframe(nextEmbedUrl);

        pendingPlaybackApply = playback;

        setTimeout(() => {
          if (pendingPlaybackApply) {
            const pending = pendingPlaybackApply;
            pendingPlaybackApply = null;
            applyPlaybackState(pending, {
              force: true,
              reason: 'sync-state'
            });
          }
        }, 900);
      } else {
        if (!isHost) {
          applyPlaybackState(playback, {
            force: false,
            reason: 'sync-state-same-video'
          });

          startDriftCheck();
        } else {
          startHostTimers();
        }

        startUserTimeTimer();
      }
    } else {
      pendingPlaybackApply = null;
      currentLoadedEmbedUrl = null;
      showPlaceholderUi('Ничего не выбрано', isHost ? 'Выберите аниме' : 'Хост пока не запустил тайтл');
    }
  });

  socket.on('video-changed', (state) => {
    const nextEmbedUrl = state.embedUrl ?? null;

    const playback = normalizePlaybackFromServer(state.playback) || {
      paused: true,
      currentTime: 0,
      updatedAt: Date.now()
    };

    currentState = {
      animeId: state.animeId ?? null,
      animeUrl: state.animeUrl ?? null,
      episodeNumber: state.episodeNumber ?? null,
      embedUrl: nextEmbedUrl,
      title: state.title ?? null,
      duration: 0,
      playback
    };

    if (nextEmbedUrl) {
      if (currentLoadedEmbedUrl !== nextEmbedUrl) {
        loadIframe(nextEmbedUrl);
        pendingPlaybackApply = playback;
      } else {
        pendingPlaybackApply = null;

        if (!isHost) {
          applyPlaybackState(playback, {
            force: true,
            reason: 'video-changed-same-video'
          });

          startDriftCheck();
        } else {
          startHostTimers();
        }

        startUserTimeTimer();
      }
    } else {
      pendingPlaybackApply = null;
      currentLoadedEmbedUrl = null;
      showPlaceholderUi('Ничего не выбрано', 'Хост пока не запустил тайтл');
    }
  });

  socket.on('player-control', ({ action, currentTime, paused, updatedAt }) => {
    if (roomId === 'solo' || isHost) return;

    const safeTime = typeof currentTime === 'number' && !Number.isNaN(currentTime)
      ? currentTime
      : currentState.playback.currentTime;

    const newPaused = typeof paused === 'boolean' ? paused : action === 'pause';

    lastKnownHostTime = safeTime ?? 0;
    lastKnownHostTimeAt = Date.now();

    currentState.playback = {
      paused: newPaused,
      currentTime: safeTime ?? 0,
      updatedAt: Number(updatedAt || Date.now()) || Date.now()
    };

    if (action === 'timeupdate') {
      checkDrift();
      emitCurrentUserTime();
      return;
    }

    if (action === 'play' || action === 'pause') {
      applyPlaybackState(currentState.playback, {
        force: true,
        reason: action
      });

      lastAppliedAt = Date.now();
      lastAppliedTargetTime = safeTime;
      lastForcedSyncAt = Date.now();
    } else if (action === 'seek') {
      applyPlaybackState(currentState.playback, {
        force: true,
        reason: 'seek'
      });

      lastAppliedAt = Date.now();
      lastAppliedTargetTime = safeTime;
      lastForcedSyncAt = Date.now();
    }
  });

  socket.on('room-users', renderUsers);

  socket.on('system-message', ({ text }) => sys(text));

  socket.on('chat-message', ({ username: author, message, time }) => {
    if (!chatMessages || !window.ChatModule) return;

    const isSelfMessage = author === username;

    window.ChatModule.appendMessage(chatMessages, {
      username: author,
      message,
      time,
      isSelf: isSelfMessage
    });

    if (!isSelfMessage) playChatSound();
  });
}

function bindUiEvents() {
  window.addEventListener('pointerdown', () => {
    userInteractedWithPlayer = true;
    hideViewerHintOverlay();
    unlockAudioContext();
  });

  window.addEventListener('keydown', () => {
    userInteractedWithPlayer = true;
    hideViewerHintOverlay();
    unlockAudioContext();
  });

  document.addEventListener('click', (event) => {
    const withinSearch = event.target.closest('.anime-search-section, .center-search-panel');
    if (!withinSearch) hideSearchResultsUi();
  });

  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async () => {
      const inviteUrl = `${window.location.origin}/room/${encodeURIComponent(roomId)}`;

      try {
        await navigator.clipboard.writeText(inviteUrl);
        sys('Ссылка скопирована');
      } catch {
        window.prompt('Скопируйте ссылку:', inviteUrl);
      }
    });
  }

  if (cinemaModeBtn) {
    cinemaModeBtn.addEventListener('click', () => {
      roomPage?.classList.toggle('cinema-mode');
    });
  }

  if (supportRoomBtn) {
    supportRoomBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openRoomSupportModal(event);
    });
  }

  if (roomSupportModalBackdrop) {
    roomSupportModalBackdrop.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeRoomSupportModal(event);
    });
  }

  if (closeRoomSupportModalBtn) {
    closeRoomSupportModalBtn.addEventListener('click', closeRoomSupportModal);
  }

  if (roomSupportModal) {
    roomSupportModal.addEventListener('click', (event) => {
      if (event.target === roomSupportModal) {
        closeRoomSupportModal(event);
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (roomSupportModal && !roomSupportModal.classList.contains('hidden')) {
        closeRoomSupportModal(event);
      }
    }
  });

  if (toggleUsersPanelBtn) {
    toggleUsersPanelBtn.addEventListener('click', () => {
      setUsersPanelOpen(!isUsersPanelOpen);
    });
  }

  if (saveNicknameBtn) {
    saveNicknameBtn.addEventListener('click', saveNickname);
  }

  if (nicknameInput) {
    nicknameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') saveNickname();
    });
  }

  if (sendBtn && chatInput) {
    sendBtn.addEventListener('click', () => {
      const message = chatInput.value.trim();
      if (!message) return;

      unlockAudioContext();
      playChatSound();

      if (roomId !== 'solo') {
        socket.emit('chat-message', {
          roomId,
          username,
          message
        });
      } else if (window.ChatModule && chatMessages) {
        window.ChatModule.appendMessage(chatMessages, {
          username,
          message,
          time: getMoscowTimeString(),
          isSelf: true
        });
      }

      chatInput.value = '';
      chatInput.focus();
    });

    chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendBtn.click();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => debouncedSearchAnime(searchInput.value));
    searchInput.addEventListener('click', () => reopenSearchDropdownFromInput());
    searchInput.addEventListener('focus', () => reopenSearchDropdownFromInput());

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideSearchResultsUi();
        searchInput.blur();
        debouncedSearchAnime.cancel();
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        triggerSearchNow(searchInput.value);
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    stopHostTimers();
    stopUserTimeTimer();
    stopDriftCheck();
    stopRequestSyncTimer();

    if (usersRenderTicker) {
      clearInterval(usersRenderTicker);
      usersRenderTicker = null;
    }

    if (activeSearchAbortController) {
      activeSearchAbortController.abort();
      activeSearchAbortController = null;
    }

    if (roomSupportCloseTimer) {
      clearTimeout(roomSupportCloseTimer);
      roomSupportCloseTimer = null;
    }
  });
}

function initRoomPage() {
  updateRoomDocumentMeta(roomId);

  if (nicknameInput) nicknameInput.value = username;

  initializeRoomSupportModal();
  bindPlayerEvents();
  bindSocketEvents();
  bindUiEvents();

  setUsersPanelOpen(false);
  updateControlState();
  updateSelectedAnimeInfoContent(null);
  showPlaceholderUi('Ничего не выбрано', isHost ? 'Выберите аниме' : 'Хост пока не запустил тайтл');
  renderUsers([]);
  startUsersRenderTicker();
}

initRoomPage();