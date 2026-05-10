const rooms = new Map();
// roomId -> {
//   users: Map(userKey -> user),
//   hostKey,
//   state,
//   cleanupTimer,
//   createdAt,
//   lastHostSeenAt,
//   adUsers: Set(userKey),
//   resumeAfterAds
// }

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
      cleanupTimer: null,
      createdAt: Date.now(),
      lastHostSeenAt: 0,
      adUsers: new Set(),
      resumeAfterAds: false
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

function setRoomPlayback(room, playbackPatch = {}) {
  const current = getEffectivePlayback(room.state.playback);

  room.state.playback = {
    paused: typeof playbackPatch.paused === 'boolean' ? playbackPatch.paused : current.paused,
    currentTime: normalizeTime(playbackPatch.currentTime, current.currentTime),
    updatedAt: Date.now()
  };

  return room.state.playback;
}

function buildUsersList(room) {
  const hostIsOnline = room.hostKey ? room.users.has(room.hostKey) : false;

  return [...room.users.values()].map((user) => ({
    username: user.username,
    userKey: user.userKey,
    isHost: user.userKey === room.hostKey,
    hostIsOnline,
    currentTime: normalizeTime(user.currentTime, 0),
    playbackPaused: !!user.paused,
    timeUpdatedAt: user.timeUpdatedAt || 0,
    inAdvertisement: room.adUsers.has(user.userKey)
  }));
}

function emitUsers(io, roomId, room) {
  io.to(roomId).emit('room-users', buildUsersList(room));
}

function emitSyncToSocket(socket, room, userKey) {
  socket.emit('sync-state', {
    ...room.state,
    playback: getEffectivePlayback(room.state.playback),
    isHost: room.hostKey === userKey,
    hostKey: room.hostKey,
    hostIsOnline: room.hostKey ? room.users.has(room.hostKey) : false,
    adLock: room.adUsers.size > 0,
    adUsersCount: room.adUsers.size
  });
}

function emitHostStatusToSocket(socket, room, userKey) {
  if (room.hostKey !== userKey) return;
  socket.emit('you-are-host');
}

function setInitialHostIfNeeded(room, userKey) {
  if (room.hostKey) return;

  room.hostKey = userKey;
  room.lastHostSeenAt = Date.now();
}

function isCurrentSocketUser(room, userKey, socketId) {
  const user = room.users.get(userKey);
  return !!user && user.socketId === socketId;
}

function emitPlaybackToRoom(io, roomId, room, action) {
  const playback = getEffectivePlayback(room.state.playback);

  io.to(roomId).emit('player-control', {
    action,
    currentTime: playback.currentTime,
    paused: playback.paused,
    updatedAt: playback.updatedAt,
    hostKey: room.hostKey
  });
}

function handleAdvertisementState(io, roomId, room, userKey, inAdvertisement) {
  if (inAdvertisement) {
    if (!room.adUsers.has(userKey)) {
      room.adUsers.add(userKey);
    }

    const playback = getEffectivePlayback(room.state.playback);

    if (!playback.paused) {
      room.resumeAfterAds = true;
      setRoomPlayback(room, {
        paused: true,
        currentTime: playback.currentTime
      });
    }

    io.to(roomId).emit('room-ad-lock', {
      active: true,
      adUsersCount: room.adUsers.size,
      playback: getEffectivePlayback(room.state.playback)
    });

    emitPlaybackToRoom(io, roomId, room, 'pause');
    emitUsers(io, roomId, room);
    return;
  }

  if (room.adUsers.has(userKey)) {
    room.adUsers.delete(userKey);
  }

  if (room.adUsers.size > 0) {
    io.to(roomId).emit('room-ad-lock', {
      active: true,
      adUsersCount: room.adUsers.size,
      playback: getEffectivePlayback(room.state.playback)
    });

    emitUsers(io, roomId, room);
    return;
  }

  const shouldResume = room.resumeAfterAds;
  room.resumeAfterAds = false;

  io.to(roomId).emit('room-ad-lock', {
    active: false,
    adUsersCount: 0,
    playback: getEffectivePlayback(room.state.playback)
  });

  if (shouldResume) {
    const playback = getEffectivePlayback(room.state.playback);

    setRoomPlayback(room, {
      paused: false,
      currentTime: playback.currentTime
    });

    emitPlaybackToRoom(io, roomId, room, 'play');
  }

  emitUsers(io, roomId, room);
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

      if (room.hostKey === safeUserKey) {
        room.lastHostSeenAt = Date.now();
      }

      emitHostStatusToSocket(socket, room, safeUserKey);
      emitSyncToSocket(socket, room, safeUserKey);
      emitUsers(io, safeRoomId, room);
    });

    socket.on('change-username', ({ roomId, username }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      if (!isCurrentSocketUser(room, currentUserKey, socket.id)) return;

      const user = room.users.get(currentUserKey);
      user.username = sanitizeUsername(username);

      emitUsers(io, safeRoomId, room);
    });

    socket.on('update-user-time', ({ roomId, currentTime, paused }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      if (!isCurrentSocketUser(room, currentUserKey, socket.id)) return;

      const user = room.users.get(currentUserKey);

      user.currentTime = normalizeTime(currentTime, user.currentTime || 0);
      user.paused = !!paused;
      user.timeUpdatedAt = Date.now();

      emitUsers(io, safeRoomId, room);
    });

    socket.on('change-video', (data = {}) => {
      const safeRoomId = sanitizeRoomId(data.roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      if (!isCurrentSocketUser(room, currentUserKey, socket.id)) return;
      if (room.hostKey !== currentUserKey) return;

      room.lastHostSeenAt = Date.now();
      room.adUsers.clear();
      room.resumeAfterAds = false;

      room.state = {
        animeId: data.animeId ?? null,
        animeUrl: data.animeUrl ?? null,
        episodeNumber: data.episodeNumber ?? null,
        embedUrl: data.embedUrl ?? null,
        title: data.title ?? null,
        playback: EMPTY_PLAYBACK()
      };

      io.to(safeRoomId).emit('video-changed', {
        ...room.state,
        hostKey: room.hostKey,
        hostIsOnline: true,
        adLock: false,
        adUsersCount: 0
      });

      emitUsers(io, safeRoomId, room);
    });

    socket.on('player-control', (data = {}) => {
      const safeRoomId = sanitizeRoomId(data.roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      if (!isCurrentSocketUser(room, currentUserKey, socket.id)) return;
      if (room.hostKey !== currentUserKey) return;

      room.lastHostSeenAt = Date.now();

      const currentPlayback = getEffectivePlayback(room.state.playback);
      const currentTime = typeof data.currentTime === 'number' && !Number.isNaN(data.currentTime)
        ? normalizeTime(data.currentTime, currentPlayback.currentTime)
        : currentPlayback.currentTime;

      if (room.adUsers.size > 0 && data.action === 'play') {
        room.resumeAfterAds = true;

        const playback = setRoomPlayback(room, {
          paused: true,
          currentTime
        });

        io.to(safeRoomId).emit('room-ad-lock', {
          active: true,
          adUsersCount: room.adUsers.size,
          playback
        });

        emitPlaybackToRoom(io, safeRoomId, room, 'pause');
        return;
      }

      let paused = currentPlayback.paused;

      if (data.action === 'play') paused = false;
      if (data.action === 'pause') paused = true;
      if (typeof data.paused === 'boolean') paused = data.paused;

      const playback = setRoomPlayback(room, {
        paused,
        currentTime
      });

      io.to(safeRoomId).emit('player-control', {
        action: data.action,
        currentTime: playback.currentTime,
        paused: playback.paused,
        updatedAt: playback.updatedAt,
        hostKey: room.hostKey
      });
    });

    socket.on('viewer-ad-state', ({ roomId, inAdvertisement }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      if (!isCurrentSocketUser(room, currentUserKey, socket.id)) return;

      handleAdvertisementState(io, safeRoomId, room, currentUserKey, !!inAdvertisement);
    });

    socket.on('request-sync', ({ roomId }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      if (!safeRoomId || !currentUserKey) return;

      const room = getRoom(safeRoomId);
      if (!isCurrentSocketUser(room, currentUserKey, socket.id)) return;

      if (room.hostKey === currentUserKey) {
        room.lastHostSeenAt = Date.now();
      }

      emitHostStatusToSocket(socket, room, currentUserKey);
      emitSyncToSocket(socket, room, currentUserKey);
    });

    socket.on('chat-message', ({ roomId, username, message }) => {
      const safeRoomId = sanitizeRoomId(roomId);
      const safeMessage = String(message || '').trim().slice(0, 300);

      if (!safeRoomId || !safeMessage) return;

      const room = getRoom(safeRoomId);
      if (!isCurrentSocketUser(room, currentUserKey, socket.id)) return;

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
      room.adUsers.delete(currentUserKey);

      if (room.hostKey === currentUserKey) {
        room.lastHostSeenAt = Date.now();
      }

      if (room.adUsers.size === 0 && room.resumeAfterAds && room.users.size > 0) {
        room.resumeAfterAds = false;

        const playback = getEffectivePlayback(room.state.playback);

        setRoomPlayback(room, {
          paused: false,
          currentTime: playback.currentTime
        });

        emitPlaybackToRoom(io, currentRoomId, room, 'play');
      }

      emitUsers(io, currentRoomId, room);

      if (room.users.size === 0) {
        scheduleRoomCleanup(currentRoomId, room);
      }
    });
  });
}

module.exports = { registerRoomSockets };