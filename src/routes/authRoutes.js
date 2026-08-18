// backend/src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const {
  registerRules,
  loginRules,
  updateProfileRules,
  updatePasswordRules,
  forgotPasswordRules,
  resetPasswordRules,
} = require('../validators/authValidators');
const validate = require('../middleware/validate');

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

// Register
router.post('/register', registerRules, validate, authController.register);

// Login
router.post('/login', loginRules, validate, authController.login);

// Forgot password
router.post('/forgot-password', forgotPasswordRules, validate, authController.forgotPassword);

// Reset password
router.post('/reset-password', resetPasswordRules, validate, authController.resetPassword);

// OTP Routes - PUBLIC (no auth required)
router.post('/check-email', authController.checkEmail);
router.post('/request-otp', authController.requestOTP);
router.post('/verify-otp', authController.verifyOTP);
router.post('/get-user-name', authController.getUserName);

// Get CSRF token
router.get('/csrf', authController.getCsrfToken);

// ============================================
// PROTECTED ROUTES (require authentication)
// ============================================

// All routes below this line require authentication
router.use(protect);

// Get current user
router.get('/me', authController.getMe);

// Update profile
router.patch('/me', updateProfileRules, validate, authController.updateMe);

// Update password
router.patch('/password', updatePasswordRules, validate, authController.updatePassword);

// Logout
router.post('/logout', authController.logout);

module.exports = router;