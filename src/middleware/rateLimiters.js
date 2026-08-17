const rateLimit = require('express-rate-limit');
const config = require('../config/env');

const message = (text) => ({ success: false, message: text });

/**
 * Login and registration get a much tighter budget than the global limiter.
 * These are the endpoints worth attacking: everything else needs a session
 * first.
 */
const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failures count toward the limit
  message: message('Too many login attempts. Please try again later.'),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('Too many accounts created from this address. Please try again later.'),
});

/**
 * Password reset is deliberately strict. The endpoint always returns success
 * to avoid revealing which addresses are registered, which also makes it a
 * free email-sending service if left unthrottled.
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('Too many password reset requests. Please try again later.'),
});

module.exports = { loginLimiter, registerLimiter, passwordResetLimiter };
