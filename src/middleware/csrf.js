// backend/src/middleware/csrf.js
const crypto = require('crypto');
const AppError = require('../utils/AppError');
const config = require('../config/env');

const CSRF_COOKIE = 'rt_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// ✅ IMPORTANT: Use a consistent token that doesn't change
let currentToken = null;

const issueToken = (res) => {
  // Generate a new token only if we don't have one
  if (!currentToken) {
    currentToken = crypto.randomBytes(32).toString('hex');
  }
  
  const token = currentToken;
  
  // ✅ CRITICAL: These settings MUST match exactly
  const cookieOptions = {
    httpOnly: false,        // Must be false so JS can read it
    secure: true,           // Must be true for cross-domain
    sameSite: 'none',       // Must be 'none' for cross-domain
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  };

  // Only set domain in production if needed
  if (config.isProd) {
    cookieOptions.domain = '.vercel.app'; // Allow subdomains
  }

  res.cookie(CSRF_COOKIE, token, cookieOptions);
  
  console.log('🔐 CSRF Token Issued:', {
    token: token.substring(0, 10) + '...',
    secure: cookieOptions.secure,
    sameSite: cookieOptions.sameSite,
    domain: cookieOptions.domain || 'not set',
    path: cookieOptions.path,
  });
  
  return token;
};

const ensureCsrfToken = (req, res, next) => {
  // Always set/refresh the token
  const token = issueToken(res);
  console.log('🔐 CSRF Token ensured for:', req.path);
  next();
};

const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

const verifyCsrf = (req, res, next) => {
  // Skip CSRF for safe methods
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  
  // Skip if CSRF is disabled
  if (!config.csrfEnabled) {
    console.log('⚠️ CSRF is disabled, skipping verification');
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  console.log('🔍 CSRF Verification:', {
    path: req.path,
    method: req.method,
    hasCookie: !!cookieToken,
    hasHeader: !!headerToken,
    cookieToken: cookieToken?.substring(0, 10) + '...',
    headerToken: headerToken?.substring(0, 10) + '...',
    cookieFull: cookieToken,
    headerFull: headerToken,
    allCookies: req.cookies,
    headers: req.headers,
  });

  if (!cookieToken) {
    console.error('❌ CSRF: No cookie token found');
    return next(AppError.forbidden('CSRF token missing in cookie. Please refresh the page.'));
  }

  if (!headerToken) {
    console.error('❌ CSRF: No header token found');
    return next(AppError.forbidden('CSRF token missing in header. Please refresh the page.'));
  }

  if (!safeCompare(cookieToken, headerToken)) {
    console.error('❌ CSRF: Token mismatch', {
      cookieLen: cookieToken.length,
      headerLen: headerToken.length,
      cookiePrefix: cookieToken.substring(0, 10),
      headerPrefix: headerToken.substring(0, 10),
    });
    return next(AppError.forbidden('CSRF token mismatch. Please refresh the page.'));
  }

  console.log('✅ CSRF: Valid');
  return next();
};

// Reset token function for testing
const resetCsrfToken = () => {
  currentToken = null;
};

module.exports = { 
  ensureCsrfToken, 
  verifyCsrf, 
  issueToken, 
  CSRF_COOKIE, 
  CSRF_HEADER,
  resetCsrfToken 
};