const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const prisma = require('../config/prisma');

// Admins (the internal review team) use a separate token namespace from regular
// users so a compromised user session can never be used to access admin routes.
async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw AppError.unauthorized('Missing admin token');

    const payload = jwt.verify(token, env.jwt.accessSecret, { audience: 'admin' });
    const admin = await prisma.admin.findUnique({ where: { id: payload.sub } });
    if (!admin) throw AppError.unauthorized('Admin not found');

    req.admin = admin;
    next();
  } catch (err) {
    next(AppError.unauthorized('Invalid or expired admin session'));
  }
}

module.exports = { requireAdmin };
