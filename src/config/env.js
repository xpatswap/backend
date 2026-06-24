require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  databaseUrl: required('DATABASE_URL'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET') || 'dev_only_insecure_secret_change_me',
    refreshSecret: required('JWT_REFRESH_SECRET') || 'dev_only_insecure_refresh_change_me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    fromEmail: process.env.SMTP_FROM_EMAIL || 'no-reply@xpatswap.com',
    fromName: process.env.SMTP_FROM_NAME || 'Xpatswap',
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    contactEmail: process.env.VAPID_CONTACT_EMAIL || 'support@xpatswap.com',
  },

  payments: {
    // 'MANUAL' (default, no real money moves through code — admin confirms
    // bank transfers by hand) | 'PAYSTACK' | 'FLUTTERWAVE' (not yet implemented)
    provider: process.env.PAYMENT_PROVIDER || 'MANUAL',
    manualBankName: process.env.MANUAL_BANK_NAME || '',
    manualAccountNumber: process.env.MANUAL_ACCOUNT_NUMBER || '',
    manualAccountName: process.env.MANUAL_ACCOUNT_NAME || '',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 300,
  },

  otp: {
    expiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES) || 10,
    length: Number(process.env.OTP_LENGTH) || 6,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
    resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 30,
  },
};
