// Wraps an async route handler so any thrown error / rejected promise
// is automatically forwarded to Express's error-handling middleware,
// instead of requiring try/catch in every single controller function.
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
