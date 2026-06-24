const http = require('http');
const createApp = require('./app');
const initSocket = require('./sockets');
const env = require('./config/env');
const prisma = require('./config/prisma');

async function start() {
  const app = createApp();
  const server = http.createServer(app);

  const io = initSocket(server);
  app.set('io', io);

  server.listen(env.port, () => {
    console.log(`Xpatswap API listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
