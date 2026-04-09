const USERNAME_STORAGE = 'username';

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

function generateRandomNickname() {
  const adj = ['Swift', 'Silent', 'Crimson', 'Shadow', 'Wild', 'Epic', 'Neon', 'Velvet'];
  const noun = ['Fox', 'Wolf', 'Dragon', 'Ninja', 'Hunter', 'Blade', 'Star', 'Ghost'];
  return `${adj[Math.floor(Math.random() * adj.length)]} ${noun[Math.floor(Math.random() * noun.length)]}`;
}

function getSavedUsername() {
  const saved = sanitizeUsername(safeLocalStorageGet(USERNAME_STORAGE));
  if (saved) return saved;
  const generated = generateRandomNickname();
  safeLocalStorageSet(USERNAME_STORAGE, generated);
  return generated;
}

function generateSecureToken(length = 24) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function redirectToRoom(roomId, username, accessToken = '') {
  const params = new URLSearchParams();
  if (username) params.set('username', username);
  if (accessToken) params.set('access', accessToken);
  window.location.href = `/room/${roomId}?${params.toString()}`;
}

function removeLegacyJoinControls() {
  const legacyJoinBtn = document.getElementById('joinRoomBtn');
  const legacyRoomInput = document.getElementById('roomId');
  if (legacyJoinBtn) legacyJoinBtn.remove();
  if (legacyRoomInput) {
    const wrapper = legacyRoomInput.closest('.form-group') || legacyRoomInput.parentElement;
    if (wrapper) wrapper.remove();
  }
}

function setupHomeActions() {
  removeLegacyJoinControls();

  const usernameInput = document.getElementById('username');
  const createRoomBtn = document.getElementById('createRoomBtn');
  const soloWatchBtn = document.getElementById('soloWatchBtn');

  if (!usernameInput || !createRoomBtn || !soloWatchBtn) return;

  usernameInput.value = getSavedUsername();

  const getUsername = () => {
    const u = sanitizeUsername(usernameInput.value) || generateRandomNickname();
    safeLocalStorageSet(USERNAME_STORAGE, u);
    return u;
  };

  createRoomBtn.addEventListener('click', () => {
    const roomId = `r_${generateSecureToken(24)}`;
    const access = generateSecureToken(32);
    redirectToRoom(roomId, getUsername(), access);
  });

  soloWatchBtn.addEventListener('click', () => {
    redirectToRoom('solo', getUsername());
  });
}

document.addEventListener('DOMContentLoaded', setupHomeActions);