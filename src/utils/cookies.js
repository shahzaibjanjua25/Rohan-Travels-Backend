// backend/src/utils/cookies.js
//
// Express 4's res.cookie() cannot emit the `Partitioned` attribute (it landed in
// cookie@0.7 / Express 5). Partitioned (CHIPS) is what keeps a SameSite=None
// cookie alive in Chrome/Edge once third-party cookies are restricted, which is
// exactly the failure mode that was producing intermittent 403s.
//
// So we build the Set-Cookie header by hand.

const config = require('../config/env');

/**
 * @param {import('express').Response} res
 * @param {string} name
 * @param {string} value
 * @param {object} opts
 * @param {boolean} [opts.httpOnly]
 * @param {number}  [opts.maxAge]     milliseconds
 * @param {string}  [opts.path]
 */
const writeCookie = (res, name, value, opts = {}) => {
  const {
    httpOnly = false,
    maxAge,
    path = '/',
  } = opts;

  const secure = config.cookie.secure;
  const sameSite = config.cookie.sameSite; // 'none' | 'lax' | 'strict'

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];

  if (typeof maxAge === 'number') {
    parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
    parts.push(`Expires=${new Date(Date.now() + maxAge).toUTCString()}`);
  }
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (config.cookie.domain) parts.push(`Domain=${config.cookie.domain}`);

  // Capitalise for the wire: None / Lax / Strict
  parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);

  // Partitioned is only legal (and only useful) with SameSite=None; Secure.
  // Browsers that don't know it ignore it, so this is safe to always send.
  if (sameSite === 'none' && secure) parts.push('Partitioned');

  res.append('Set-Cookie', parts.join('; '));
};

const clearCookie = (res, name, opts = {}) => {
  writeCookie(res, name, '', { ...opts, maxAge: 0 });
};

module.exports = { writeCookie, clearCookie };