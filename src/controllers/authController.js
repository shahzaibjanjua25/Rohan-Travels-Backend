const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { User } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { signAccessToken, setAuthCookie, clearAuthCookie } = require('../utils/token');
const { issueToken: issueCsrfToken, CSRF_COOKIE } = require('../middleware/csrf');
const { sendEmail } = require('../config/email');
const config = require('../config/env');

/**
 * A valid bcrypt hash of a value nobody will guess.
 *
 * Compared against when a login names an address that does not exist, so a
 * missing account costs the same ~100ms as a wrong password. Without this,
 * response time alone reveals which addresses are registered.
 */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

/** Issue the session cookie plus a matching CSRF token. */
const startSession = (res, user) => {
  setAuthCookie(res, signAccessToken(user));
  issueCsrfToken(res);
};

/**
 * POST /api/auth/register
 */
exports.register = catchAsync(async (req, res) => {
  const { name, email, password, phone } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw AppError.conflict('An account with that email already exists');

  // Fields are picked explicitly rather than spreading req.body. A spread
  // here is how `role: "admin"` in a signup payload becomes a privilege
  // escalation; the validator rejects it too, but this is the layer that
  // matters if a validator is ever reordered or removed.
  const user = await User.create({ name, email, password, phone, role: 'user' });

  startSession(res, user);
  res.status(201).json({ success: true, data: user });
});

/**
 * POST /api/auth/login
 */
exports.login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');

  // One message for every failure mode below — wrong password, unknown
  // address, deactivated account. Distinguishing them turns the login form
  // into an account-enumeration oracle.
  const invalid = () => AppError.unauthorized('Invalid email or password');

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH); // equalise timing
    throw invalid();
  }

  if (user.isLocked) {
    const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw AppError.forbidden(
      `Account temporarily locked after too many failed attempts. Try again in ${minutes} minute(s).`
    );
  }

  const matches = await user.comparePassword(password);
  if (!matches) {
    await user.registerFailedLogin();
    throw invalid();
  }

  if (!user.isActive) throw invalid();

  await user.clearLoginAttempts();
  startSession(res, user);

  res.status(200).json({ success: true, data: user });
});

/**
 * POST /api/auth/logout
 *
 * The cookie is httpOnly, so the client cannot clear it itself — the server
 * has to. Returns 200 whether or not a session existed.
 */
exports.logout = (req, res) => {
  clearAuthCookie(res);
  res.clearCookie(CSRF_COOKIE, { path: '/' });
  res.status(200).json({ success: true, message: 'Logged out' });
};

/** GET /api/auth/me */
exports.getMe = (req, res) => {
  res.status(200).json({ success: true, data: req.user });
};

/** PATCH /api/auth/me — name and phone only */
exports.updateMe = catchAsync(async (req, res) => {
  const updates = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.phone !== undefined) updates.phone = req.body.phone;

  const user = await User.findByIdAndUpdate(req.user._id, updates, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({ success: true, data: user });
});

/**
 * PATCH /api/auth/password
 *
 * Saving a new password sets passwordChangedAt, which invalidates every token
 * issued before now — including this request's own. A fresh cookie is issued
 * so the current device stays logged in while others are signed out.
 */
exports.updatePassword = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');

  const matches = await user.comparePassword(req.body.currentPassword);
  if (!matches) throw AppError.unauthorized('Your current password is incorrect');

  user.password = req.body.newPassword;
  await user.save();

  startSession(res, user);
  res.status(200).json({ success: true, message: 'Password updated' });
});

/**
 * POST /api/auth/forgot-password
 *
 * Always answers 200 with the same body. Reporting "no such account" here
 * would leak the membership list to anyone with a wordlist.
 */
exports.forgotPassword = catchAsync(async (req, res) => {
  const genericResponse = {
    success: true,
    message: 'If an account exists for that address, a reset link has been sent.',
  };

  const user = await User.findOne({ email: req.body.email });
  if (!user || !user.isActive) return res.status(200).json(genericResponse);

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;

  const result = await sendEmail({
    to: user.email,
    subject: 'Reset your Rohan Travels password',
    text:
      `Hello ${user.name},\n\n` +
      `Use the link below to choose a new password. It expires in 15 minutes ` +
      `and can only be used once.\n\n${resetUrl}\n\n` +
      `If you did not request this, you can ignore this email — your password ` +
      `will not change.\n`,
  });

  // If delivery failed, drop the token rather than leaving a live reset
  // credential attached to an account whose owner never received it.
  if (!result.delivered && config.email.enabled) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
  }

  return res.status(200).json(genericResponse);
});

/**
 * POST /api/auth/reset-password
 */
exports.resetPassword = catchAsync(async (req, res) => {
  // Only the hash is stored, so the incoming token is hashed to look it up.
  const hashed = crypto.createHash('sha256').update(req.body.token).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashed,
    passwordResetExpires: { $gt: Date.now() },
  }).select('+passwordResetToken +passwordResetExpires');

  if (!user) throw AppError.badRequest('That reset link is invalid or has expired');

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();

  startSession(res, user);
  res.status(200).json({ success: true, message: 'Password reset successfully' });
});

/**
 * GET /api/auth/csrf
 *
 * The cookie is set by ensureCsrfToken on every request; this endpoint just
 * gives the SPA something explicit to call on boot.
 */
exports.getCsrfToken = (req, res) => {
  res.status(200).json({ success: true, message: 'CSRF cookie set' });
};
