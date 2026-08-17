/**
 * AppError
 *
 * Errors we throw on purpose, as opposed to bugs. `isOperational` is the flag
 * the error handler uses to decide whether a message is safe to show a client.
 * Anything without it is treated as an unexpected failure and its details are
 * hidden in production.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.status = String(statusCode).startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = 'Bad request', details) {
    return new AppError(msg, 400, details);
  }

  static unauthorized(msg = 'Not authenticated') {
    return new AppError(msg, 401);
  }

  static forbidden(msg = 'You do not have permission to perform this action') {
    return new AppError(msg, 403);
  }

  static notFound(msg = 'Resource not found') {
    return new AppError(msg, 404);
  }

  static conflict(msg = 'Resource conflict') {
    return new AppError(msg, 409);
  }
}

module.exports = AppError;
