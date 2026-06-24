const crypto = require('crypto');
const env = require('../config/env');

// Generates a numeric OTP of configured length, e.g. "482913"
function generateOtp() {
  const max = 10 ** env.otp.length;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(env.otp.length, '0');
}

// OTPs are stored hashed (same approach as passwords/refresh tokens) so that
// a database leak alone can't be used to bypass email verification.
function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function otpExpiryDate() {
  return new Date(Date.now() + env.otp.expiryMinutes * 60 * 1000);
}

module.exports = { generateOtp, hashOtp, otpExpiryDate };
