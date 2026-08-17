const { body, query, param } = require('express-validator');

const CATEGORIES = ['booking_payment', 'refund', 'cancellation_fee', 'service_fee', 'adjustment'];
const NOTIFICATION_TYPES = ['booking', 'payment', 'flight_update', 'system', 'promotion'];

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

const listLedgerRules = [
  query('user').optional().isMongoId().withMessage('Invalid user id'),
  query('booking').optional().isMongoId().withMessage('Invalid booking id'),
  query('category').optional().isIn(CATEGORIES),
  query('type').optional().isIn(['debit', 'credit']),
  query('from').optional().isISO8601().withMessage('from must be YYYY-MM-DD'),
  query('to').optional().isISO8601().withMessage('to must be YYYY-MM-DD'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100').toInt(),
];

const adjustmentRules = [
  body('user').isMongoId().withMessage('A valid user id is required'),
  body('type').isIn(['debit', 'credit']).withMessage('type must be debit or credit'),
  body('amount')
    .isFloat({ min: 0.01, max: 1000000 })
    .withMessage('amount must be between 0.01 and 1,000,000')
    .toFloat(),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('A description is required for every adjustment')
    .isLength({ min: 5, max: 300 })
    .withMessage('Description must be 5-300 characters'),
  body('category').optional().isIn(CATEGORIES),
  body('booking').optional().isMongoId(),
  body('reverses').optional().isMongoId(),
  body('paymentMethod').optional().isIn(['card', 'bank_transfer', 'wallet', 'cash', 'system']),

  // balanceAfter is derived from existing entries. Accepting it would let a
  // caller write a running balance that does not follow from the history.
  body('balanceAfter').not().exists().withMessage('balanceAfter is calculated by the server'),
  body('entryNumber').not().exists().withMessage('entryNumber is assigned by the server'),
];

const summaryRules = [
  query('period').optional().isIn(['today', '7d', '30d', '90d', '365d', 'mtd', 'ytd', 'all']),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
];

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Links are stored and later rendered by the SPA, most likely as an anchor
 * href. `javascript:alert(1)` in that position is stored XSS that fires for
 * whoever opens their notifications — so only same-site relative paths are
 * accepted. Protocol-relative `//evil.com` is rejected too: it looks like a
 * path but resolves to another origin.
 */
const safeLinkRule = body('link')
  .optional({ values: 'falsy' })
  .trim()
  .isLength({ max: 300 })
  .bail()
  .custom((value) => {
    if (!value.startsWith('/')) throw new Error('link must be a relative path starting with /');
    if (value.startsWith('//')) throw new Error('link must not be protocol-relative');
    if (/[\u0000-\u001f]/.test(value)) throw new Error('link contains control characters');
    return true;
  });

const listNotificationRules = [
  query('isRead').optional().isBoolean().toBoolean(),
  query('type').optional().isIn(NOTIFICATION_TYPES),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100').toInt(),
];

const sendNotificationRules = [
  body('title').trim().notEmpty().withMessage('title is required').isLength({ max: 120 }),
  body('message').trim().notEmpty().withMessage('message is required').isLength({ max: 1000 }),
  body('type').optional().isIn(NOTIFICATION_TYPES),
  body('priority').optional().isIn(['low', 'normal', 'high']),
  safeLinkRule,

  body('audience')
    .optional()
    .isIn(['all', 'customers', 'admins'])
    .withMessage('audience must be all, customers or admins'),
  body('userIds').optional().isArray({ min: 1, max: 500 }).withMessage('userIds must list 1-500 users'),
  body('userIds.*').optional().isMongoId().withMessage('userIds must contain valid ids'),

  // Exactly one targeting mode. Allowing both would leave the precedence
  // rule implicit, and an admin would eventually be surprised by it.
  body().custom((value) => {
    const hasAudience = Boolean(value.audience);
    const hasIds = Array.isArray(value.userIds) && value.userIds.length > 0;
    if (hasAudience === hasIds) {
      throw new Error('Provide either audience or userIds, not both');
    }
    return true;
  }),
];

const idRule = (name = 'id') => [param(name).isMongoId().withMessage(`Invalid ${name}`)];

module.exports = {
  listLedgerRules,
  adjustmentRules,
  summaryRules,
  listNotificationRules,
  sendNotificationRules,
  idRule,
};
