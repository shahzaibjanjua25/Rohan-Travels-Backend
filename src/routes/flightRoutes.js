const express = require('express');

const ctrl = require('../controllers/flightController');
const validate = require('../middleware/validate');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const {
  createFlightRules,
  updateFlightRules,
  flightIdRule,
  searchFlightRules,
  statusRule,
} = require('../validators/flightValidators');

const router = express.Router();

// Read: optionalAuth rather than protect. Letting visitors search flights
// before signing up is the whole funnel; the handler still hides inactive and
// departed flights from anyone who is not an admin.
router.get('/', optionalAuth, searchFlightRules, validate, ctrl.getFlights);
router.get('/:id', optionalAuth, flightIdRule, validate, ctrl.getFlight);
router.get('/popular-destinations', optionalAuth, ctrl.getPopularDestinations);
// Write: admin only.
router.post('/', protect, authorize('admin'), createFlightRules, validate, ctrl.createFlight);
router.put('/:id', protect, authorize('admin'), flightIdRule, updateFlightRules, validate, ctrl.updateFlight);
router.patch('/:id/status', protect, authorize('admin'), statusRule, validate, ctrl.updateFlightStatus);
router.delete('/:id', protect, authorize('admin'), flightIdRule, validate, ctrl.deleteFlight);
router.get('/filters', ctrl.getFlightFilters);

module.exports = router;
