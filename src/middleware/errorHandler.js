const AppError = require('../utils/AppError');

function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

// Translate known Prisma error codes into clean API responses instead of leaking
// raw database error messages to clients.
function mapPrismaError(err) {
  if (err.code === 'P2002') {
    const field = (err.meta && err.meta.target && err.meta.target[0]) || 'field';
    return AppError.conflict(`A record with this ${field} already exists.`, 'DUPLICATE');
  }
  if (err.code === 'P2025') {
    return AppError.notFound('Requested record was not found.', 'NOT_FOUND');
  }
  return null;
}

function errorHandler(err, req, res, next) {
  let resolvedErr = err;

  if (err.code && err.code.startsWith('P2')) {
    resolvedErr = mapPrismaError(err) || resolvedErr;
  }

  const statusCode = resolvedErr.statusCode || 500;
  const isOperational = resolvedErr.isOperational || false;

  if (!isOperational) {
    // Unexpected/programmer errors: log full detail server-side, never leak to client
    console.error('[UNEXPECTED ERROR]', err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code: resolvedErr.code || 'INTERNAL_ERROR',
      message: isOperational ? resolvedErr.message : 'Something went wrong. Please try again.',
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
