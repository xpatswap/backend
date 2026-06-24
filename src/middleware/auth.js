const { verifyAccessToken } = require('../utils/auth');
const AppError = require('../utils/AppError');
const prisma = require('../config/prisma');

// Requires a valid access token. Attaches req.user = { id, fullName, email, accountType, isActive, emailVerified }
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw AppError.unauthorized('Missing access token');

    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, fullName: true, email: true, accountType: true, isActive: true, emailVerified: true },
    });
    if (!user || !user.isActive) throw AppError.unauthorized('Account not found or disabled');

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(AppError.unauthorized('Access token expired', 'TOKEN_EXPIRED'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(AppError.unauthorized('Invalid access token'));
    }
    next(err);
  }
}

// Only allows users whose vendor status is APPROVED to proceed.
// Must run after requireAuth.
async function requireApprovedVendor(req, res, next) {
  try {
    const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
    if (!vendor || vendor.status !== 'APPROVED') {
      throw AppError.forbidden(
        'Your vendor account must be approved before you can list products.',
        'VENDOR_NOT_APPROVED'
      );
    }
    req.vendorProfile = vendor;
    next();
  } catch (err) {
    next(err);
  }
}

// Simple optional-auth variant: attaches req.user if a valid token is present,
// but does not reject the request if it's missing (useful for public browse endpoints
// that personalize results when logged in, e.g. fairness comparisons).
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next();

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, fullName: true, email: true, accountType: true, isActive: true },
    });
    if (user && user.isActive) req.user = user;
    next();
  } catch {
    next(); // invalid/expired token on an optional route — just proceed unauthenticated
  }
}

module.exports = { requireAuth, requireApprovedVendor, optionalAuth };
