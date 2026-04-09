function createNoopSocket() {
  return {
    on() {},
    emit() {},
    off() {}
  };
}

if (!window.AnivmesteDebounce) {
  window.AnivmesteDebounce = function anivmesteDebounce(fn, wait = 300) {
    let timer = null;
    function wrapped(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    }
    wrapped.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    return wrapped;
  };
}

if (!window.ChatModule) {
  window.ChatModule = {
    appendSystemMessage(container, text) {
      if (!container) return;
      const el = document.createElement('div');
      el.className = 'chat-system-message';
      el.textContent = text;
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
    },
    appendMessage(container, payload) {
      if (!container) return;
      const wrap = document.createElement('div');
      wrap.className = `chat-message ${payload?.isSelf ? 'self' : ''}`;
      wrap.innerHTML = `
        <div class="chat-message-head">${String(payload?.username || 'Guest')} • ${String(payload?.time || '')}</div>
        <div class="chat-message-text">${String(payload?.message || '')}</div>
      `;
      container.appendChild(wrap);
      container.scrollTop = container.scrollHeight;
    }
  };
}

if (!window.PlayerModule) {
  window.PlayerModule = {
    detectPlayerType(src) {
      return String(src || '').includes('kodik') ? 'kodik' : 'iframe';
    },
    mountIframe(container, { src, title }) {
      if (!container) return;
      container.innerHTML = '';
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.title = title || 'Player';
      iframe.allow = 'autoplay; fullscreen; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.setAttribute('frameborder', '0');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      container.appendChild(iframe);
    },
    showPlaceholder(container, { title, description }) {
      if (!container) return;
      container.innerHTML = `
        <div class="placeholder">
          <h3>${String(title || '')}</h3>
          <p>${String(description || '')}</p>
        </div>
      `;
    },
    pause() {},
    play() {},
    seekTo() {},
    onVideoChanged() {},
    onEpisodeEnded() {}
  };
}

const socket = typeof io === 'function' ? io() : createNoopSocket();

const CONFIG = window.AnivmesteConfig || {};
const SUPPORT_CONFIG = CONFIG.support || {};
const BOOSTY_URL = SUPPORT_CONFIG.boostyUrl || '#';
const DONATIONALERTS_URL = SUPPORT_CONFIG.donationAlertsUrl || '#';

const params = new URLSearchParams(window.location.search);
const roomId = decodeURIComponent(window.location.pathname.split('/room/')[1] || '');
const roomAccessToken = String(params.get('access') || '').trim();

function updateRoomDocumentMeta(currentRoomId) {
  const title = currentRoomId === 'solo'
    ? 'Одиночный просмотр'
    : `Комната: ${currentRoomId}`;

  document.title = `${title} — Anivmeste`;

  const roomTitleEl = document.getElementById('roomTitle');
  if (roomTitleEl) roomTitleEl.textContent = title;
}
updateRoomDocumentMeta(roomId);

const USER_KEY_STORAGE = 'anivmeste_user_key';
const USERNAME_STORAGE = 'username';
const MANUAL_USERNAME_STORAGE = 'saved_username_manual';

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_CLIENT_CACHE_TTL_MS = 3 * 60 * 1000;
const SEARCH_CLIENT_CACHE_MAX = 70;

let showAllSearchResults = false;
let lastSearchResults = [];

let isHost = false;
let selectedAnime = null;
let selectedPlayer = null;
let selectedSeason = null;
let latestSearchToken = 0;
let pendingPlaybackApply = null;
let userInteractedWithPlayer = false;
let hostTimeBroadcastTimer = null;
let userTimeBroadcastTimer = null;
let hasShownHostMessage = false;
let audioContext = null;
let latestRoomUsers = [];
let usersRenderTicker = null;

let activeSearchAbortController = null;
let lastRenderedSearchSignature = '';
const clientSearchCache = new Map();

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

const roomSupportModal = document.getElementById('roomSupportModal');
const roomSupportModalBackdrop = document.getElementById('roomSupportModalBackdrop');
const closeRoomSupportModalBtn = document.getElementById('closeRoomSupportModalBtn');
const roomSupportDescription = document.getElementById('roomSupportDescription');
const roomSupportThanks = document.getElementById('roomSupportThanks');
const roomSupportBoostyLink = document.getElementById('roomSupportBoostyLink');
const roomSupportDonationAlertsLink = document.getElementById('roomSupportDonationAlertsLink');

if (roomSupportDescription) roomSupportDescription.textContent = SUPPORT_CONFIG.description || '';
if (roomSupportThanks) roomSupportThanks.textContent = SUPPORT_CONFIG.thanksText || '';
if (roomSupportBoostyLink) roomSupportBoostyLink.href = BOOSTY_URL;
if (roomSupportDonationAlertsLink) roomSupportDonationAlertsLink.href = DONATIONALERTS_URL;

function safeLocalStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeLocalStorageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function sanitizeUsername(name) { return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 30); }

function normalizeSearchQuery(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function canControl() { return roomId === 'solo' || isHost; }

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
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

function playChatSound() {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1300, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.02, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {}
}

function openRoomSupportModal() {
  if (!roomSupportModal) return;
  roomSupportModal.classList.remove('hidden', 'is-hiding');
  roomSupportModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => roomSupportModal.classList.add('is-visible'));
}

function closeRoomSupportModal() {
  if (!roomSupportModal || roomSupportModal.classList.contains('hidden')) return;
  roomSupportModal.classList.remove('is-visible');
  roomSupportModal.classList.add('is-hiding');
  setTimeout(() => {
    roomSupportModal.classList.add('hidden');
    roomSupportModal.classList.remove('is-hiding');
    roomSupportModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }, 220);
}

function updateControlState() {
  const disabled = !canControl();
  if (searchInput) {
    searchInput.disabled = disabled;
    searchInput.placeholder = disabled ? 'Только хост может искать аниме' : 'Введите название аниме...';
  }
  if (hostSearchHint) {
    hostSearchHint.textContent = disabled
      ? 'Искать и выбирать тайтл может только хост комнаты'
      : 'Вы можете искать тайтлы и запускать плеер для всей комнаты';
  }
  if (hostBadge) hostBadge.textContent = canControl() ? 'Хост' : 'Зритель';
  animeList?.querySelectorAll('button').forEach((btn) => { btn.disabled = disabled; });
}

function showPlaceholderUi(title = 'Ничего не выбрано', description = 'Выберите аниме') {
  const playerWrapper = document.getElementById('playerWrapper');
  if (!playerWrapper || !window.PlayerModule) return;
  window.PlayerModule.showPlaceholder(playerWrapper, { title, description });
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

  selectedAnimeInfo.innerHTML = `
    <div class="selected-anime-layout">
      ${anime.poster ? `<img class="selected-anime-poster" src="${escapeHtml(anime.poster)}" loading="lazy" alt="${escapeHtml(anime.title)}">` : ''}
      <div class="selected-anime-body">
        <h3 class="selected-anime-title">${escapeHtml(anime.title)}</h3>
        <div class="selected-anime-meta">
          ${anime.year ? `${escapeHtml(anime.year)}` : ''}${anime.type ? ` • ${escapeHtml(anime.type)}` : ''}${anime.status ? ` • ${escapeHtml(anime.status)}` : ''}
        </div>
        ${anime.description ? `<p class="selected-anime-description">${escapeHtml(anime.description)}</p>` : ''}
      </div>
    </div>
  `;
}

function readJsonSafely(response) {
  return response.text().then((text) => {
    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(`Сервер вернул не JSON. HTTP ${response.status}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Сервер вернул битый JSON');
    }
  });
}

function formatWatchTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function stopHostPlaybackGuard() {}
function startHostPlaybackGuard() {}
function startPlaybackDriftCheck() {}
function stopPlaybackDriftCheck() {}

function applyPlaybackStateWhenReady(pb, retries = 10) {
  if (!window.PlayerModule) return;
  if (!pb || retries <= 0) return;

  const currentTime = typeof pb.currentTime === 'number' ? pb.currentTime : null;
  const paused = !!pb.paused;

  if (currentTime !== null && typeof window.PlayerModule.seekTo === 'function') {
    try { window.PlayerModule.seekTo(currentTime); } catch {}
  }

  if (paused && typeof window.PlayerModule.pause === 'function') {
    try { window.PlayerModule.pause(); } catch {}
  } else if (!paused && typeof window.PlayerModule.play === 'function') {
    try { window.PlayerModule.play(); } catch {}
  }
}

function loadIframe(embedUrl) {
  const playerWrapper = document.getElementById('playerWrapper');
  if (!playerWrapper || !window.PlayerModule) return;

  stopHostPlaybackGuard();
  stopPlaybackDriftCheck();

  if (!embedUrl) {
    showPlaceholderUi('Серия не запущена', 'У выбранного тайтла отсутствует iframe');
    return;
  }

  window.PlayerModule.mountIframe(playerWrapper, { src: embedUrl, title: currentState.title || 'Плеер' });

  if (pendingPlaybackApply) {
    const pb = pendingPlaybackApply;
    pendingPlaybackApply = null;
    setTimeout(() => applyPlaybackStateWhenReady(pb), 500);
  }
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

  const fallback = 'Guest';
  safeLocalStorageSet(USERNAME_STORAGE, fallback);
  safeLocalStorageSet(MANUAL_USERNAME_STORAGE, '0');
  return fallback;
}

let username = resolveInitialUsername();
if (nicknameInput) nicknameInput.value = username;

function getOrCreateUserKey() {
  let key = safeLocalStorageGet(USER_KEY_STORAGE);
  if (!key) {
    key = `uk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    safeLocalStorageSet(USER_KEY_STORAGE, key);
  }
  return key;
}
const userKey = getOrCreateUserKey();

function getClientCachedSearch(query) {
  const entry = clientSearchCache.get(query);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > SEARCH_CLIENT_CACHE_TTL_MS) {
    clientSearchCache.delete(query);
    return null;
  }
  return entry.data;
}

function setClientCachedSearch(query, data) {
  if (clientSearchCache.size > SEARCH_CLIENT_CACHE_MAX) {
    const oldestKey = clientSearchCache.keys().next().value;
    clientSearchCache.delete(oldestKey);
  }
  clientSearchCache.set(query, { createdAt: Date.now(), data });
}

function clearSearchResultsUi() {
  if (animeList) {
    animeList.innerHTML = '';
    animeList.classList.remove('visible');
  }
  lastRenderedSearchSignature = '';
}

function buildSearchSignature(items, expanded) {
  const ids = (items || []).map((item) => `${item.animeId || ''}:${item.title || ''}:${item.year || ''}`).join('|');
  return `${expanded ? '1' : '0'}::${ids}`;
}

function sortSearchResults(items) {
  return [...(items || [])].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const yearA = Number(a?.year) || 0;
    const yearB = Number(b?.year) || 0;
    if (yearA !== yearB) return yearB - yearA;
    return String(a?.title || '').localeCompare(String(b?.title || ''), 'ru');
  });
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
  if (lastRenderedSearchSignature === nextSignature) return;

  animeList.innerHTML = `
    ${visibleItems.map((item) => `
      <button type="button" class="search-result-item" data-anime-id="${escapeHtml(item.animeId)}">
        ${item.poster ? `<img class="search-result-poster" src="${escapeHtml(item.poster)}" loading="lazy" alt="${escapeHtml(item.title)}">` : '<div class="search-result-poster search-result-poster-empty"></div>'}
        <div class="search-result-content">
          <div class="search-result-title">${escapeHtml(item.title)}</div>
          <div class="search-result-meta">${escapeHtml(item.year || '')}${item.type ? ` • ${escapeHtml(item.type)}` : ''}</div>
        </div>
      </button>
    `).join('')}
    ${needToggle ? `<button type="button" class="search-results-toggle" id="searchResultsToggleBtn">${showAllSearchResults ? 'СВЕРНУТЬ РЕЗУЛЬТАТЫ' : 'ОТКРЫТЬ ВСЕ РЕЗУЛЬТАТЫ'}</button>` : ''}
  `;

  animeList.classList.add('visible');
  lastRenderedSearchSignature = nextSignature;

  animeList.querySelectorAll('.search-result-item').forEach((btn) => {
    btn.disabled = !canControl();
    btn.addEventListener('click', async () => {
      const picked = items.find((i) => i.animeId === btn.dataset.animeId);
      if (!picked) return;
      clearSearchResultsUi();
      await selectAnime(picked);
    });
  });

  const toggleBtn = document.getElementById('searchResultsToggleBtn');
  if (toggleBtn) {
    toggleBtn.disabled = !canControl();
    toggleBtn.addEventListener('click', () => {
      showAllSearchResults = !showAllSearchResults;
      lastRenderedSearchSignature = '';
      renderAnimeResults(lastSearchResults);
    });
  }
}

async function fetchSearchResults(rawQuery, token) {
  const normalizedQuery = normalizeSearchQuery(rawQuery);
  const cached = getClientCachedSearch(normalizedQuery);

  if (cached) {
    if (token !== latestSearchToken) return;
    lastSearchResults = cached;
    renderAnimeResults(lastSearchResults);
    if (searchStatus) searchStatus.textContent = lastSearchResults.length ? `Найдено: ${lastSearchResults.length}` : 'Ничего не найдено';
    return;
  }

  if (activeSearchAbortController) {
    activeSearchAbortController.abort();
  }

  activeSearchAbortController = new AbortController();

  const response = await fetch(`/api/kodik/search?q=${encodeURIComponent(rawQuery)}`, {
    signal: activeSearchAbortController.signal,
    headers: { Accept: 'application/json' }
  });

  const data = await readJsonSafely(response);
  if (token !== latestSearchToken) return;
  if (!response.ok) throw new Error(data?.error || 'Ошибка поиска');

  const prepared = sortSearchResults(Array.isArray(data) ? data : []);
  setClientCachedSearch(normalizedQuery, prepared);

  lastSearchResults = prepared;
  renderAnimeResults(lastSearchResults);

  if (searchStatus) {
    searchStatus.textContent = lastSearchResults.length ? `Найдено: ${lastSearchResults.length}` : 'Ничего не найдено';
  }
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
    if (searchStatus) searchStatus.textContent = error.message || 'Ошибка поиска';
    clearSearchResultsUi();
  }
}, SEARCH_DEBOUNCE_MS);

async function selectAnime(item) {
  if (!item || !canControl()) return;
  if (selectedAnimeInfo) selectedAnimeInfo.innerHTML = 'Загрузка...';

  try {
    const response = await fetch('/api/kodik/anime/by-selection', {
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

    const data = await readJsonSafely(response);

    if (!response.ok) {
      if (response.status === 403 && data?.code === 'ANIME_BLOCKED_BY_COUNTRY') {
        selectedAnime = null;
        updateSelectedAnimeInfoContent(null);
        showPlaceholderUi('Просмотр недоступен', data?.error || 'Данное аниме запрещено на территории вашей страны');
        return;
      }
      throw new Error(data?.error || 'Не удалось загрузить аниме');
    }

    selectedAnime = {
      ...data,
      videos: Array.isArray(data?.videos) ? data.videos : []
    };

    updateSelectedAnimeInfoContent(selectedAnime);

    const firstVideo = selectedAnime.videos.find((v) => v?.iframeUrl || v?.iframe_url);
    if (!firstVideo) {
      showPlaceholderUi('Нет доступных серий', 'Не удалось найти рабочий iframe для выбранного тайтла');
      return;
    }

    const embedUrl = firstVideo.iframeUrl || firstVideo.iframe_url;
    const episodeNumber = Number(firstVideo.number) || Number(firstVideo.index) || 1;
    const title = `${selectedAnime.title} — серия ${episodeNumber}`;

    currentState = {
      animeId: selectedAnime.animeId || null,
      animeUrl: selectedAnime.animeUrl || null,
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

    loadIframe(embedUrl);

    if (roomId !== 'solo') {
      socket.emit('change-video', {
        roomId,
        embedUrl,
        title,
        animeId: currentState.animeId,
        animeUrl: currentState.animeUrl,
        episodeNumber: currentState.episodeNumber
      });
    } else {
      sys(`Вы выбрали: ${title}`);
    }
  } catch (error) {
    updateSelectedAnimeInfoContent(null);
    showPlaceholderUi('Ошибка', error.message || 'Не удалось загрузить аниме');
  }
}

function getDisplayedUserTime(user) {
  const hasTime = typeof user?.currentTime === 'number' && !Number.isNaN(user.currentTime);
  if (!hasTime) return null;
  const baseTime = Number(user.currentTime) || 0;
  const updatedAt = Number(user.timeUpdatedAt || 0) || 0;
  if (!updatedAt) return baseTime;
  const diffSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  return baseTime + diffSeconds;
}

function renderUsers(users) {
  if (!usersList) return;

  if (Array.isArray(users)) {
    latestRoomUsers = users.map((user) => ({ ...user }));
  }

  if (!Array.isArray(latestRoomUsers) || latestRoomUsers.length === 0) {
    usersList.innerHTML = `<div class="empty-state">Пока никого нет</div>`;
    return;
  }

  usersList.innerHTML = latestRoomUsers.map((user) => {
    const displayTime = getDisplayedUserTime(user);
    const timeText = typeof displayTime === 'number' ? formatWatchTime(displayTime) : '--:--';

    return `
      <div class="user-item">
        <div class="user-main">
          <div class="user-identity">
            <span class="user-name">${escapeHtml(user.username)}</span>
            ${user.isHost ? `<span class="host-label">Хост</span>` : ''}
          </div>
          <div class="user-time">${escapeHtml(timeText)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function startUsersRenderTicker() {
  if (usersRenderTicker) clearInterval(usersRenderTicker);
  usersRenderTicker = setInterval(() => renderUsers(), 1000);
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
    socket.emit('change-username', { roomId, username });
  } else if (oldUsername !== username) {
    sys(`Теперь вы ${username}`);
  }
}

socket.on('connect', () => {
  if (roomId !== 'solo') {
    socket.emit('join-room', { roomId, username, userKey, accessToken: roomAccessToken });
  } else {
    isHost = true;
    updateControlState();
    updateSelectedAnimeInfoContent(selectedAnime);
    showPlaceholderUi('Ничего не выбрано', 'Выберите аниме');
  }
});

socket.on('join-error', ({ message }) => {
  alert(message || 'Не удалось войти в комнату');
  window.location.href = '/';
});

socket.on('you-are-host', () => {
  isHost = true;
  updateControlState();
  if (!hasShownHostMessage) {
    sys('Вы хост комнаты');
    hasShownHostMessage = true;
  }
});

socket.on('sync-state', (state) => {
  isHost = !!state?.isHost;
  updateControlState();

  currentState = {
    animeId: state?.animeId ?? null,
    animeUrl: state?.animeUrl ?? null,
    episodeNumber: state?.episodeNumber ?? null,
    embedUrl: state?.embedUrl ?? null,
    title: state?.title ?? null,
    duration: 0,
    playback: state?.playback || { paused: true, currentTime: 0, updatedAt: Date.now() }
  };

  if (currentState.embedUrl) {
    loadIframe(currentState.embedUrl);
    pendingPlaybackApply = currentState.playback;
    setTimeout(() => applyPlaybackStateWhenReady(pendingPlaybackApply), 450);
  } else {
    showPlaceholderUi('Ничего не выбрано', isHost ? 'Выберите аниме' : 'Хост пока не запустил тайтл');
  }
});

socket.on('video-changed', (state) => {
  currentState = {
    animeId: state?.animeId ?? null,
    animeUrl: state?.animeUrl ?? null,
    episodeNumber: state?.episodeNumber ?? null,
    embedUrl: state?.embedUrl ?? null,
    title: state?.title ?? null,
    duration: 0,
    playback: {
      paused: true,
      currentTime: 0,
      updatedAt: Date.now()
    }
  };

  if (currentState.embedUrl) {
    loadIframe(currentState.embedUrl);
  } else {
    showPlaceholderUi('Ничего не выбрано', 'Хост пока не запустил тайтл');
  }
});

socket.on('player-control', ({ action, currentTime, paused, updatedAt }) => {
  if (roomId === 'solo' || isHost) return;

  const safeTime = typeof currentTime === 'number' && !Number.isNaN(currentTime)
    ? currentTime
    : currentState.playback.currentTime;

  currentState.playback = {
    paused: typeof paused === 'boolean' ? paused : action === 'pause',
    currentTime: safeTime ?? 0,
    updatedAt: Number(updatedAt || Date.now()) || Date.now()
  };

  applyPlaybackStateWhenReady(currentState.playback);
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

window.PlayerModule.onVideoChanged?.(() => {});
window.PlayerModule.onEpisodeEnded?.(() => {});

if (searchInput) {
  searchInput.addEventListener('input', () => debouncedSearchAnime(searchInput.value));
  searchInput.addEventListener('focus', () => {
    if (lastSearchResults.length) renderAnimeResults(lastSearchResults);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearSearchResultsUi();
      searchInput.blur();
      debouncedSearchAnime.cancel?.();
    }
  });
}

if (copyLinkBtn) {
  copyLinkBtn.addEventListener('click', async () => {
    const inviteParams = new URLSearchParams();
    if (roomAccessToken) inviteParams.set('access', roomAccessToken);

    const inviteQuery = inviteParams.toString();
    const inviteUrl = `${window.location.origin}/room/${encodeURIComponent(roomId)}${inviteQuery ? `?${inviteQuery}` : ''}`;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      sys('Ссылка скопирована');
    } catch {
      window.prompt('Скопируйте ссылку:', inviteUrl);
    }
  });
}

if (cinemaModeBtn) {
  cinemaModeBtn.addEventListener('click', () => roomPage?.classList.toggle('cinema-mode'));
}

if (supportRoomBtn) supportRoomBtn.addEventListener('click', openRoomSupportModal);
roomSupportModalBackdrop?.addEventListener('click', closeRoomSupportModal);
closeRoomSupportModalBtn?.addEventListener('click', closeRoomSupportModal);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && roomSupportModal && !roomSupportModal.classList.contains('hidden')) {
    closeRoomSupportModal();
  }
});

if (saveNicknameBtn) saveNicknameBtn.addEventListener('click', saveNickname);
if (nicknameInput) {
  nicknameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveNickname();
  });
}

if (sendBtn && chatInput) {
  sendBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (!message) return;

    unlockAudioContext();

    if (roomId !== 'solo') {
      socket.emit('chat-message', { roomId, username, message });
    } else if (window.ChatModule && chatMessages) {
      window.ChatModule.appendMessage(chatMessages, {
        username,
        message,
        time: getMoscowTimeString(),
        isSelf: true
      });
      playChatSound();
    }

    chatInput.value = '';
    chatInput.focus();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBtn.click();
  });
}

window.addEventListener('pointerdown', () => unlockAudioContext());
window.addEventListener('keydown', () => unlockAudioContext());

window.addEventListener('beforeunload', () => {
  if (usersRenderTicker) clearInterval(usersRenderTicker);
  if (activeSearchAbortController) activeSearchAbortController.abort();
});

updateControlState();
updateSelectedAnimeInfoContent(null);
showPlaceholderUi('Ничего не выбрано', 'Выберите аниме');
renderUsers([]);
startUsersRenderTicker();