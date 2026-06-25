const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());
  // Accepts requests from:
  // 1. CLIENT_ORIGIN env variable (your deployed frontend URL)
  // 2. Any *.railway.app domain (for Railway-hosted frontends)
  // 3. localhost / 127.0.0.1 on any port (local dev)
  // 4. file:// (origin: null) — opening the HTML file directly in a browser
  const allowedOrigins = [
    env.clientOrigin,
    /^https?:\/\/[\w-]+\.railway\.app$/,
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  ];
  app.use(cors({
    origin: (origin, callback) => {
      if(!origin) return callback(null, true); // file://, curl, mobile apps, etc.
      const allowed = allowedOrigins.some(o => o instanceof RegExp ? o.test(origin) : o === origin);
      callback(null, allowed);
    },
    credentials: true,
  }));
  // Serve the frontend HTML directly from the backend (for Railway single-service deploy)
  app.use(express.static(require('path').join(__dirname, '../public')));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

  const globalLimiter = rateLimit({ windowMs: env.rateLimit.windowMs, max: env.rateLimit.max });
  app.use('/api', globalLimiter);

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
