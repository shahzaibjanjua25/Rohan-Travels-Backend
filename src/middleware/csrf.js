// backend/src/middleware/csrf.js
//
// WHY THIS WAS REWRITTEN
// ----------------------
// The old version held the token in a module-level `let currentToken`. On
// Vercel the API runs as serverless functions, so every warm instance had its
// own value. `ensureCsrfToken` was also mounted globally, meaning EVERY request
// re-sent Set-Cookie. The result: instance A issues token A (frontend caches
// A), the next request lands on instance B and overwrites the browser cookie
// with B, the login POST then sends header=A / cookie=B -> 403. That is the
// "works for a while, then breaks again" pattern.
//
// THE NEW MODEL
// -------------
// Tokens are stateless and self-verifying:
//
//     token = nonce . expiry . HMAC-SHA256(CSRF_SECRET, "nonce.expiry")
//
// CSRF_SECRET is an env var, so every serverless instance — cold, warm, or
// brand new — validates every other instance's tokens. There is no shared
// memory to drift.
//
// Defence is layered, so no single browser quirk can lock a user out:
//
//   1. Origin / Referer allowlist  <- the real CSRF defence (OWASP). A cross-
//      site attacker cannot forge these, and they need no cookies at all.
//   2. Signed token in the X-CSRF-Token header  <- proves the client actually
//      called our /auth/csrf endpoint.
//   3. Double-submit cookie match  <- enforced ONLY when the cookie is present
//      and itself valid. If the browser dropped the cookie (third-party cookie
//      blocking), layers 1 and 2 still hold and we degrade instead of 403ing.

const crypto = require('crypto');
const AppError = require('../utils/AppError');
const config = require('../config/env');
const { writeCookie, clearCookie } = require('../utils/cookies');

const CSRF_COOKIE = 'rt_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// ---------------------------------------------------------------------------
// Token creation / verification
// ---------------------------------------------------------------------------

const sign = (payload) =>
  crypto.createHmac('sha256', config.csrfSecret).update(payload).digest('hex');

const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

const createToken = () => {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = `${nonce}.${expiry}`;
  return `${payload}.${sign(payload)}`;
};

/** Structurally valid, correctly signed, and not expired. */
const isValidToken = (token) => {
  if (typeof token !== 'string' || token.length > 256) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [nonce, expiry, mac] = parts;
  if (!/^[0-9a-f]{32}$/.test(nonce)) return false;
  if (!/^[0-9a-f]{64}$/.test(mac)) return false;

  const expiryMs = Number(expiry);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;

  return safeCompare(mac, sign(`${nonce}.${expiry}`));
};

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------

/**
 * Accepts exact origins from CORS_ORIGINS, plus an optional wildcard form
 * (`https://*.vercel.app`) so Vercel preview deployments keep working.
 */
const originMatches = (origin, pattern) => {
  if (pattern === origin) return true;
  if (!pattern.includes('*')) return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+');
  return new RegExp(`^${escaped}$`).test(origin);
};

const isAllowedOrigin = (origin) =>
  config.corsOrigins.some((pattern) => originMatches(origin, pattern));

/** Origin, falling back to Referer's origin. null when neither is present. */
const requestOrigin = (req) => {
  const origin = req.get('origin');
  if (origin && origin !== 'null') return origin;

  const referer = req.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Issue a token and set the cookie.
 *
 * Reuses the existing cookie when it is still valid — this is what stops the
 * cookie value from churning underneath a frontend that has already cached it.
 */
const issueToken = (req, res) => {
  // Called as issueToken(res) in older code — tolerate both signatures.
  if (res === undefined) {
    res = req;
    req = null;
  }

  const existing = req?.cookies?.[CSRF_COOKIE];
  if (existing && isValidToken(existing)) return existing;

  const token = createToken();
  writeCookie(res, CSRF_COOKIE, token, {
    httpOnly: false, // the frontend must be able to read it
    maxAge: TOKEN_TTL_MS,
    path: '/',
  });
  return token;
};

/**
 * Mount this ONLY on GET /api/auth/csrf — never globally. Mounting it globally
 * is what caused the cookie to be rewritten on every single request.
 */
const ensureCsrfToken = (req, res, next) => {
  res.locals.csrfToken = issueToken(req, res);
  next();
};

/** AppError.forbidden() takes only a message, so attach the code separately. */
const csrfError = (message, code) => {
  const err = AppError.forbidden(message);
  err.code = code;
  return err;
};

const verifyCsrf = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!config.csrfEnabled) return next();

  // --- Layer 1: Origin ------------------------------------------------------
  const origin = requestOrigin(req);

  // A browser always sends Origin on POST/PUT/PATCH/DELETE. No Origin means the
  // caller is curl, a mobile app, or the integration test suite — none of which
  // are CSRF-reachable, since CSRF requires a browser to be tricked.
  if (origin && !isAllowedOrigin(origin)) {
    return next(csrfError('Request origin is not allowed.', 'CSRF_BAD_ORIGIN'));
  }

  // --- Layer 2: signed header token ----------------------------------------
  const headerToken = req.get(CSRF_HEADER);

  if (!headerToken) {
    return next(
      csrfError('Security token missing. Please refresh and try again.', 'CSRF_MISSING')
    );
  }

  if (!isValidToken(headerToken)) {
    return next(
      csrfError(
        'Security token expired or invalid. Please refresh and try again.',
        'CSRF_INVALID'
      )
    );
  }

  // --- Layer 3: double-submit, best-effort ----------------------------------
  const cookieToken = req.cookies?.[CSRF_COOKIE];

  if (cookieToken && isValidToken(cookieToken) && !safeCompare(cookieToken, headerToken)) {
    // Both are legitimately signed but differ — a stale tab, or two tabs racing.
    // Recoverable: clear the cookie so the next /auth/csrf issues a clean one.
    clearCookie(res, CSRF_COOKIE, { path: '/' });
    return next(
      csrfError('Security token out of sync. Please refresh and try again.', 'CSRF_MISMATCH')
    );
  }

  // cookieToken absent => third-party cookies blocked. Layers 1 + 2 stand.
  return next();
};

// Kept for the existing test suite; stateless tokens have nothing to reset.
const resetCsrfToken = () => {};

module.exports = {
  ensureCsrfToken,
  verifyCsrf,
  issueToken,
  createToken,
  isValidToken,
  CSRF_COOKIE,
  CSRF_HEADER,
  resetCsrfToken,
};