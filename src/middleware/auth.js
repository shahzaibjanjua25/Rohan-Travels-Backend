const { User } = require('../models');
const { verifyAccessToken } = require('../utils/token');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const config = require('../config/env');

/**
 * Pull the token from the httpOnly cookie.
 *
 * The Authorization header is also accepted, but only outside production, so
 * Postman and curl stay usable during development without opening a
 * header-based path in a deployed environment.
 */
const extractToken = (req) => {
  if (req.cookies?.[config.cookie.name]) return req.cookies[config.cookie.name];
  if (!config.isProd && req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  return null;
};

/** Require a valid session. Attaches `req.user`. */
const protect = catchAsync(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw AppError.unauthorized('You are not logged in');

  // Throws JsonWebTokenError / TokenExpiredError, both mapped by errorHandler.
  const decoded = verifyAccessToken(token);

  // Re-read the user on every request. A token is a claim about the past; the
  // account may have been deleted, deactivated or demoted since it was issued.
  const user = await User.findById(decoded.sub);
  if (!user) throw AppError.unauthorized('The account for this session no longer exists');
  if (!user.isActive) throw AppError.forbidden('This account has been deactivated');
  if (user.changedPasswordAfter(decoded.iat)) {
    throw AppError.unauthorized('Password was changed recently, please log in again');
  }

  req.user = user;
  return next();
});

/**
 * Restrict to given roles. Always used after `protect`.
 *   router.post('/', protect, authorize('admin'), createFlight);
 */
const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized('You are not logged in'));
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden('You do not have permission to perform this action'));
    }
    return next();
  };

/**
 * Attach `req.user` when a valid session exists, but never reject.
 * Lets a single handler serve both public and privileged views of a resource.
 */
const optionalAuth = catchAsync(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.sub);
    if (user?.isActive && !user.changedPasswordAfter(decoded.iat)) req.user = user;
  } catch {
    // Invalid token on an optional route is simply "not logged in".
  }
  return next();
});

module.exports = { protect, authorize, optionalAuth };
