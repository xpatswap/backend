const AppError = require('../utils/AppError');

// Usage: validate(schema, 'body' | 'query' | 'params')
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      const message = error.details.map((d) => d.message).join('; ');
      return next(AppError.badRequest(message, 'VALIDATION_ERROR'));
    }
    req[source] = value;
    next();
  };
}

module.exports = validate;
