const http = require('http');
const { Server } = require('socket.io');

const app = require('./src/app');
const { PORT, isAllowedOrigin } = require('./src/server-config');
const { registerRoomSockets } = require('./src/sockets/rooms');

const server = http.createServer(app);

const io = new Server(server, {
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000,
  cors: {
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed'), false);
    },
    credentials: true
  },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback('Origin not allowed', false);
  }
});

registerRoomSockets(io);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});