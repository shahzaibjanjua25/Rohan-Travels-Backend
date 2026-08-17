const jwt = require('jsonwebtoken');
const config = require('../config/env');

const signAccessToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

const verifyAccessToken = (token) => jwt.verify(token, config.jwt.secret);

/**
 * Write the auth cookie.
 *
 * httpOnly means JavaScript cannot read it, so an XSS bug cannot exfiltrate
 * the session. The trade is that the browser now attaches it automatically to
 * cross-site requests, which is what SameSite defends against.
 */
const setAuthCookie = (res, token) => {
  res.cookie(config.cookie.name, token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain: config.cookie.domain,
    path: '/',
    maxAge: parseExpiry(config.jwt.expiresIn),
  });
};

const clearAuthCookie = (res) => {
  res.clearCookie(config.cookie.name, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain: config.cookie.domain,
    path: '/',
  });
};

/** '1d' | '30m' | '900s' -> milliseconds. Keeps cookie and JWT lifetimes aligned. */
function parseExpiry(value) {
  const match = /^(\d+)([smhd])$/.exec(String(value).trim());
  if (!match) return 24 * 60 * 60 * 1000;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Number(match[1]) * units[match[2]];
}

module.exports = { signAccessToken, verifyAccessToken, setAuthCookie, clearAuthCookie };
