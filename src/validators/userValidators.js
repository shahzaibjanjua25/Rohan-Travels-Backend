const { body, query, param } = require('express-validator');

const listUserRules = [
  query('role').optional().isIn(['user', 'admin']),
  query('isActive').optional().isBoolean().toBoolean(),
  query('search').optional().trim().isLength({ max: 120 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100').toInt(),
];

const updateUserRules = [
  param('id').isMongoId().withMessage('Invalid user id'),
  body('role').optional().isIn(['user', 'admin']).withMessage('role must be user or admin'),
  body('isActive').optional().isBoolean().toBoolean(),
  body('name').optional().trim().notEmpty().isLength({ max: 80 }),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[+]?[\d\s()-]{7,20}$/)
    .withMessage('Please provide a valid phone number'),

  // An admin who can set passwords can impersonate anyone. Account recovery
  // goes through the user's own emailed reset flow instead.
  body('password').not().exists().withMessage('Passwords cannot be set by an administrator'),
  body('email').not().exists().withMessage('Email changes are not supported here'),
  body('loginAttempts').not().exists(),
  body('lockUntil').not().exists(),
];

const userIdRule = [param('id').isMongoId().withMessage('Invalid user id')];

module.exports = { listUserRules, updateUserRules, userIdRule };
