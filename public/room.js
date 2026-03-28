const socket = io();

const params = new URLSearchParams(window.location.search);
const username = params.get('username') || 'Гость';
const roomId = decodeURIComponent(window.location.pathname.split('/room/')[1] || '');

const USER_KEY_STORAGE_KEY = 'aniwatch_user_key';

function generateUserKey() {
  return `user_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateUserKey() {
  let saved = localStorage.getItem(USER_KEY_STORAGE_KEY);

  if (!saved) {
    saved = generateUserKey();
    localStorage.setItem(USER_KEY_STORAGE_KEY, saved);
  }

  return saved;
}

const userKey = getOrCreateUserKey();

let isHost = false;
let selectedAnime = null;
let selectedPlayer = null;
let searchDebounce = null;
let lastSearchResults = [];
let pendingPlaybackApply = null;
let isRemoteAction = false;
let userInteractedWithPlayer = false;
let lastHostKnownTime = null;

let viewerAutoSyncTimer = null;
let kodikTimeRequestTimer = null;

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

const roomTitle = document.getElementById('roomTitle');
const hostBadge = document.getElementById('hostBadge');
const usersList = document.getElementById('usersList');
const nowPlayingText = document.getElementById('nowPlayingText');
const placeholder = document.getElementById('placeholder');
const animeList = document.getElementById('animeList');
const playerList = document.getElementById('playerList');
const episodesList = document.getElementById('episodesList');
const searchInput = document.getElementById('searchInput');
const syncBtn = document.getElementById('syncBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const cinemaModeBtn = document.getElementById('cinemaModeBtn');
const roomPage = document.getElementById('roomPage');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const statusButtons = document.querySelectorAll('.status-btn');
const searchStatus = document.getElementById('searchStatus');
const selectedAnimeInfo = document.getElementById('selectedAnimeInfo');
const hostSearchHint = document.getElementById('hostSearchHint');
const hostSyncPanel = document.getElementById('hostSyncPanel');

if (roomTitle) {
  roomTitle.textContent = roomId === 'solo' ? 'Одиночный просмотр' : `Комната: ${roomId}`;
}

const canControl = () => roomId === 'solo' || isHost;

function sys(text) {
  console.log(text);
  if (chatMessages && window.ChatModule) {
    ChatModule.appendSystemMessage(chatMessages, text);
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

function normalizeUrl(url) {
  if (!url) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function getPlayerName(video) {
  return String(
    video?.player ||
    video?.data?.player ||
    video?.dubbing ||
    video?.data?.dubbing ||
    'unknown'
  ).trim();
}

function getEpisodeNumber(video) {
  return Number(video?.number) || Number(video?.index) || 0;
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
      map.set(name, { name, count: 1 });
    } else {
      map.get(name).count += 1;
    }
  }

  return [...map.values()];
}

function getVideosBySelectedPlayer(videos) {
  if (!selectedPlayer) return [];
  return (videos || []).filter(video => {
    return getPlayerName(video) === selectedPlayer && !!getIframeUrl(video);
  });
}

function getUniqueEpisodes(videos) {
  const map = new Map();

  for (const video of videos || []) {
    const episodeNumber = getEpisodeNumber(video);
    const iframeUrl = getIframeUrl(video);

    if (!episodeNumber || !iframeUrl) continue;

    if (!map.has(episodeNumber)) {
      map.set(episodeNumber, {
        ...video,
        episodeNumber
      });
    }
  }

  return [...map.values()].sort((a, b) => a.episodeNumber - b.episodeNumber);
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
      ? 'Искать и выбирать серии может только хост комнаты'
      : 'Вы можете искать тайтлы и запускать серии для всей комнаты';
  }

  if (hostBadge) {
    hostBadge.textContent = canControl() ? '👑 Хост' : '👀 Зритель';
  }

  if (hostSyncPanel) {
    hostSyncPanel.classList.add('hidden');
  }

  animeList?.querySelectorAll('button').forEach(btn => btn.disabled = disabled);
  playerList?.querySelectorAll('button').forEach(btn => btn.disabled = disabled);
  episodesList?.querySelectorAll('button').forEach(btn => btn.disabled = disabled);
}

function showPlaceholder(title = 'Ничего не выбрано', description = 'Выберите аниме и серию') {
  if (nowPlayingText) nowPlayingText.textContent = title;

  const oldFrame = document.getElementById('videoFrame');
  if (oldFrame) oldFrame.remove();

  if (placeholder) {
    placeholder.style.display = 'flex';
    placeholder.innerHTML = `
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
    `;
  }

  resetBridge();
}

function showViewerSyncHint() {
  if (isHost || roomId === 'solo' || !placeholder) return;

  placeholder.style.display = 'flex';
  placeholder.innerHTML = `
    <div>
      <h2>Серия загружена</h2>
      <p>Если видео не стартовало автоматически, нажмите по плееру один раз. После первого запуска синхронизация станет стабильнее.</p>
    </div>
  `;
}

function createFreshIframe(embedUrl) {
  const oldFrame = document.getElementById('videoFrame');
  if (oldFrame) oldFrame.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'videoFrame';
  iframe.src = normalizeUrl(embedUrl);
  iframe.allow = 'autoplay; fullscreen; picture-in-picture';
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('loading', 'eager');
  iframe.setAttribute('referrerpolicy', 'origin');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.style.display = 'block';

  if (placeholder?.parentNode) {
    placeholder.parentNode.appendChild(iframe);
  }

  return iframe;
}

function detectPlayerType(embedUrl) {
  const full = String(embedUrl || '').toLowerCase();
  const selected = String(selectedPlayer || '').toLowerCase();

  if (full.includes('kodikplayer.com') || full.includes('kodik') || selected.includes('kodik')) return 'kodik';
  if (full.includes('alloha') || full.includes('iframecvh') || selected.includes('alloha')) return 'alloha';
  if (full.includes('sibnet') || selected.includes('sibnet')) return 'sibnet';
  if (full.includes('cvh') || selected.includes('cvh')) return 'cvh';
  return 'unknown';
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

function getIframeElement() {
  return document.getElementById('videoFrame');
}

function ensureBridgeWindow() {
  const iframe = getIframeElement();
  if (iframe?.contentWindow) {
    bridge.iframeWindow = iframe.contentWindow;
  }
}

function postToIframe(payload) {
  ensureBridgeWindow();

  if (!bridge.iframeWindow) return false;

  try {
    bridge.iframeWindow.postMessage(payload, '*');
    return true;
  } catch {
    return false;
  }
}

function postKodikCommand(value) {
  return postToIframe({
    key: 'kodik_player_api',
    value
  });
}

function sendPlayToIframe() {
  if (bridge.playerType === 'kodik') {
    postKodikCommand({ method: 'play' });
  }
}

function sendPauseToIframe() {
  if (bridge.playerType === 'kodik') {
    postKodikCommand({ method: 'pause' });
  }
}

function sendSeekToIframe(time) {
  if (bridge.playerType === 'kodik') {
    postKodikCommand({ method: 'seek', seconds: Number(time) || 0 });
  }
}

function requestKodikTime() {
  if (bridge.playerType === 'kodik') {
    postKodikCommand({ method: 'get_time' });
  }
}

function getLocalPlaybackSnapshot() {
  const playback = currentState.playback || {
    paused: true,
    currentTime: null,
    updatedAt: Date.now()
  };

  let currentTime = typeof playback.currentTime === 'number' && !Number.isNaN(playback.currentTime)
    ? playback.currentTime
    : null;

  const paused = !!playback.paused;
  const updatedAt = Number(playback.updatedAt || Date.now()) || Date.now();

  if (currentTime !== null && !paused) {
    currentTime += (Date.now() - updatedAt) / 1000;
  }

  return {
    paused,
    currentTime,
    updatedAt: Date.now()
  };
}

function applyPlaybackState(playback, options = {}) {
  if (!playback) return;

  ensureBridgeWindow();

  if (!bridge.iframeWindow) {
    pendingPlaybackApply = playback;
    return;
  }

  let targetTime = playback.currentTime;
  const paused = typeof playback.paused === 'boolean' ? playback.paused : true;
  const updatedAt = Number(playback.updatedAt || 0) || 0;

  if (typeof targetTime !== 'number' || Number.isNaN(targetTime)) {
    targetTime = null;
  }

  if (targetTime === null && !paused) return;
  if (targetTime !== null && targetTime < 0.3 && !options.forceZero) return;

  if (targetTime !== null && !paused && updatedAt) {
    targetTime += (Date.now() - updatedAt) / 1000;
  }

  const localSnapshot = getLocalPlaybackSnapshot();
  const localTime = typeof localSnapshot.currentTime === 'number' ? localSnapshot.currentTime : 0;
  const drift = targetTime === null ? 0 : Math.abs(localTime - targetTime);

  isRemoteAction = true;

  if (targetTime !== null && (drift > 1.2 || options.forceSeek)) {
    sendSeekToIframe(targetTime);
  }

  if (paused) {
    if (!options.skipPause) {
      setTimeout(() => {
        sendPauseToIframe();
      }, 150);
    }
  } else {
    if (isHost || roomId === 'solo' || userInteractedWithPlayer) {
      setTimeout(() => {
        sendPlayToIframe();
      }, 150);
    } else {
      showViewerSyncHint();
    }
  }

  setTimeout(() => {
    isRemoteAction = false;
  }, 1000);
}

function applyPlaybackStateWhenReady(playback, attempts = 10, options = {}) {
  if (!playback) return;

  const tryApply = () => {
    ensureBridgeWindow();

    if (bridge.iframeWindow) {
      applyPlaybackState(playback, options);
      pendingPlaybackApply = null;
      return;
    }

    if (attempts <= 0) {
      pendingPlaybackApply = playback;
      return;
    }

    attempts -= 1;
    setTimeout(tryApply, 700);
  };

  tryApply();
}

function loadIframe(embedUrl, title) {
  if (!embedUrl) {
    showPlaceholder('Серия не запущена', 'У серии отсутствует iframe');
    return;
  }

  stopKodikTimePolling();
  resetBridge();

  const iframe = createFreshIframe(embedUrl);
  bridge.playerType = detectPlayerType(embedUrl);

  if (placeholder) {
    placeholder.style.display = 'none';
  }

  if (nowPlayingText) {
    nowPlayingText.textContent = title || 'Без названия';
  }

  iframe.addEventListener('load', () => {
    ensureBridgeWindow();

    if (bridge.playerType === 'kodik') {
      startKodikTimePolling();
      setTimeout(() => requestKodikTime(), 1200);
    }

    if (pendingPlaybackApply) {
      setTimeout(() => applyPlaybackStateWhenReady(pendingPlaybackApply, 10, { forceSeek: true }), 1000);
    }

    if (!isHost && roomId !== 'solo') {
      setTimeout(() => {
        if (!userInteractedWithPlayer) {
          showViewerSyncHint();
        }
      }, 1800);
    }
  });
}

function startKodikTimePolling() {
  stopKodikTimePolling();

  kodikTimeRequestTimer = setInterval(() => {
    if (!currentState.embedUrl) return;
    if (bridge.playerType !== 'kodik') return;
    requestKodikTime();
  }, 3000);
}

function stopKodikTimePolling() {
  if (kodikTimeRequestTimer) {
    clearInterval(kodikTimeRequestTimer);
    kodikTimeRequestTimer = null;
  }
}

function renderUsers(users) {
  if (!usersList) return;

  if (!Array.isArray(users) || users.length === 0) {
    usersList.innerHTML = `<div class="empty-state">Пока никого нет</div>`;
    return;
  }

  usersList.innerHTML = users.map(user => `
    <div class="user-item">
      <div class="user-main">
        <span>${escapeHtml(user.username)}</span>
        ${user.isHost ? `<span class="host-label">Хост</span>` : ''}
      </div>
      <div class="user-status">${escapeHtml(user.watchStatus || 'Не начал')}</div>
    </div>
  `).join('');
}

function renderSelectedAnimeInfo(anime) {
  if (!selectedAnimeInfo) return;

  selectedAnimeInfo.innerHTML = `
    <div class="selected-anime-card" style="display:flex;gap:16px;align-items:flex-start;">
      ${anime.poster ? `
        <img
          src="${escapeHtml(anime.poster)}"
          alt="${escapeHtml(anime.title)}"
          loading="lazy"
          style="width:120px;min-width:120px;height:170px;object-fit:cover;border-radius:12px;background:#111827;"
        >
      ` : ''}
      <div style="min-width:0;">
        <h3 style="margin:0 0 10px;">${escapeHtml(anime.title)}</h3>
        <div style="color:#9fb0d3;margin-bottom:10px;">
          ${escapeHtml(anime.year || '')}
          ${anime.type ? ` • ${escapeHtml(anime.type)}` : ''}
          ${anime.status ? ` • ${escapeHtml(anime.status)}` : ''}
        </div>
        <p style="margin:0;line-height:1.6;">${escapeHtml(anime.description || 'Описание отсутствует')}</p>
      </div>
    </div>
  `;
}

function renderAnimeResults(items) {
  if (!animeList) return;

  if (!items.length) {
    animeList.innerHTML = `<div class="empty-state">Ничего не найдено</div>`;
    return;
  }

  animeList.innerHTML = items.map(item => `
    <button
      type="button"
      class="anime-card ${item.animeUrl === selectedAnime?.animeUrl ? 'active' : ''}"
      data-anime-url="${escapeHtml(item.animeUrl)}"
    >
      <div class="anime-card-content">
        ${item.poster ? `<img class="anime-card-poster" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)}" loading="lazy">` : ''}
        <div class="anime-card-info">
          <div class="anime-card-title">${escapeHtml(item.title)}</div>
          <div class="anime-card-subtitle">
            ${escapeHtml(item.year || '')}${item.type ? ` • ${escapeHtml(item.type)}` : ''}
          </div>
        </div>
      </div>
    </button>
  `).join('');

  animeList.querySelectorAll('button').forEach(btn => {
    btn.disabled = !canControl();
    btn.addEventListener('click', async () => {
      const animeUrl = btn.dataset.animeUrl;
      await selectAnime(animeUrl);
    });
  });
}

function renderPlayers(videos) {
  if (!playerList) return;

  const players = getUniquePlayers(videos);

  if (!players.length) {
    playerList.innerHTML = `<div class="empty-state">Нет доступных плееров</div>`;
    return;
  }

  playerList.innerHTML = players.map(player => `
    <button
      type="button"
      class="episode-btn ${player.name === selectedPlayer ? 'active' : ''}"
      data-player="${escapeHtml(player.name)}"
    >
      ${escapeHtml(player.name)} (${player.count})
    </button>
  `).join('');

  playerList.querySelectorAll('button').forEach(btn => {
    btn.disabled = !canControl();
    btn.addEventListener('click', () => {
      selectedPlayer = btn.dataset.player;
      renderPlayers(selectedAnime?.videos || []);
      const videosByPlayer = getVideosBySelectedPlayer(selectedAnime?.videos || []);
      const episodes = getUniqueEpisodes(videosByPlayer);
      renderEpisodes(episodes);
    });
  });
}

function renderEpisodes(episodes) {
  if (!episodesList) return;

  if (!episodes.length) {
    episodesList.innerHTML = `<div class="empty-state">Серий для этого плеера нет</div>`;
    return;
  }

  episodesList.innerHTML = episodes.map(episode => `
    <button
      type="button"
      class="episode-btn ${episode.episodeNumber === currentState.episodeNumber ? 'active' : ''}"
      data-episode="${episode.episodeNumber}"
    >
      Серия ${episode.episodeNumber}
    </button>
  `).join('');

  episodesList.querySelectorAll('button').forEach(btn => {
    btn.disabled = !canControl();
    btn.addEventListener('click', () => {
      const episodeNumber = Number(btn.dataset.episode);
      const videos = getVideosBySelectedPlayer(selectedAnime?.videos || []);
      const episode = getUniqueEpisodes(videos).find(v => v.episodeNumber === episodeNumber);

      if (!episode) return;

      const embedUrl = getIframeUrl(episode);
      const title = `${selectedAnime?.title || 'Аниме'} — серия ${episodeNumber}`;

      lastHostKnownTime = null;

      currentState = {
        animeId: selectedAnime?.animeId ?? null,
        animeUrl: selectedAnime?.animeUrl ?? null,
        episodeNumber,
        embedUrl,
        title,
        duration: 0,
        playback: {
          paused: true,
          currentTime: null,
          updatedAt: Date.now()
        }
      };

      userInteractedWithPlayer = canControl();
      loadIframe(embedUrl, title);
      renderEpisodes(getUniqueEpisodes(videos));

      if (roomId !== 'solo') {
        socket.emit('change-video', {
          roomId,
          videoSrc: embedUrl,
          embedUrl,
          title,
          animeId: currentState.animeId,
          animeUrl: currentState.animeUrl,
          episodeNumber: currentState.episodeNumber
        });
      }
    });
  });
}

async function searchAnime(query) {
  if (!query || query.trim().length < 2) {
    if (animeList) animeList.innerHTML = '';
    if (searchStatus) searchStatus.textContent = 'Введите минимум 2 символа';
    return;
  }

  if (!canControl()) return;

  if (searchStatus) {
    searchStatus.textContent = 'Поиск...';
  }

  try {
    const response = await fetch(`/api/yummy/search?q=${encodeURIComponent(query.trim())}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || 'Ошибка поиска');
    }

    lastSearchResults = Array.isArray(data) ? data : [];
    renderAnimeResults(lastSearchResults);

    if (searchStatus) {
      searchStatus.textContent = lastSearchResults.length
        ? `Найдено: ${lastSearchResults.length}`
        : 'Ничего не найдено';
    }
  } catch (error) {
    if (searchStatus) {
      searchStatus.textContent = error.message || 'Ошибка поиска';
    }
    if (animeList) {
      animeList.innerHTML = '';
    }
  }
}

async function selectAnime(animeUrl) {
  if (!animeUrl || !canControl()) return;

  if (selectedAnimeInfo) {
    selectedAnimeInfo.innerHTML = 'Загрузка...';
  }

  if (playerList) {
    playerList.innerHTML = `<div class="empty-state">Загрузка плееров...</div>`;
  }

  if (episodesList) {
    episodesList.innerHTML = `<div class="empty-state">Сначала выберите плеер</div>`;
  }

  try {
    const response = await fetch(`/api/yummy/anime/${encodeURIComponent(animeUrl)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || 'Не удалось загрузить аниме');
    }

    selectedAnime = {
      ...data,
      videos: Array.isArray(data?.videos) ? data.videos : []
    };

    selectedPlayer = null;
    currentState.episodeNumber = null;

    renderSelectedAnimeInfo(selectedAnime);
    renderPlayers(selectedAnime.videos);
    episodesList.innerHTML = `<div class="empty-state">Сначала выберите плеер</div>`;
    renderAnimeResults(lastSearchResults);
  } catch (error) {
    if (selectedAnimeInfo) {
      selectedAnimeInfo.innerHTML = `<div>${escapeHtml(error.message || 'Ошибка')}</div>`;
    }
    if (playerList) {
      playerList.innerHTML = `<div class="empty-state">Не удалось загрузить плееры</div>`;
    }
    if (episodesList) {
      episodesList.innerHTML = `<div class="empty-state">Не удалось загрузить серии</div>`;
    }
  }
}

function startViewerSyncLoop() {
  stopViewerSyncLoop();

  if (roomId === 'solo' || isHost) return;

  viewerAutoSyncTimer = setInterval(() => {
    socket.emit('sync-request', { roomId });
  }, 7000);
}

function stopViewerSyncLoop() {
  if (viewerAutoSyncTimer) {
    clearInterval(viewerAutoSyncTimer);
    viewerAutoSyncTimer = null;
  }
}

window.addEventListener('pointerdown', () => {
  userInteractedWithPlayer = true;
}, { once: false });

window.addEventListener('keydown', () => {
  userInteractedWithPlayer = true;
}, { once: false });

window.addEventListener('message', (event) => {
  try {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    if (payload.key?.startsWith?.('kodik_player_')) {
      const key = payload.key;
      const value = payload.value;

      if (key === 'kodik_player_time_update') {
        const seconds = typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? Number(value)
            : Number(value?.time);

        if (!Number.isNaN(seconds) && seconds >= 0) {
          currentState.playback.currentTime = seconds;
          currentState.playback.updatedAt = Date.now();

          if (isHost || roomId === 'solo') {
            lastHostKnownTime = seconds;
          }
        }
      }

      if (key === 'kodik_player_duration_update') {
        currentState.duration = Number(value) || 0;
      }

      if (!isRemoteAction && roomId !== 'solo' && isHost) {
        if (key === 'kodik_player_play') {
          currentState.playback.paused = false;
          currentState.playback.updatedAt = Date.now();

          if (typeof lastHostKnownTime === 'number') {
            currentState.playback.currentTime = lastHostKnownTime;
          }

          socket.emit('player-control', {
            roomId,
            action: 'play',
            currentTime: typeof currentState.playback.currentTime === 'number'
              ? currentState.playback.currentTime
              : null
          });
        }

        if (key === 'kodik_player_pause') {
          currentState.playback.paused = true;
          currentState.playback.updatedAt = Date.now();

          if (typeof lastHostKnownTime === 'number') {
            currentState.playback.currentTime = lastHostKnownTime;
          }

          socket.emit('player-control', {
            roomId,
            action: 'pause',
            currentTime: typeof currentState.playback.currentTime === 'number'
              ? currentState.playback.currentTime
              : null
          });
        }

        if (key === 'kodik_player_seek') {
          const seekTime = Number(value?.time);
          if (!Number.isNaN(seekTime) && seekTime >= 0) {
            currentState.playback.currentTime = seekTime;
            currentState.playback.updatedAt = Date.now();
            lastHostKnownTime = seekTime;

            socket.emit('player-control', {
              roomId,
              action: 'seek',
              currentTime: seekTime
            });
          }
        }
      }

      if (pendingPlaybackApply) {
        const state = pendingPlaybackApply;
        pendingPlaybackApply = null;
        setTimeout(() => applyPlaybackState(state, { forceSeek: true, skipPause: true }), 250);
      }

      return;
    }
  } catch (error) {
    console.error(error);
  }
});

socket.on('connect', () => {
  sys(`SOCKET connected: ${socket.id}`);

  if (roomId !== 'solo') {
    socket.emit('join-room', {
      roomId,
      username,
      userKey
    });
  } else {
    isHost = true;
    updateControlState();
  }
});

socket.on('disconnect', () => {
  sys('SOCKET disconnected');
  stopViewerSyncLoop();
  stopKodikTimePolling();
});

socket.on('connect_error', (err) => {
  sys(`SOCKET error: ${err?.message || err}`);
});

socket.on('you-are-host', () => {
  isHost = true;
  updateControlState();
  stopViewerSyncLoop();
  sys('Вы назначены хостом');
});

socket.on('sync-state', (state) => {
  isHost = !!state.isHost;
  updateControlState();

  if (isHost) {
    stopViewerSyncLoop();
  } else {
    startViewerSyncLoop();
  }

  currentState = {
    animeId: state.animeId ?? null,
    animeUrl: state.animeUrl ?? null,
    episodeNumber: state.episodeNumber ?? null,
    embedUrl: state.embedUrl ?? null,
    title: state.title ?? null,
    duration: currentState.duration || 0,
    playback: state.playback || {
      paused: true,
      currentTime: null,
      updatedAt: 0
    }
  };

  if (currentState.embedUrl) {
    loadIframe(currentState.embedUrl, currentState.title);

    if (typeof currentState.playback?.currentTime === 'number' && currentState.playback.currentTime > 0.3) {
      pendingPlaybackApply = currentState.playback;
      applyPlaybackStateWhenReady(currentState.playback, 10, {
        forceSeek: true,
        skipPause: true
      });
    }
  } else {
    showPlaceholder('Ничего не выбрано', 'Хост пока не запустил серию');
  }
});

socket.on('video-changed', (state) => {
  currentState = {
    animeId: state.animeId ?? null,
    animeUrl: state.animeUrl ?? null,
    episodeNumber: state.episodeNumber ?? null,
    embedUrl: state.embedUrl ?? null,
    title: state.title ?? null,
    duration: 0,
    playback: state.playback || {
      paused: true,
      currentTime: null,
      updatedAt: 0
    }
  };

  if (currentState.embedUrl) {
    loadIframe(currentState.embedUrl, currentState.title);
  } else {
    showPlaceholder('Ничего не выбрано', 'Хост пока не запустил серию');
  }
});

socket.on('player-control', ({ action, currentTime, paused, updatedAt }) => {
  if (roomId === 'solo') return;
  if (isHost) return;

  const safeTime = typeof currentTime === 'number' && !Number.isNaN(currentTime)
    ? currentTime
    : null;

  if (safeTime !== null && safeTime < 0.3 && action !== 'seek') {
    return;
  }

  currentState.playback = {
    paused: typeof paused === 'boolean' ? paused : action === 'pause',
    currentTime: safeTime ?? currentState.playback.currentTime ?? null,
    updatedAt: Number(updatedAt || Date.now()) || Date.now()
  };

  if (action === 'seek') {
    applyPlaybackStateWhenReady(currentState.playback, 10, { forceSeek: true });
    return;
  }

  if (action === 'play') {
    applyPlaybackStateWhenReady(currentState.playback, 10, { skipPause: true });
    return;
  }

  if (action === 'pause') {
    if (safeTime !== null && safeTime > 0.3) {
      applyPlaybackStateWhenReady(currentState.playback, 10);
    }
  }
});

socket.on('room-users', (users) => {
  renderUsers(users);
});

socket.on('system-message', ({ text }) => {
  sys(text);
});

socket.on('chat-message', ({ username, message, time }) => {
  if (!chatMessages || !window.ChatModule) return;
  ChatModule.appendMessage(chatMessages, { username, message, time });
});

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const value = searchInput.value;
    searchDebounce = setTimeout(() => {
      searchAnime(value);
    }, 400);
  });
}

if (syncBtn) {
  syncBtn.addEventListener('click', () => {
    if (bridge.playerType === 'kodik') {
      requestKodikTime();
    }

    if (roomId !== 'solo') {
      socket.emit('sync-request', { roomId });
    }
  });
}

if (copyLinkBtn) {
  copyLinkBtn.addEventListener('click', async () => {
    const inviteUrl = `${window.location.origin}/room/${encodeURIComponent(roomId)}?username=${encodeURIComponent(username)}`;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      sys('Ссылка на комнату скопирована');
    } catch {
      try {
        window.prompt('Скопируйте ссылку вручную:', inviteUrl);
      } catch {
        sys('Не удалось скопировать ссылку');
      }
    }
  });
}

if (cinemaModeBtn) {
  cinemaModeBtn.addEventListener('click', () => {
    roomPage?.classList.toggle('cinema-mode');
  });
}

if (sendBtn && chatInput) {
  sendBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (!message) return;

    if (roomId !== 'solo') {
      socket.emit('chat-message', { roomId, username, message });
    } else if (window.ChatModule && chatMessages) {
      ChatModule.appendMessage(chatMessages, {
        username,
        message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }

    chatInput.value = '';
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBtn.click();
  });
}

statusButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const status = btn.dataset.status || 'Неизвестно';

    if (roomId !== 'solo') {
      socket.emit('update-watch-status', { roomId, status });
    }
  });
});

window.addEventListener('beforeunload', () => {
  stopViewerSyncLoop();
  stopKodikTimePolling();
});

updateControlState();
showPlaceholder('Ничего не выбрано', 'Выберите аниме и серию');
renderUsers([]);