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
  return [...room.users.values()].map(u => ({
    username: u.username,
    isHost: u.userKey === room.hostKey,
    currentTime: u.currentTime || 0,
    playbackPaused: !!u.paused,
    timeUpdatedAt: u.timeUpdatedAt || 0
  }));
}

function emitUsers(io, roomId, room) {
  io.to(roomId).emit('room-users', buildUsersList(room));
}

function registerRoomSockets(io) {

  io.on('connection', (socket) => {

    let currentRoomId = null;
    let currentUserKey = null;

    // 🔗 Вход в комнату
    socket.on('join-room', ({ roomId, username, userKey }) => {
      if (!roomId || !userKey) return;

      currentRoomId = roomId;
      currentUserKey = userKey;

      const room = getRoom(roomId);

      socket.join(roomId);

      // ❗️ ВАЖНО: убираем старое подключение с таким же userKey
      const existingUser = room.users.get(userKey);

      if (existingUser) {
        // удаляем старый сокет
        if (existingUser.socketId && existingUser.socketId !== socket.id) {
          const oldSocket = io.sockets.sockets.get(existingUser.socketId);
          if (oldSocket) oldSocket.disconnect(true);
        }
      }

      room.users.set(userKey, {
        userKey,
        username,
        socketId: socket.id,
        currentTime: 0,
        paused: true,
        timeUpdatedAt: Date.now()
      });

      // 👑 если хоста нет — назначаем
      if (!room.hostKey) {
        room.hostKey = userKey;
        socket.emit('you-are-host');
      }

      // 🔁 отправка состояния
      socket.emit('sync-state', {
        ...room.state,
        isHost: room.hostKey === userKey
      });

      emitUsers(io, roomId, room);
    });

    // 🔄 смена ника
    socket.on('change-username', ({ roomId, username }) => {
      const room = getRoom(roomId);
      const user = room.users.get(currentUserKey);
      if (!user) return;

      user.username = username;
      emitUsers(io, roomId, room);
    });

    // ⏱ обновление времени пользователя
    socket.on('update-user-time', ({ roomId, currentTime, paused }) => {
      const room = getRoom(roomId);
      const user = room.users.get(currentUserKey);
      if (!user) return;

      user.currentTime = currentTime;
      user.paused = paused;
      user.timeUpdatedAt = Date.now();
    });

    // 🎬 смена видео
    socket.on('change-video', (data) => {
      const room = getRoom(data.roomId);

      if (room.hostKey !== currentUserKey) return;

      room.state = {
        animeId: data.animeId,
        animeUrl: data.animeUrl,
        episodeNumber: data.episodeNumber,
        embedUrl: data.embedUrl,
        title: data.title,
        playback: {
          paused: true,
          currentTime: 0,
          updatedAt: Date.now()
        }
      };

      io.to(data.roomId).emit('video-changed', room.state);
    });

    // ▶️ управление плеером
    socket.on('player-control', (data) => {
      const room = getRoom(data.roomId);

      if (room.hostKey !== currentUserKey) return;

      if (typeof data.currentTime === 'number') {
        room.state.playback.currentTime = data.currentTime;
      }

      if (data.action === 'play') room.state.playback.paused = false;
      if (data.action === 'pause') room.state.playback.paused = true;

      room.state.playback.updatedAt = Date.now();

      socket.to(data.roomId).emit('player-control', {
        action: data.action,
        currentTime: room.state.playback.currentTime,
        paused: room.state.playback.paused,
        updatedAt: room.state.playback.updatedAt
      });
    });

    // 🔁 запрос синка
    socket.on('request-sync', ({ roomId }) => {
      const room = getRoom(roomId);

      socket.emit('sync-state', {
        ...room.state,
        isHost: room.hostKey === currentUserKey
      });
    });

    // 💬 чат
    socket.on('chat-message', ({ roomId, username, message }) => {
      io.to(roomId).emit('chat-message', {
        username,
        message,
        time: new Date().toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });
    });

    // ❌ выход
    socket.on('disconnect', () => {
      if (!currentRoomId || !currentUserKey) return;

      const room = getRoom(currentRoomId);
      const user = room.users.get(currentUserKey);

      if (!user) return;

      // удаляем только если это тот же сокет
      if (user.socketId === socket.id) {
        room.users.delete(currentUserKey);

        // если вышел хост — назначаем нового
        if (room.hostKey === currentUserKey) {
          const next = [...room.users.keys()][0];
          room.hostKey = next || null;

          if (next) {
            const nextUser = room.users.get(next);
            const nextSocket = io.sockets.sockets.get(nextUser.socketId);
            if (nextSocket) nextSocket.emit('you-are-host');
          }
        }

        emitUsers(io, currentRoomId, room);
      }
    });

  });
}

module.exports = { registerRoomSockets };

function setupRoomSupportModal() {
  const modal = document.getElementById('roomSupportModal');
  const openBtn = document.getElementById('supportRoomBtn');
  const closeBtn = document.getElementById('closeRoomSupportModalBtn');
  const backdrop = document.getElementById('roomSupportModalBackdrop');

  if (!modal || !openBtn) return;

  const open = () => {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  };

  const close = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  };

  openBtn.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

document.addEventListener('DOMContentLoaded', setupRoomSupportModal);