// backend/src/models/OTP.js
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true,
  },
  otp: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['verification', 'reset'],
    default: 'verification',
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
    expires: 600, // Auto-delete after 10 minutes (600 seconds)
  },
  isUsed: {
    type: Boolean,
    default: false,
  },
  usedAt: {
    type: Date,
  },
  attempts: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Prevent multiple OTPs for same email and type
otpSchema.index({ email: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('OTP', otpSchema);