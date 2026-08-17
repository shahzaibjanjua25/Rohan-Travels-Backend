const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/env');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [80, 'Name cannot exceed 80 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      // Never returned by a normal query. Use .select('+password') to load it.
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: ['user', 'admin'],
        message: 'Role must be either user or admin',
      },
      default: 'user',
    },
    phone: {
      type: String,
      trim: true,
      match: [/^[+]?[\d\s()-]{7,20}$/, 'Please provide a valid phone number'],
    },
    avatar: {
      url: String,
      publicId: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: Date,

    // Per-account brute-force protection. IP rate limiting alone is not
    // enough: an attacker with a botnet spreads attempts across thousands of
    // addresses, and every one stays under a per-IP limit while hammering a
    // single account.
    loginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },

    // Set whenever the password changes. Any token issued before this instant
    // is rejected by the auth middleware, so a password change logs out every
    // other device.
    passwordChangedAt: Date,

    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

userSchema.index({ role: 1, isActive: 1 });

userSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'user',
});

/** Hash the password on create and on any change to it. */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, config.bcryptRounds);

  // Backdate by 1s. JWT `iat` has second precision, and without this a token
  // issued in the same second as a signup can look "older" than the password.
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);

  return next();
});

/** Timing-safe password check. */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** True if the password changed after the given JWT was issued. */
userSchema.methods.changedPasswordAfter = function changedPasswordAfter(jwtIssuedAt) {
  if (!this.passwordChangedAt) return false;
  const changedAtSeconds = Math.floor(this.passwordChangedAt.getTime() / 1000);
  return jwtIssuedAt < changedAtSeconds;
};

/**
 * Returns the plaintext reset token to email the user. Only its SHA-256 hash
 * is stored, so a leaked database does not hand out working reset links.
 */
userSchema.methods.createPasswordResetToken = function createPasswordResetToken() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
  return resetToken;
};

const MAX_LOGIN_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockUntil && this.lockUntil > Date.now());
});

/**
 * Record a failed attempt, locking the account once the threshold is hit.
 * Uses an atomic $inc rather than read-modify-write so concurrent attempts
 * cannot race each other into an undercount.
 */
userSchema.methods.registerFailedLogin = async function registerFailedLogin() {
  // A lock that has already expired resets the counter rather than adding to it.
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } });
  }

  const update = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS && !this.isLocked) {
    update.$set = { lockUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) };
  }
  return this.updateOne(update);
};

userSchema.methods.clearLoginAttempts = function clearLoginAttempts() {
  return this.updateOne({
    $set: { loginAttempts: 0, lastLoginAt: new Date() },
    $unset: { lockUntil: 1 },
  });
};

/** Strip sensitive fields from anything serialised to a client. */
userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  delete obj.passwordChangedAt;
  delete obj.loginAttempts;
  delete obj.lockUntil;
  delete obj.__v;
  return obj;
};

userSchema.statics.MAX_LOGIN_ATTEMPTS = MAX_LOGIN_ATTEMPTS;
userSchema.statics.LOCK_MINUTES = LOCK_MINUTES;

module.exports = mongoose.model('User', userSchema);
