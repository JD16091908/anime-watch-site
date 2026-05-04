window.PlayerModule = (() => {
  let currentIframe = null;
  let isHost = false;
  let onVideoChangedCallback = null;
  let onEndedCallback = null;

  let commandQueue = [];
  let playerReady = false;
  let playerReadyTimer = null;

  let lastKnownTime = 0;
  let lastKnownDuration = 0;
  let lastKnownTimeAt = 0;
  let lastKnownPaused = true;

  let pollingTimer = null;

  function normalizeUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.startsWith('//')) return `https:${value}`;
    return value;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function detectPlayerType(url) {
    const value = String(url || '').toLowerCase();
    if (!value) return 'unknown';
    if (value.includes('kodik')) return 'kodik';
    return 'unknown';
  }

  function postMessageToIframe(payload) {
    if (!currentIframe?.contentWindow) return false;

    let sent = false;

    try {
      currentIframe.contentWindow.postMessage(payload, '*');
      sent = true;
    } catch {}

    try {
      currentIframe.contentWindow.postMessage(JSON.stringify(payload), '*');
      sent = true;
    } catch {}

    return sent;
  }

  function sendKodikCommand(method, params = {}, force = false) {
    if (!currentIframe?.contentWindow) return false;

    if (!playerReady && !force) {
      commandQueue = commandQueue.filter((command) => command.method !== method);
      commandQueue.push({ method, params });
      return true;
    }

    const payloads = [
      { source: 'external', method, params },
      { key: 'kodik_player_api', value: { method, params } },
      { type: 'kodik:api', method, params },
      { method, params }
    ];

    let sent = false;

    for (const payload of payloads) {
      sent = postMessageToIframe(payload) || sent;
    }

    return sent;
  }

  function requestTime() {
    sendKodikCommand('getTime', {}, true);
    sendKodikCommand('getCurrentTime', {}, true);
    sendKodikCommand('video.getCurrentTime', {}, true);
    sendKodikCommand('getDuration', {}, true);
    sendKodikCommand('video.getDuration', {}, true);
  }

  function startPolling() {
    stopPolling();

    pollingTimer = setInterval(() => {
      if (!currentIframe) return;
      requestTime();
    }, 1000);
  }

  function stopPolling() {
    if (!pollingTimer) return;

    clearInterval(pollingTimer);
    pollingTimer = null;
  }

  function flushCommandQueue() {
    const queue = [...commandQueue];
    commandQueue = [];

    for (const { method, params } of queue) {
      sendKodikCommand(method, params, true);
    }
  }

  function markReady() {
    if (playerReady) return;

    playerReady = true;

    if (playerReadyTimer) {
      clearTimeout(playerReadyTimer);
      playerReadyTimer = null;
    }

    flushCommandQueue();
    requestTime();
    startPolling();
  }

  function resetState() {
    playerReady = false;
    commandQueue = [];
    lastKnownTime = 0;
    lastKnownDuration = 0;
    lastKnownTimeAt = 0;
    lastKnownPaused = true;

    if (playerReadyTimer) {
      clearTimeout(playerReadyTimer);
      playerReadyTimer = null;
    }

    stopPolling();
  }

  function createIframe({ src, title = 'Без названия' } = {}) {
    const normalizedSrc = normalizeUrl(src);
    if (!normalizedSrc) return null;

    const iframe = document.createElement('iframe');

    iframe.src = normalizedSrc;
    iframe.title = title;
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('loading', 'eager');
    iframe.setAttribute('referrerpolicy', 'origin');

    iframe.style.display = 'block';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.minHeight = '0';
    iframe.style.border = '0';
    iframe.style.borderRadius = '16px';
    iframe.style.background = '#000';

    currentIframe = iframe;
    resetState();

    iframe.addEventListener('load', () => {
      setTimeout(markReady, 700);
      setTimeout(requestTime, 1200);
      setTimeout(requestTime, 2200);
    });

    playerReadyTimer = setTimeout(markReady, 2600);

    return iframe;
  }

  function clearPlayer(container) {
    if (!container) return;

    resetState();
    currentIframe = null;
    container.innerHTML = '';
  }

  function mountIframe(container, { src, title } = {}) {
    if (!container) return null;

    resetState();
    currentIframe = null;
    container.innerHTML = '';

    const iframe = createIframe({ src, title });

    if (!iframe) {
      showPlaceholder(container, {
        title: 'Ошибка загрузки',
        description: 'Не удалось загрузить плеер'
      });
      return null;
    }

    container.appendChild(iframe);
    return iframe;
  }

  function showPlaceholder(container, {
    title = 'Ничего не выбрано',
    description = 'Выберите аниме и серию'
  } = {}) {
    if (!container) return;

    resetState();
    currentIframe = null;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'placeholder';
    wrapper.innerHTML = `
      <div class="placeholder-content">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
    `;

    container.appendChild(wrapper);
  }

  function play() {
    lastKnownPaused = false;
    lastKnownTimeAt = Date.now();

    sendKodikCommand('play');
    sendKodikCommand('video.play');

    window.dispatchEvent(new CustomEvent('player:local-play'));
    return true;
  }

  function pause() {
    lastKnownTime = getCurrentTime();
    lastKnownPaused = true;
    lastKnownTimeAt = Date.now();

    sendKodikCommand('pause');
    sendKodikCommand('video.pause');

    window.dispatchEvent(new CustomEvent('player:local-pause'));
    return true;
  }

  function seek(time) {
    const safeTime = Number(time);
    if (!Number.isFinite(safeTime) || safeTime < 0) return false;

    lastKnownTime = safeTime;
    lastKnownTimeAt = Date.now();

    sendKodikCommand('setTime', { time: safeTime });
    sendKodikCommand('seek', { time: safeTime });
    sendKodikCommand('video.seek', { time: safeTime });
    sendKodikCommand('setCurrentTime', { time: safeTime });

    window.dispatchEvent(new CustomEvent('player:time-update', {
      detail: { time: safeTime }
    }));

    return true;
  }

  function seekTo(time) {
    return seek(time);
  }

  function getCurrentTime() {
    if (!Number.isFinite(lastKnownTime)) return 0;

    if (!lastKnownPaused && lastKnownTimeAt > 0) {
      return lastKnownTime + Math.max(0, (Date.now() - lastKnownTimeAt) / 1000);
    }

    return lastKnownTime;
  }

  function getDuration() {
    return lastKnownDuration;
  }

  function setHostState(state) {
    isHost = !!state;
  }

  function onVideoChanged(callback) {
    onVideoChangedCallback = typeof callback === 'function' ? callback : null;
  }

  function onEpisodeEnded(callback) {
    onEndedCallback = typeof callback === 'function' ? callback : null;
  }

  function goToNextEpisode() {
    return sendKodikCommand('nextEpisode');
  }

  function extractNumberFromPayload(payload, keys = []) {
    if (typeof payload === 'number') {
      return Number.isFinite(payload) ? payload : null;
    }

    if (typeof payload === 'string') {
      const number = Number(payload);
      return Number.isFinite(number) ? number : null;
    }

    if (!payload || typeof payload !== 'object') return null;

    for (const key of keys) {
      const number = Number(payload[key]);
      if (Number.isFinite(number)) return number;
    }

    if (payload.payload && typeof payload.payload === 'object') {
      const nested = extractNumberFromPayload(payload.payload, keys);
      if (nested !== null) return nested;
    }

    if (payload.data && typeof payload.data === 'object') {
      const nested = extractNumberFromPayload(payload.data, keys);
      if (nested !== null) return nested;
    }

    return null;
  }

  function normalizeMessageData(rawData) {
    if (!rawData) return null;

    if (typeof rawData === 'string') {
      try {
        return JSON.parse(rawData);
      } catch {
        return null;
      }
    }

    if (typeof rawData === 'object') return rawData;
    return null;
  }

  function getEventName(data) {
    return data?.event || data?.type || data?.method || data?.name || data?.key || '';
  }

  function getPayload(data) {
    return data?.payload || data?.params || data?.value || data?.data || data || {};
  }

  function updateTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return;

    lastKnownTime = seconds;
    lastKnownTimeAt = Date.now();

    window.dispatchEvent(new CustomEvent('player:time-update', {
      detail: { time: seconds }
    }));
  }

  function updateDuration(duration) {
    if (!Number.isFinite(duration) || duration <= 0) return;

    lastKnownDuration = duration;

    window.dispatchEvent(new CustomEvent('player:duration-update', {
      detail: { duration }
    }));
  }

  window.addEventListener('message', (event) => {
    if (!currentIframe || event.source !== currentIframe.contentWindow) return;

    const data = normalizeMessageData(event.data);
    if (!data) return;

    const eventName = getEventName(data);
    const payload = getPayload(data);

    if (
      eventName === 'player:ready' ||
      eventName === 'ready' ||
      eventName === 'kodik:ready' ||
      eventName === 'kodik_player_ready'
    ) {
      markReady();
      return;
    }

    if (
      eventName === 'player:time-update' ||
      eventName === 'timeupdate' ||
      eventName === 'time-update' ||
      eventName === 'currentTime' ||
      eventName === 'getTime' ||
      eventName === 'getCurrentTime' ||
      eventName === 'video.getCurrentTime' ||
      eventName === 'kodik_player_time_update'
    ) {
      const seconds = extractNumberFromPayload(payload, [
        'time',
        'currentTime',
        'current_time',
        'seconds',
        'position',
        'value'
      ]);

      if (seconds !== null) updateTime(seconds);
      return;
    }

    if (
      eventName === 'player:duration-update' ||
      eventName === 'durationchange' ||
      eventName === 'duration' ||
      eventName === 'getDuration' ||
      eventName === 'video.getDuration'
    ) {
      const duration = extractNumberFromPayload(payload, [
        'duration',
        'time',
        'seconds',
        'value'
      ]);

      if (duration !== null) updateDuration(duration);
      return;
    }

    if (
      eventName === 'player:play' ||
      eventName === 'play' ||
      eventName === 'video:play' ||
      eventName === 'video.play'
    ) {
      lastKnownPaused = false;
      lastKnownTimeAt = Date.now();

      const seconds = extractNumberFromPayload(payload, [
        'time',
        'currentTime',
        'current_time',
        'seconds',
        'position',
        'value'
      ]);

      if (seconds !== null) updateTime(seconds);

      window.dispatchEvent(new CustomEvent('player:play'));
      return;
    }

    if (
      eventName === 'player:pause' ||
      eventName === 'pause' ||
      eventName === 'video:pause' ||
      eventName === 'video.pause'
    ) {
      const seconds = extractNumberFromPayload(payload, [
        'time',
        'currentTime',
        'current_time',
        'seconds',
        'position',
        'value'
      ]);

      if (seconds !== null) updateTime(seconds);
      else lastKnownTime = getCurrentTime();

      lastKnownPaused = true;
      lastKnownTimeAt = Date.now();

      window.dispatchEvent(new CustomEvent('player:pause'));
      return;
    }

    if (eventName === 'change:episode') {
      if (isHost && onVideoChangedCallback) {
        onVideoChangedCallback({
          type: 'episode',
          season: payload.season,
          episode: payload.episode,
          newUrl: payload.link
        });
      }

      if (!isHost) {
        setTimeout(() => sendKodikCommand('setEpisode', payload, true), 10);
      }

      return;
    }

    if (eventName === 'change:translation') {
      if (isHost && onVideoChangedCallback) {
        onVideoChangedCallback({
          type: 'translation',
          translationId: payload.id,
          translationTitle: payload.title,
          newUrl: payload.link
        });
      }

      if (!isHost) {
        setTimeout(() => sendKodikCommand('setTranslation', payload, true), 10);
      }

      return;
    }

    if (
      eventName === 'ended' ||
      eventName === 'player:ended' ||
      eventName === 'video:ended'
    ) {
      lastKnownPaused = true;
      if (onEndedCallback) onEndedCallback();
      return;
    }

    if (eventName === 'advertisement:end') {
      window.dispatchEvent(new CustomEvent('player:advertisement-ended'));
    }
  });

  return {
    normalizeUrl,
    detectPlayerType,
    createIframe,
    clearPlayer,
    mountIframe,
    showPlaceholder,
    play,
    pause,
    seek,
    seekTo,
    getCurrentTime,
    getDuration,
    setHostState,
    onVideoChanged,
    onEpisodeEnded,
    goToNextEpisode
  };
})();