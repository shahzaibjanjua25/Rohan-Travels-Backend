// In backend/src/routes/bookingRoutes.js
const express = require('express');

const ctrl = require('../controllers/bookingController');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');
const {
  createBookingRules,
  bookingIdRule,
  cancelBookingRules,
  listBookingRules,
  updateStatusRules,
  markPaidRules,
} = require('../validators/bookingValidators');

const router = express.Router();

// Every booking route requires a session.
router.use(protect);

router.get('/flights/:flightId/seats', ctrl.getFlightSeatMap);

router.route('/')
  .get(listBookingRules, validate, ctrl.getBookings)
  .post(createBookingRules, validate, ctrl.createBooking);

router.get('/:id', bookingIdRule, validate, ctrl.getBooking);
router.patch('/:id/cancel', cancelBookingRules, validate, ctrl.cancelBooking);

// Admin only routes
router.get('/:id/documents', authorize('admin'), bookingIdRule, validate, ctrl.getBookingDocuments);
router.patch('/:id/pay', authorize('admin'), markPaidRules, validate, ctrl.markPaid);
router.patch('/:id/status', authorize('admin'), updateStatusRules, validate, ctrl.updateBookingStatus);

module.exports = router;