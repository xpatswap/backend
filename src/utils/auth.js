const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const env = require('../config/env');

const SALT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signAccessToken(payload) {
  return jwt.sign(payload, env.jwt.accessSecret, { expiresIn: env.jwt.accessExpiresIn });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpiresIn });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

// Refresh tokens are stored hashed in the DB (never store the raw token),
// so a leaked database doesn't directly expose usable session tokens.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
};
