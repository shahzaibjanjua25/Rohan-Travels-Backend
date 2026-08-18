// backend/src/controllers/authController.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { User, OTP } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { signAccessToken, setAuthCookie, clearAuthCookie } = require('../utils/token');
const { issueToken: issueCsrfToken, CSRF_COOKIE } = require('../middleware/csrf');
const { sendEmail } = require('../config/email');
const config = require('../config/env');

/**
 * A valid bcrypt hash of a value nobody will guess.
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

  const invalid = () => AppError.unauthorized('Invalid email or password');

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
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

/** PATCH /api/auth/me */
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
 * ✅ FIXED: Use issueCsrfToken instead of issueToken
 */
// backend/src/controllers/authController.js
// ... other imports

/**
 * GET /api/auth/csrf
 * Always returns the current CSRF token and sets the cookie
 */
exports.getCsrfToken = (req, res) => {
  // Get the token from the cookie or issue a new one
  let token = req.cookies?.[CSRF_COOKIE];

  if (!token) {
    // Issue a new token
    token = issueCsrfToken(res);
  } else {
    // Refresh the cookie with explicit settings
    // Use the same issueToken function to set the cookie correctly
    token = issueCsrfToken(res);
  }

  // Return token in response body AND set cookie
  res.status(200).json({
    success: true,
    csrfToken: token,
    message: 'CSRF token ready'
  });
};
// ============================================
// OTP METHODS
// ============================================

/**
 * POST /api/auth/check-email
 * Check if an email exists in the system
 */
exports.checkEmail = catchAsync(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw AppError.badRequest('Email is required');
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  res.status(200).json({
    exists: !!user,
    email: email,
  });
});

/**
 * POST /api/auth/request-otp
 * Generate and store OTP
 */
exports.requestOTP = catchAsync(async (req, res) => {
  const { email, type = 'verification' } = req.body;

  if (!email) {
    throw AppError.badRequest('Email is required');
  }

  // For reset type, check if user exists
  if (type === 'reset') {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw AppError.badRequest('No account found with this email address.');
    }
  }

  // Generate 6-digit OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOTP = crypto.createHash('sha256').update(otpCode).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Store OTP in database - delete any existing OTPs for this email/type
  await OTP.deleteMany({ email: email.toLowerCase(), type });

  await OTP.create({
    email: email.toLowerCase(),
    otp: hashedOTP,
    type,
    expiresAt,
    isUsed: false,
    attempts: 0,
  });

  // Return the OTP in development for testing
  res.status(200).json({
    success: true,
    message: 'OTP generated successfully.',
    ...(process.env.NODE_ENV === 'development' && { otp: otpCode }),
  });
});

/**
 * POST /api/auth/verify-otp
 * Verify OTP and generate a reset token if valid
 */
exports.verifyOTP = catchAsync(async (req, res) => {
  const { email, otp, type = 'verification' } = req.body;

  if (!email || !otp) {
    throw AppError.badRequest('Email and OTP are required');
  }

  const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

  const record = await OTP.findOne({
    email: email.toLowerCase(),
    type,
    otp: hashedOTP,
    expiresAt: { $gt: new Date() },
    isUsed: false,
  });

  if (!record) {
    // Increment attempts on the most recent OTP for this email
    const latest = await OTP.findOne({
      email: email.toLowerCase(),
      type,
      isUsed: false,
    });

    if (latest) {
      latest.attempts += 1;
      if (latest.attempts >= 5) {
        latest.isUsed = true;
      }
      await latest.save();
    }

    throw AppError.badRequest('Invalid or expired OTP. Please request a new code.');
  }

  // Mark OTP as used
  record.isUsed = true;
  record.usedAt = new Date();
  await record.save();

  // For reset type, generate a temporary reset token
  let resetToken = null;
  if (type === 'reset') {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      resetToken = user.createPasswordResetToken();
      await user.save({ validateBeforeSave: false });
    }
  }

  res.status(200).json({
    success: true,
    message: 'OTP verified successfully.',
    resetToken,
  });
});

/**
 * POST /api/auth/get-user-name
 * Get user name by email
 */
exports.getUserName = catchAsync(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw AppError.badRequest('Email is required');
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw AppError.notFound('User not found');
  }

  res.status(200).json({
    name: user.name,
    email: user.email,
  });
}); 