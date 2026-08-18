const crypto = require('crypto');
const AppError = require('../utils/AppError');
const config = require('../config/env');

const CSRF_COOKIE = 'rt_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit cookie CSRF defence.
 *
 * Why this is needed at all: the auth token lives in an httpOnly cookie, and
 * browsers attach cookies to requests automatically regardless of which site
 * initiated them. A form on evil.com POSTing to this API would arrive fully
 * authenticated. (Bearer tokens in a header do not have this problem, which
 * is the trade that came with choosing cookies.)
 *
 * How it works: a random token is issued in a cookie that JavaScript *can*
 * read, and the client must echo it back in a header. Same-origin policy
 * stops evil.com from reading the cookie, so it cannot forge the header.
 *
 * SameSite=lax already blocks most of this. This is the second layer, and it
 * is the only layer if the deployment ever moves to SameSite=none.
 */

const issueToken = (res) => {
  const token = crypto.randomBytes(32).toString('hex');
  console.log('🔄 issueToken called, setting cookie with:', {
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


const ensureCsrfToken = (req, res, next) => {
  console.log('🔄 ensureCsrfToken called, cookie exists?', !!req.cookies?.[CSRF_COOKIE]);
  if (!req.cookies?.[CSRF_COOKIE]) {
    console.log('🔄 No CSRF cookie found, issuing new token');
    issueToken(res);
  } else {
    console.log('🔄 CSRF cookie already exists');
  }
  next();
};

/** Ensure every client holds a CSRF token before it needs one. */
const ensureCsrfToken = (req, res, next) => {
  if (!req.cookies?.[CSRF_COOKIE]) issueToken(res);
  next();
};

const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so compare lengths first —
  // length is not the secret here, the value is.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/** Reject state-changing requests whose header does not match the cookie. */
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
