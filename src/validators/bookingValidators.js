// backend/src/validators/bookingValidators.js

const { body, param, query } = require('express-validator');

const CABINS = ['economy', 'business', 'first'];
const STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];

/** Reject a date of birth that is in the future or implausibly distant. */
const sensibleDob = (value) => {
  if (!value) return true; // Allow empty DOB for adults
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) throw new Error('Invalid date of birth');
  if (dob > new Date()) throw new Error('Date of birth cannot be in the future');
  if (dob < new Date('1900-01-01')) throw new Error('Date of birth is not plausible');
  return true;
};

// Create booking validation rules
exports.createBookingRules = [
  body('flightId')
    .isMongoId()
    .withMessage('Invalid flight ID'),

  body('cabinClass')
    .optional()
    .isIn(CABINS)
    .withMessage(`Cabin class must be one of: ${CABINS.join(', ')}`),

  body('passengers')
    .isArray({ min: 1 })
    .withMessage('At least one passenger is required'),

  body('passengers.*.title')
    .optional()
    .isString()
    .withMessage('Title must be a string'),

  body('passengers.*.firstName')
    .notEmpty()
    .withMessage('Passenger first name is required')
    .isString()
    .withMessage('First name must be a string'),

  body('passengers.*.lastName')
    .notEmpty()
    .withMessage('Passenger last name is required')
    .isString()
    .withMessage('Last name must be a string'),

  body('passengers.*.dateOfBirth')
    .optional()
    .custom(sensibleDob)
    .withMessage('Invalid date of birth'),

  body('passengers.*.type')
    .optional()
    .isIn(['adult', 'infant'])
    .withMessage('Passenger type must be adult or infant'),

  body('passengers.*.seatNumber')
    .optional()
    .isString()
    .withMessage('Seat number must be a string'),

  body('passengers.*.passportNumber')
    .optional()
    .isString()
    .withMessage('Passport number must be a string'),

  body('passengers.*.passportExpiry')
    .optional()
    .isString()
    .withMessage('Passport expiry must be a string'),

  body('passengers.*.nationality')
    .optional()
    .isString()
    .withMessage('Nationality must be a string'),

  // ✅ NEW: Individual passenger CNIC and Address
  body('passengers.*.cnic')
    .optional()
    .isString()
    .withMessage('CNIC must be a string'),

  body('passengers.*.address')
    .optional()
    .isString()
    .withMessage('Address must be a string'),

  body('contactEmail')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),

  body('contactPhone')
    .notEmpty()
    .withMessage('Phone number is required')
    .isString()
    .withMessage('Phone number must be a string'),

  body('customerName')
    .optional()
    .isString()
    .withMessage('Customer name must be a string'),

  body('customerAddress')
    .optional()
    .isString()
    .withMessage('Customer address must be a string'),

  body('customerCnic')
    .optional()
    .isString()
    .withMessage('CNIC must be a string'),

  body('customerPassport')
    .optional()
    .isString()
    .withMessage('Passport number must be a string'),

  body('specialRequests')
    .optional()
    .isString()
    .withMessage('Special requests must be a string'),
];

// Booking ID validation
exports.bookingIdRule = [
  param('id')
    .isMongoId()
    .withMessage('Invalid booking ID'),
];

// Cancel booking validation
exports.cancelBookingRules = [
  param('id')
    .isMongoId()
    .withMessage('Invalid booking ID'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Reason cannot exceed 500 characters'),
];

// List bookings validation
exports.listBookingRules = [
  query('status')
    .optional()
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(', ')}`),
  
  query('paymentStatus')
    .optional()
    .isIn(['unpaid', 'paid', 'refunded', 'partially_refunded'])
    .withMessage('Invalid payment status'),
  
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
  
  query('sort')
    .optional()
    .isIn(['createdAt', '-createdAt', 'departureTime', '-departureTime'])
    .withMessage('Invalid sort option'),
];

// Update status validation
exports.updateStatusRules = [
  param('id')
    .isMongoId()
    .withMessage('Invalid booking ID'),
  body('status')
    .isIn(STATUSES)
    .withMessage(`Status must be one of: ${STATUSES.join(', ')}`),
];

// Mark paid validation
exports.markPaidRules = [
  param('id')
    .isMongoId()
    .withMessage('Invalid booking ID'),
  body('paymentMethod')
    .optional()
    .isIn(['card', 'bank_transfer', 'wallet', 'cash', 'system'])
    .withMessage('Invalid payment method'),
  body('transactionId')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('Transaction ID cannot exceed 120 characters'),
];