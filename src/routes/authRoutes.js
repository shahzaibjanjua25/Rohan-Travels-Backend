const express = require('express');

const ctrl = require('../controllers/authController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { loginLimiter, registerLimiter, passwordResetLimiter } = require('../middleware/rateLimiters');
const {
  registerRules,
  loginRules,
  updateProfileRules,
  updatePasswordRules,
  forgotPasswordRules,
  resetPasswordRules,
} = require('../validators/authValidators');

const router = express.Router();

router.get('/csrf', ctrl.getCsrfToken);

router.post('/register', registerLimiter, registerRules, validate, ctrl.register);
router.post('/login', loginLimiter, loginRules, validate, ctrl.login);
router.post('/logout', ctrl.logout);

router.post('/forgot-password', passwordResetLimiter, forgotPasswordRules, validate, ctrl.forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPasswordRules, validate, ctrl.resetPassword);

router.get('/me', protect, ctrl.getMe);
router.patch('/me', protect, updateProfileRules, validate, ctrl.updateMe);
router.patch('/password', protect, updatePasswordRules, validate, ctrl.updatePassword);

module.exports = router;
