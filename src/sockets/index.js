const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/auth');
const env = require('../config/env');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true }, // matches the permissive Express CORS in app.js for local dev
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('Missing auth token'));
      const payload = verifyAccessToken(token);
      socket.userId = payload.sub;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);

    socket.on('community:join', (communityId) => socket.join(`community:${communityId}`));
    socket.on('community:leave', (communityId) => socket.leave(`community:${communityId}`));

    socket.on('thread:join', (threadId) => socket.join(`thread:${threadId}`));
    socket.on('thread:leave', (threadId) => socket.leave(`thread:${threadId}`));
    socket.on('thread:typing', ({ threadId, isTyping }) => {
      socket.to(`thread:${threadId}`).emit('thread:typing', { threadId, userId: socket.userId, isTyping });
    });

    // WebRTC signaling relay only - actual media goes peer-to-peer once connected
    socket.on('call:signal', ({ targetUserId, signal }) => {
      socket.to(`user:${targetUserId}`).emit('call:signal', { fromUserId: socket.userId, signal });
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

module.exports = initSocket;
