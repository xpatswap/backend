class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code = 'BAD_REQUEST') {
    return new AppError(message, 400, code);
  }
  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new AppError(message, 401, code);
  }
  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new AppError(message, 403, code);
  }
  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new AppError(message, 404, code);
  }
  static conflict(message, code = 'CONFLICT') {
    return new AppError(message, 409, code);
  }
  static internal(message = 'Internal server error', code = 'INTERNAL') {
    return new AppError(message, 500, code);
  }
}

module.exports = AppError;
