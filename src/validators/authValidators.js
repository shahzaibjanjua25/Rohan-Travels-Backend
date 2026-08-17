const { body } = require('express-validator');

/**
 * Password policy.
 *
 * Length is weighted over character-class gymnastics: "correct horse battery
 * staple" beats "P@ss1!" by a wide margin, and complexity rules mostly push
 * people toward predictable substitutions. A 10-character floor plus a check
 * against the obvious choices is the useful part.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'letmein123', 'iloveyou1', 'admin123', 'welcome123', 'passw0rd',
  'football1', 'monkey123', 'abc12345', 'changeme', 'rohantravels',
]);

const passwordRule = (field = 'password') =>
  body(field)
    .isString()
    .isLength({ min: 10, max: 128 })
    .withMessage('Password must be between 10 and 128 characters')
    .bail()
    .custom((value) => {
      if (COMMON_PASSWORDS.has(value.toLowerCase())) {
        throw new Error('That password is too common, please choose another');
      }
      if (/^(.)\1+$/.test(value)) {
        throw new Error('Password cannot be a single repeated character');
      }
      return true;
    });

const emailRule = body('email')
  .trim()
  .toLowerCase()
  .isEmail()
  .withMessage('Please provide a valid email address')
  .normalizeEmail({ gmail_remove_dots: false })
  .isLength({ max: 254 });

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 80 }),
  emailRule,
  passwordRule('password'),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[+]?[\d\s()-]{7,20}$/)
    .withMessage('Please provide a valid phone number'),

  // `role` is never accepted from the request body. Silently ignoring it
  // would let a caller believe it worked; rejecting it makes the attempt
  // visible in logs.
  body('role').not().exists().withMessage('role cannot be set during registration'),
];

const loginRules = [
  emailRule,
  body('password').isString().notEmpty().withMessage('Password is required'),
];

const updateProfileRules = [
  body('name').optional().trim().notEmpty().isLength({ max: 80 }),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[+]?[\d\s()-]{7,20}$/)
    .withMessage('Please provide a valid phone number'),
  body('email').not().exists().withMessage('Email cannot be changed here'),
  body('role').not().exists().withMessage('Role cannot be changed here'),
  body('isActive').not().exists().withMessage('isActive cannot be changed here'),
];

const updatePasswordRules = [
  body('currentPassword').isString().notEmpty().withMessage('Current password is required'),
  passwordRule('newPassword'),
  body('newPassword').custom((value, { req }) => {
    if (value === req.body.currentPassword) {
      throw new Error('New password must be different from the current one');
    }
    return true;
  }),
];

const forgotPasswordRules = [emailRule];

const resetPasswordRules = [
  body('token').isString().isLength({ min: 32, max: 128 }).withMessage('Invalid reset token'),
  passwordRule('password'),
];

module.exports = {
  registerRules,
  loginRules,
  updateProfileRules,
  updatePasswordRules,
  forgotPasswordRules,
  resetPasswordRules,
};
