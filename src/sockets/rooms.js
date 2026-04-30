const rooms = new Map();
// roomId -> { users: Map(userKey -> user), hostKey, state }

function createEmptyState() {
  return {
    animeId: null,
    animeUrl: null,
    episodeNumber: null,
    embedUrl: null,
    title: null,
    playback: {
      paused: true,
      currentTime: 0,
      updatedAt: Date.now()
    }
  };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),
      hostKey: null,
      state: createEmptyState()
    });
  }

  return rooms.get(roomId);
}

function buildUsersList(room) {
  return [...room.users.values()].map((user) => ({
    username: user.username,
    isHost: user.userKey === room.hostKey,
    currentTime: user.currentTime || 0,
    playbackPaused: !!user.paused,
    timeUpdatedAt: user.timeUpdatedAt || 0
  }));
}

function emitUsers(io, roomId, room) {
  io.to(roomId).emit('room-users', buildUsersList(room));
}

function registerRoomSockets(io) {
  io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUserKey = null;

    socket.on('join-room', ({ roomId, username, userKey }) => {
      if (!roomId || !userKey) return;

      currentRoomId = roomId;
      currentUserKey = userKey;

      const room = getRoom(roomId);
      const existingUser = room.users.get(userKey);

      if (existingUser?.socketId && existingUser.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingUser.socketId);
        if (oldSocket) oldSocket.disconnect(true);
      }

      socket.join(roomId);

      room.users.set(userKey, {
        userKey,
        username,
        socketId: socket.id,
        currentTime: existingUser?.currentTime || 0,
        paused: existingUser?.paused ?? true,
        timeUpdatedAt: existingUser?.timeUpdatedAt || Date.now()
      });

      if (!room.hostKey) {
        room.hostKey = userKey;
        socket.emit('you-are-host');
      }

      socket.emit('sync-state', {
        ...room.state,
        isHost: room.hostKey === userKey
      });

      emitUsers(io, roomId, room);
    });

    socket.on('change-username', ({ roomId, username }) => {
      if (!roomId || !currentUserKey) return;

      const room = getRoom(roomId);
      const user = room.users.get(currentUserKey);
      if (!user) return;

      user.username = username;
      emitUsers(io, roomId, room);
    });

    socket.on('update-user-time', ({ roomId, currentTime, paused }) => {
      if (!roomId || !currentUserKey) return;

      const room = getRoom(roomId);
      const user = room.users.get(currentUserKey);
      if (!user) return;

      user.currentTime = Number.isFinite(Number(currentTime)) ? Number(currentTime) : 0;
      user.paused = !!paused;
      user.timeUpdatedAt = Date.now();

      emitUsers(io, roomId, room);
    });

    socket.on('change-video', (data = {}) => {
      const roomId = data.roomId;
      if (!roomId || !currentUserKey) return;

      const room = getRoom(roomId);
      if (room.hostKey !== currentUserKey) return;

      room.state = {
        animeId: data.animeId ?? null,
        animeUrl: data.animeUrl ?? null,
        episodeNumber: data.episodeNumber ?? null,
        embedUrl: data.embedUrl ?? null,
        title: data.title ?? null,
        playback: {
          paused: true,
          currentTime: 0,
          updatedAt: Date.now()
        }
      };

      io.to(roomId).emit('video-changed', room.state);
    });

    socket.on('player-control', (data = {}) => {
      const roomId = data.roomId;
      if (!roomId || !currentUserKey) return;

      const room = getRoom(roomId);
      if (room.hostKey !== currentUserKey) return;

      if (typeof data.currentTime === 'number' && !Number.isNaN(data.currentTime)) {
        room.state.playback.currentTime = data.currentTime;
      }

      if (data.action === 'play') room.state.playback.paused = false;
      if (data.action === 'pause') room.state.playback.paused = true;
      if (typeof data.paused === 'boolean') room.state.playback.paused = data.paused;

      room.state.playback.updatedAt = Date.now();

      socket.to(roomId).emit('player-control', {
        action: data.action,
        currentTime: room.state.playback.currentTime,
        paused: room.state.playback.paused,
        updatedAt: room.state.playback.updatedAt
      });
    });

    socket.on('request-sync', ({ roomId }) => {
      if (!roomId) return;

      const room = getRoom(roomId);

      socket.emit('sync-state', {
        ...room.state,
        isHost: room.hostKey === currentUserKey
      });
    });

    socket.on('chat-message', ({ roomId, username, message }) => {
      if (!roomId || !message) return;

      io.to(roomId).emit('chat-message', {
        username,
        message,
        time: new Date().toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });
    });

    socket.on('disconnect', () => {
      if (!currentRoomId || !currentUserKey) return;

      const room = getRoom(currentRoomId);
      const user = room.users.get(currentUserKey);
      if (!user) return;

      if (user.socketId !== socket.id) return;

      room.users.delete(currentUserKey);

      if (room.hostKey === currentUserKey) {
        const nextUserKey = [...room.users.keys()][0] || null;
        room.hostKey = nextUserKey;

        if (nextUserKey) {
          const nextUser = room.users.get(nextUserKey);
          const nextSocket = io.sockets.sockets.get(nextUser.socketId);

          if (nextSocket) {
            nextSocket.emit('you-are-host');
            nextSocket.emit('sync-state', {
              ...room.state,
              isHost: true
            });
          }
        }
      }

      emitUsers(io, currentRoomId, room);

      if (room.users.size === 0) {
        rooms.delete(currentRoomId);
      }
    });
  });
}

module.exports = { registerRoomSockets };