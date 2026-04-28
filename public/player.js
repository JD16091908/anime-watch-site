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

  function normalizeUrl(url) {
    if (!url) return '';
    if (String(url).startsWith('//')) return `https:${url}`;
    return String(url);
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
    const u = String(url || '').toLowerCase();
    if (!u) return 'unknown';
    if (u.includes('kodik')) return 'kodik';
    return 'unknown';
  }

  function extractOverlay(container) {
    if (!container) return null;
    const overlay = container.querySelector('#playerTopOverlay');
    if (overlay && overlay.parentNode === container) {
      overlay.remove();
      return overlay;
    }
    return null;
  }

  function restoreOverlay(container, overlayEl) {
    if (!container || !overlayEl) return;
    if (!container.contains(overlayEl)) {
      container.appendChild(overlayEl);
    }
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
      commandQueue = commandQueue.filter(c => c.method !== method);
      commandQueue.push({ method, params });
      return true;
    }

    const payloads = [
      { source: 'external', method, params },
      { key: 'kodik_player_api', value: { method, params } },
      { method, params }
    ];

    let sent = false;
    for (const payload of payloads) {
      sent = postMessageToIframe(payload) || sent;
    }

    return sent;
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
    iframe.style.borderRadius = '18px';
    iframe.style.background = '#000';

    currentIframe = iframe;
    playerReady = false;
    commandQueue = [];
    lastKnownTime = 0;
    lastKnownDuration = 0;

    if (playerReadyTimer) clearTimeout(playerReadyTimer);

    iframe.addEventListener('load', () => {
      setTimeout(markReady, 800);
    });

    playerReadyTimer = setTimeout(markReady, 2800);

    return iframe;
  }

  function clearPlayer(container) {
    if (!container) return;
    const overlay = extractOverlay(container);

    playerReady = false;
    commandQueue = [];
    lastKnownTime = 0;
    lastKnownDuration = 0;

    if (playerReadyTimer) {
      clearTimeout(playerReadyTimer);
      playerReadyTimer = null;
    }

    currentIframe = null;
    container.innerHTML = '';
    restoreOverlay(container, overlay);
  }

  function mountIframe(container, { src, title } = {}) {
    if (!container) return null;

    const overlay = extractOverlay(container);

    playerReady = false;
    commandQueue = [];
    lastKnownTime = 0;
    lastKnownDuration = 0;

    if (playerReadyTimer) {
      clearTimeout(playerReadyTimer);
      playerReadyTimer = null;
    }

    currentIframe = null;
    container.innerHTML = '';

    const iframe = createIframe({ src, title });

    if (!iframe) {
      const wrapper = document.createElement('div');
      wrapper.className = 'placeholder';
      wrapper.innerHTML = `
        <div class="placeholder-content">
          <h2>${escapeHtml('Ошибка загрузки')}</h2>
          <p>${escapeHtml('Не удалось загрузить плеер')}</p>
        </div>
      `;
      container.appendChild(wrapper);
      restoreOverlay(container, overlay);
      return null;
    }

    container.appendChild(iframe);
    restoreOverlay(container, overlay);
    return iframe;
  }

  function showPlaceholder(container, {
    title = 'Ничего не выбрано',
    description = 'Выберите аниме и серию'
  } = {}) {
    if (!container) return;

    const overlay = extractOverlay(container);

    playerReady = false;
    commandQueue = [];
    lastKnownTime = 0;
    lastKnownDuration = 0;

    if (playerReadyTimer) {
      clearTimeout(playerReadyTimer);
      playerReadyTimer = null;
    }

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
    restoreOverlay(container, overlay);
  }

  function play() {
    sendKodikCommand('play');
    sendKodikCommand('video.play');
    return true;
  }

  function pause() {
    sendKodikCommand('pause');
    sendKodikCommand('video.pause');
    return true;
  }

  function seek(time) {
    const safeTime = Number(time);
    if (Number.isNaN(safeTime) || safeTime < 0) return false;

    lastKnownTime = safeTime;

    sendKodikCommand('setTime', { time: safeTime });
    sendKodikCommand('seek', { time: safeTime });
    sendKodikCommand('video.seek', { time: safeTime });

    return true;
  }

  function seekTo(time) {
    return seek(time);
  }

  function getCurrentTime() {
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
    if (typeof payload === 'number') return payload;

    if (typeof payload === 'string') {
      const n = Number(payload);
      return Number.isFinite(n) ? n : null;
    }

    if (payload && typeof payload === 'object') {
      for (const key of keys) {
        const n = Number(payload[key]);
        if (Number.isFinite(n)) return n;
      }
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

  window.addEventListener('message', (event) => {
    if (!currentIframe || event.source !== currentIframe.contentWindow) return;

    const data = normalizeMessageData(event.data);
    if (!data) return;

    const eventName = data.event || data.type || data.method || data.name;
    const payload = data.payload || data.params || data.value || data.data || data;

    if (
      eventName === 'player:ready' ||
      eventName === 'ready' ||
      eventName === 'kodik:ready'
    ) {
      markReady();
      return;
    }

    if (
      eventName === 'player:time-update' ||
      eventName === 'timeupdate' ||
      eventName === 'time-update' ||
      eventName === 'currentTime'
    ) {
      const seconds = extractNumberFromPayload(payload, ['time', 'currentTime', 'seconds', 'position']);
      if (seconds !== null && seconds >= 0) {
        lastKnownTime = seconds;
        window.dispatchEvent(new CustomEvent('player:time-update', { detail: { time: seconds } }));
      }
      return;
    }

    if (
      eventName === 'player:duration-update' ||
      eventName === 'durationchange' ||
      eventName === 'duration'
    ) {
      const duration = extractNumberFromPayload(payload, ['duration', 'time', 'seconds']);
      if (duration !== null && duration > 0) {
        lastKnownDuration = duration;
        window.dispatchEvent(new CustomEvent('player:duration-update', { detail: { duration } }));
      }
      return;
    }

    if (
      eventName === 'player:play' ||
      eventName === 'play' ||
      eventName === 'video:play'
    ) {
      window.dispatchEvent(new CustomEvent('player:play'));
      return;
    }

    if (
      eventName === 'player:pause' ||
      eventName === 'pause' ||
      eventName === 'video:pause'
    ) {
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