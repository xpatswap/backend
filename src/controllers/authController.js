const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { hashPassword, verifyPassword, signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require('../utils/auth');
const { generateOtp, hashOtp, otpExpiryDate } = require('../utils/otp');
const { sendOtpEmail } = require('../services/emailService');
const env = require('../config/env');

function issueTokenPair(user) {
  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  const refreshToken = signRefreshToken({ sub: user.id });
  return { accessToken, refreshToken };
}

async function persistRefreshToken(userId, refreshToken, deviceInfo) {
  const decoded = verifyRefreshToken(refreshToken);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(decoded.exp * 1000),
      deviceInfo: deviceInfo || null,
    },
  });
}

// POST /api/auth/register
// Creates the user account (unverified) and sends a 6-digit OTP to their email.
// The account is NOT usable (cannot log in) until the OTP is confirmed.
const REFERRAL_BONUS_NAIRA = 1000; // credited to the referrer when their code is used at signup

async function generateUniqueReferralCode(fullName) {
  const namePart = (fullName || 'USER').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5) || 'USER';
  for (let attempt = 0; attempt < 10; attempt++) {
    const randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    const code = `${namePart}${randPart}`;
    const existing = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  // astronomically unlikely fallback
  return `${namePart}${Date.now().toString(36).toUpperCase()}`;
}

const register = asyncHandler(async (req, res) => {
  const { fullName, email, phone, dob, address, password, accountType, referralCode, bankAccounts } = req.body;

  // Validate bank accounts (1 required, max 2)
  if (!bankAccounts || !Array.isArray(bankAccounts) || bankAccounts.length === 0) {
    throw AppError.badRequest('At least one bank account is required for withdrawals.', 'BANK_ACCOUNT_REQUIRED');
  }
  if (bankAccounts.length > 2) {
    throw AppError.badRequest('You can register a maximum of 2 bank accounts.', 'TOO_MANY_BANK_ACCOUNTS');
  }
  for (const acct of bankAccounts) {
    if (!acct.bankName || !acct.accountNumber || !acct.accountName) {
      throw AppError.badRequest('Each bank account must include bank name, account number, and account name.', 'INVALID_BANK_ACCOUNT');
    }
    if (!/^\d{10}$/.test(acct.accountNumber)) {
      throw AppError.badRequest('Bank account number must be exactly 10 digits.', 'INVALID_ACCOUNT_NUMBER');
    }
  }

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing) {
    throw AppError.conflict('An account with this email or phone number already exists.', 'ACCOUNT_EXISTS');
  }

  let referrer = null;
  if (referralCode) {
    referrer = await prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
    // An unrecognized referral code is not a hard failure — registration still proceeds,
    // it's just not linked to anyone. This avoids blocking signups over a typo.
  }

  const passwordHash = await hashPassword(password);
  const newReferralCode = await generateUniqueReferralCode(fullName);

  const user = await prisma.user.create({
    data: {
      fullName,
      email,
      phone,
      dob: new Date(dob),
      address,
      passwordHash,
      accountType,
      emailVerified: false,
      referralCode: newReferralCode,
      referredById: referrer ? referrer.id : null,
    },
  });

  if (referrer) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: referrer.id },
        data: { walletBalance: { increment: REFERRAL_BONUS_NAIRA } },
      }),
      prisma.walletTransaction.create({
        data: {
          userId: referrer.id,
          amount: REFERRAL_BONUS_NAIRA,
          type: 'REFERRAL_BONUS',
          description: `Referral bonus: ${fullName} signed up using your code`,
          relatedUserId: user.id,
        },
      }),
      prisma.notification.create({
        data: {
          userId: referrer.id,
          type: 'SYSTEM',
          title: 'Referral bonus credited! 🎉',
          body: `${fullName} joined using your code — ₦${REFERRAL_BONUS_NAIRA.toLocaleString('en-NG')} added to your wallet.`,
        },
      }),
    ]);
  }

  // Save registered bank accounts (max 2)
  for (let i = 0; i < bankAccounts.length; i++) {
    const acct = bankAccounts[i];
    await prisma.bankAccount.create({
      data: {
        userId: user.id,
        bankName: acct.bankName,
        accountNumber: acct.accountNumber,
        accountName: acct.accountName,
        isDefault: i === 0, // first account is default
      },
    });
  }

  // If they chose a vendor account type, pre-create the VendorProfile shell
  // (status NONE) so the vendor-docs step has somewhere to write to.
  if (accountType === 'SELL_ONLY' || accountType === 'SELL_SWAP') {
    await prisma.vendorProfile.create({
      data: { userId: user.id, businessName: fullName, status: 'NONE' },
    });
  }

  await issueAndSendOtp(user.id, user.email);

  res.status(201).json({
    success: true,
    data: {
      userId: user.id,
      email: user.email,
      message: 'Account created. Check your email for a 6-digit verification code.',
    },
  });
});

async function issueAndSendOtp(userId, email) {
  const code = generateOtp();
  await prisma.otpCode.create({
    data: {
      userId,
      codeHash: hashOtp(code),
      purpose: 'EMAIL_VERIFY',
      expiresAt: otpExpiryDate(),
    },
  });
  await sendOtpEmail(email, code);
}

// POST /api/auth/verify-otp
const verifyOtp = asyncHandler(async (req, res) => {
  const { userId, code } = req.body;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound('Account not found');
  if (user.emailVerified) throw AppError.badRequest('Email is already verified.', 'ALREADY_VERIFIED');

  const otp = await prisma.otpCode.findFirst({
    where: { userId, purpose: 'EMAIL_VERIFY', consumed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw AppError.badRequest('No verification code found. Please request a new one.', 'OTP_NOT_FOUND');

  if (otp.expiresAt < new Date()) {
    throw AppError.badRequest('This code has expired. Please request a new one.', 'OTP_EXPIRED');
  }
  if (otp.attempts >= env.otp.maxAttempts) {
    throw AppError.badRequest('Too many incorrect attempts. Please request a new code.', 'OTP_LOCKED');
  }

  if (otp.codeHash !== hashOtp(code)) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw AppError.badRequest("That code didn't match — please try again.", 'OTP_MISMATCH');
  }

  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } }),
    prisma.user.update({ where: { id: userId }, data: { emailVerified: true } }),
  ]);

  const tokens = issueTokenPair(user);
  await persistRefreshToken(user.id, tokens.refreshToken, req.headers['user-agent']);

  const vendorProfile = await prisma.vendorProfile.findUnique({ where: { userId } });
  const referralCount = await prisma.user.count({ where: { referredById: userId } });

  res.json({
    success: true,
    data: {
      ...tokens,
      user: publicUser(user, true, referralCount),
      vendorProfile: vendorProfile ? publicVendorProfile(vendorProfile) : null,
    },
  });
});

// POST /api/auth/resend-otp
const resendOtp = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound('Account not found');
  if (user.emailVerified) throw AppError.badRequest('Email is already verified.', 'ALREADY_VERIFIED');

  const lastOtp = await prisma.otpCode.findFirst({
    where: { userId, purpose: 'EMAIL_VERIFY' },
    orderBy: { createdAt: 'desc' },
  });
  if (lastOtp) {
    const secondsSinceLast = (Date.now() - lastOtp.createdAt.getTime()) / 1000;
    if (secondsSinceLast < env.otp.resendCooldownSeconds) {
      const wait = Math.ceil(env.otp.resendCooldownSeconds - secondsSinceLast);
      throw AppError.badRequest(`Please wait ${wait}s before requesting another code.`, 'OTP_COOLDOWN');
    }
  }

  await issueAndSendOtp(user.id, user.email);
  res.json({ success: true, data: { message: 'A new verification code has been sent.' } });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw AppError.unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) throw AppError.unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');

  if (!user.emailVerified) {
    // Allow login attempt to surface a clear, specific error so the client can
    // redirect straight to the OTP screen instead of a generic auth failure.
    throw AppError.forbidden('Please verify your email before logging in.', 'EMAIL_NOT_VERIFIED');
  }
  if (!user.isActive) throw AppError.forbidden('This account has been disabled.', 'ACCOUNT_DISABLED');

  const tokens = issueTokenPair(user);
  await persistRefreshToken(user.id, tokens.refreshToken, req.headers['user-agent']);

  await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

  const vendorProfile = await prisma.vendorProfile.findUnique({ where: { userId: user.id } });
  const referralCount = await prisma.user.count({ where: { referredById: user.id } });

  res.json({
    success: true,
    data: {
      ...tokens,
      user: publicUser(user, true, referralCount),
      vendorProfile: vendorProfile ? publicVendorProfile(vendorProfile) : null,
    },
  });
});

// POST /api/auth/refresh
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token.', 'INVALID_REFRESH_TOKEN');
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw AppError.unauthorized('Refresh token is no longer valid. Please log in again.', 'INVALID_REFRESH_TOKEN');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw AppError.unauthorized('Account not found or disabled.');

  // Rotate: revoke the old refresh token, issue a brand new pair
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const tokens = issueTokenPair(user);
  await persistRefreshToken(user.id, tokens.refreshToken, req.headers['user-agent']);

  res.json({ success: true, data: tokens });
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken) },
      data: { revoked: true },
    });
  }
  res.json({ success: true, data: { message: 'Logged out.' } });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const vendorProfile = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const referralCount = await prisma.user.count({ where: { referredById: req.user.id } });
  res.json({
    success: true,
    data: { user: publicUser(user, true, referralCount), vendorProfile: vendorProfile ? publicVendorProfile(vendorProfile) : null },
  });
});

function publicUser(user, includePrivate = false, referralCount = 0) {
  return {
    id: user.id,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    accountType: user.accountType,
    createdAt: user.createdAt,
    referralCode: user.referralCode,
    walletBalance: user.walletBalance,
    referralCount,
    ...(includePrivate ? { email: user.email, phone: user.phone, address: user.address, emailVerified: user.emailVerified } : {}),
  };
}

function publicVendorProfile(vendor) {
  return {
    businessName: vendor.businessName,
    bio: vendor.bio,
    shopAddress: vendor.shopAddress,
    shopEmail: vendor.shopEmail,
    status: vendor.status,
    rejectionReason: vendor.rejectionReason,
  };
}

module.exports = { register, verifyOtp, resendOtp, login, refresh, logout, me, publicUser, publicVendorProfile };
