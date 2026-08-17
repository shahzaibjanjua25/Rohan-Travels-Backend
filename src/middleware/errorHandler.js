const AppError = require('../utils/AppError');
const config = require('../config/env');

/** 404 handler — mounted after all routes. */
const notFound = (req, res, next) => {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

/** Mongoose: malformed ObjectId in a path param. */
const handleCastError = (err) =>
  AppError.badRequest(`Invalid value for '${err.path}'`);

/** Mongoose: unique index violation. */
const handleDuplicateKey = (err) => {
  const field = Object.keys(err.keyValue || {})[0] || 'field';
  return AppError.conflict(`A record with that ${field} already exists`);
};

/** Mongoose: schema validation failure. */
const handleValidationError = (err) => {
  const details = Object.values(err.errors).map((e) => ({
    field: e.path,
    message: e.message,
  }));
  return AppError.badRequest('Validation failed', details);
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let error = err;

  if (err.name === 'CastError') error = handleCastError(err);
  else if (err.code === 11000) error = handleDuplicateKey(err);
  else if (err.name === 'ValidationError') error = handleValidationError(err);
  else if (err.name === 'JsonWebTokenError') error = AppError.unauthorized('Invalid token');
  else if (err.name === 'TokenExpiredError') error = AppError.unauthorized('Session expired, please log in again');
  else if (err.name === 'MulterError') error = AppError.badRequest(`Upload failed: ${err.message}`);

  const statusCode = error.statusCode || 500;
  const isOperational = error.isOperational === true;

  // Unexpected failures get logged in full; the client is told nothing useful.
  if (!isOperational) {
    console.error('[error] Unhandled:', err);
  }

  const body = {
    success: false,
    message: isOperational ? error.message : 'Something went wrong',
  };

  if (error.details) body.details = error.details;
  if (!config.isProd) body.stack = err.stack;

  res.status(statusCode).json(body);
};

module.exports = { errorHandler, notFound };
