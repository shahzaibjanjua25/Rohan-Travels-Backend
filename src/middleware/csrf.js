// backend/src/middleware/csrf.js
const crypto = require('crypto');
const AppError = require('../utils/AppError');
const config = require('../config/env');

const CSRF_COOKIE = 'rt_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit cookie CSRF defence.
 */
const issueToken = (res) => {
  const token = crypto.randomBytes(32).toString('hex');
  console.log('🔏 issueToken called, setting cookie with:', {
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain: config.cookie.domain,
    token: token.substring(0, 10) + '...'
  });
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: true,  // Force true
    sameSite: 'none',  // Force none
    domain: undefined,
    path: '/',
  });
  console.log('✅ Cookie set with token:', token.substring(0, 10) + '...');
  return token;
};

// ⚠️ ONLY ONE DECLARATION - KEEP THIS ONE
const ensureCsrfToken = (req, res, next) => {
  console.log('🔏 ensureCsrfToken called, cookie exists?', !!req.cookies?.[CSRF_COOKIE]);
  if (!req.cookies?.[CSRF_COOKIE]) {
    console.log('🔏 No CSRF cookie found, issuing new token');
    issueToken(res);
  } else {
    console.log('🔏 CSRF cookie already exists');
  }
  next();
};

const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const verifyCsrf = (req, res, next) => {
  if (!config.csrfEnabled) return next();
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !safeCompare(cookieToken, headerToken)) {
    return next(
      AppError.forbidden(
        'CSRF token missing or invalid. Send the rt_csrf cookie value in the X-CSRF-Token header.'
      )
    );
  }
  return next();
};

module.exports = { ensureCsrfToken, verifyCsrf, issueToken, CSRF_COOKIE, CSRF_HEADER };