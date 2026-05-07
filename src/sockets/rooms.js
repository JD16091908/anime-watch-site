const rooms = new Map();
// roomId -> { users: Map(userKey -> user), hostKey, state, cleanupTimer }

const ROOM_EMPTY_TTL_MS = 30 * 60 * 1000;

const EMPTY_PLAYBACK = () => ({
  paused: true,
  currentTime: 0,
  updatedAt: Date.now()
});

function createEmptyState() {
  return {
    animeId: null,
    animeUrl: null,
    episodeNumber: null,
    embedUrl: null,
    title: null,
    playback: EMPTY_PLAYBACK()
  };
}

function sanitizeRoomId(roomId) {
  return String(roomId || '').trim().slice(0, 120);
}

function sanitizeUsername(username) {
  const name = String(username || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  return name || 'Гость';
}

function sanitizeUserKey(userKey) {
  return String(userKey || '').trim().slice(0, 120);
}

function normalizeTime(value, fallback = 0) {
  const time = Number(value);
  if (!Number.isFinite(time) || time < 0) return fallback;
  return time;
}

function clearRoomCleanup(room) {
  if (!room?.cleanupTimer) return;

  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
}

function scheduleRoomCleanup(roomId, room) {
  clearRoomCleanup(room);

  room.cleanupTimer = setTimeout(() => {
    const currentRoom = rooms.get(roomId);

    if (!currentRoom) return;
    if (currentRoom.users.size > 0) return;

    rooms.delete(roomId);
  }, ROOM_EMPTY_TTL_MS);
}

function getRoom(roomId) {
  const safeRoomId = sanitizeRoomId(roomId);

  if (!rooms.has(safeRoomId)) {
    rooms.set(safeRoomId, {
      users: new Map(),
      hostKey: null,
      state: createEmptyState(),
      cleanupTimer: null
    });
  }

  const room = rooms.get(safeRoomId);
  clearRoomCleanup(room);

  return room;
}

function getEffectivePlayback(playback) {
  const safe = playback || EMPTY_PLAYBACK();
  const currentTime = normalizeTime(safe.currentTime, 0);
  const updatedAt = Number(safe.updatedAt || Date.now()) || Date.now();
  const paused = !!safe.paused;

  if (paused) {
    return {
      paused,
      currentTime,
      updatedAt
    };
  }

  const elapsed = Math.max(0, (Date.now() - updatedAt) / 1000);

  return {
    paused,
    currentTime: currentTime + elapsed,
    updatedAt: Date.now()
  };
}

function buildUsersList(room) {
  return [...room.users.values()].map((user) => ({
    username: user.username,
    isHost: user.userKey === room.hostKey,
    currentTime: normalizeTime(user.currentTime, 0),
    playbackPaused: !!user.paused,
    timeUpdatedAt: user.timeUpdatedAt || 0
  }));
}

function emitUsers(io, roomId, room) {
  io.to(roomId).emit('room-users', buildUsersList(room));
}

function emitSyncToSocket(socket, room, userKey) {
  socket.emit('sync-state', {
    ...room.state,
    playback: getEffectivePlayback(room.state.playback),
    isHost: room.hostKey === userKey
  });
}

function emitHostStatusToSocket(socket, room, userKey) {
  if (room.hostKey !== userKey) return;
  socket.emit('you-are-host');
}

function setInitialHostIfNeeded(room, userKey) {
  if (room.hostKey) return;
  room.hostKey = userKey;
}

function registerRoomSockets(io) {
  io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUserKey = null;

    socket.on('join-room', ({ roomId, username, userKey }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      const safeUserKey = sanitizeUserKey(userKey);

      if (!safeRoomId || !safeUserKey) return;

      currentRoomId = safeRoomId;
      currentUserKey = safeUserKey;

      const room = getRoom(safeRoomId);
      const existingUser = room.users.get(safeUserKey);

      if (existingUser?.socketId && existingUser.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingUser.socketId);
        if (oldSocket) oldSocket.disconnect(true);
      }

      socket.join(safeRoomId);

      room.users.set(safeUserKey, {
        userKey: safeUserKey,
        username: sanitizeUsername(username),
        socketId: socket.id,
        currentTime: normalizeTime(existingUser?.currentTime, 0),
        paused: existingUser?.paused ?? true,
        timeUpdatedAt: existingUser?.timeUpdatedAt || Date.now()
      });

      setInitialHostIfNeeded(room, safeUserKey);
      emitHostStatusToSocket(socket, room, safeUserKey);
      emitSyncToSocket(socket, room, safeUserKey);
      emitUsers(io, safeRoomId, room);
    });

    socket.on('change-username', ({ roomId, username }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      const user = room.users.get(currentUserKey);
      if (!user || user.socketId !== socket.id) return;

      user.username = sanitizeUsername(username);
      emitUsers(io, safeRoomId, room);
    });

    socket.on('update-user-time', ({ roomId, currentTime, paused }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      const user = room.users.get(currentUserKey);
      if (!user || user.socketId !== socket.id) return;

      user.currentTime = normalizeTime(currentTime, user.currentTime || 0);
      user.paused = !!paused;
      user.timeUpdatedAt = Date.now();

      emitUsers(io, safeRoomId, room);
    });

    socket.on('change-video', (data = {}) => {
      const safeRoomId = sanitizeRoomId(data.roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      if (room.hostKey !== currentUserKey) return;

      room.state = {
        animeId: data.animeId ?? null,
        animeUrl: data.animeUrl ?? null,
        episodeNumber: data.episodeNumber ?? null,
        embedUrl: data.embedUrl ?? null,
        title: data.title ?? null,
        playback: EMPTY_PLAYBACK()
      };

      io.to(safeRoomId).emit('video-changed', room.state);
    });

    socket.on('player-control', (data = {}) => {
      const safeRoomId = sanitizeRoomId(data.roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      if (room.hostKey !== currentUserKey) return;

      const playback = room.state.playback || EMPTY_PLAYBACK();

      if (typeof data.currentTime === 'number' && !Number.isNaN(data.currentTime)) {
        playback.currentTime = normalizeTime(data.currentTime, playback.currentTime || 0);
      }

      if (data.action === 'play') playback.paused = false;
      if (data.action === 'pause') playback.paused = true;
      if (data.action === 'seek') playback.currentTime = normalizeTime(data.currentTime, playback.currentTime || 0);
      if (typeof data.paused === 'boolean') playback.paused = data.paused;

      playback.updatedAt = Date.now();
      room.state.playback = playback;

      socket.to(safeRoomId).emit('player-control', {
        action: data.action,
        currentTime: playback.currentTime,
        paused: playback.paused,
        updatedAt: playback.updatedAt
      });
    });

    socket.on('request-sync', ({ roomId }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      emitHostStatusToSocket(socket, room, currentUserKey);
      emitSyncToSocket(socket, room, currentUserKey);
    });

    socket.on('chat-message', ({ roomId, username, message }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      const safeMessage = String(message || '').trim().slice(0, 300);

      if (!safeRoomId || !safeMessage) return;

      io.to(safeRoomId).emit('chat-message', {
        username: sanitizeUsername(username),
        message: safeMessage,
        time: new Date().toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });
    });

    socket.on('disconnect', () => {
      if (!currentRoomId || !currentUserKey) return;

      const room = rooms.get(currentRoomId);
      if (!room) return;

      const user = room.users.get(currentUserKey);
      if (!user || user.socketId !== socket.id) return;

      room.users.delete(currentUserKey);

      // ВАЖНО:
      // Хоста больше НЕ передаём следующему пользователю.
      // room.hostKey остаётся закреплённым за тем же userKey.
      // Если хост обновит страницу или временно выйдет, он вернётся хостом.
      emitUsers(io, currentRoomId, room);

      if (room.users.size === 0) {
        scheduleRoomCleanup(currentRoomId, room);
      }
    });
  });
}

module.exports = { registerRoomSockets };