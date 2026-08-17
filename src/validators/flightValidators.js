const { body, query, param } = require('express-validator');

const CABINS = ['economy', 'business', 'first'];
const STATUSES = ['scheduled', 'delayed', 'boarding', 'departed', 'arrived', 'cancelled'];
const FLIGHT_TYPES = ['domestic', 'international'];

const endpointRules = (side) => [
  body(`${side}.airportCode`)
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{3}$/)
    .withMessage(`${side}.airportCode must be a 3-letter IATA code, e.g. JFK`),
  body(`${side}.city`).trim().notEmpty().withMessage(`${side}.city is required`),
  body(`${side}.country`).trim().notEmpty().withMessage(`${side}.country is required`),
  body(`${side}.airportName`).optional().trim(),
  body(`${side}.terminal`).optional().trim(),
];

const cabinRules = (cabin) => [
  body(`cabins.${cabin}.totalSeats`)
    .optional()
    .isInt({ min: 0, max: 1000 })
    .withMessage(`cabins.${cabin}.totalSeats must be 0-1000`)
    .toInt(),
  body(`cabins.${cabin}.availableSeats`)
    .optional()
    .isInt({ min: 0, max: 1000 })
    .withMessage(`cabins.${cabin}.availableSeats must be 0-1000`)
    .toInt(),
  body(`cabins.${cabin}.price`)
    .optional()
    .isFloat({ min: 0, max: 1000000 })
    .withMessage(`cabins.${cabin}.price must be a positive number`)
    .toFloat(),
];

const createFlightRules = [
  body('flightNumber')
    .trim()
    .toUpperCase()
    .matches(/^[A-Z0-9]{2}\d{1,4}$/)
    .withMessage('flightNumber looks like AA100 or BA1326'),
  body('airline').trim().notEmpty().withMessage('airline is required').isLength({ max: 80 }),
  body('aircraft').optional().trim().isLength({ max: 80 }),

  // ✅ ADDED: Flight Type validation
  body('flightType')
    .optional()
    .isIn(FLIGHT_TYPES)
    .withMessage(`flightType must be one of: ${FLIGHT_TYPES.join(', ')}`),

  // ✅ ADDED: Travel Types validation
  body('travelTypes')
    .optional()
    .isArray()
    .withMessage('travelTypes must be an array'),

  ...endpointRules('origin'),
  ...endpointRules('destination'),

  body('departureTime').isISO8601().withMessage('departureTime must be an ISO-8601 date').toDate(),
  body('arrivalTime').isISO8601().withMessage('arrivalTime must be an ISO-8601 date').toDate(),

  ...CABINS.flatMap(cabinRules),

  body('status').optional().isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  body('baggageAllowance.cabinKg').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('baggageAllowance.checkedKg').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('isActive').optional().isBoolean().toBoolean(),

  // Reject unknown keys rather than silently dropping them — a typo in a
  // field name should fail loudly, not look like it saved.
  body('_id').not().exists().withMessage('_id cannot be set directly'),
];

/** Same rules, all optional — a PUT may send only the fields being changed. */
const updateFlightRules = createFlightRules.map((chain) => chain.optional());

const flightIdRule = [
  param('id').isMongoId().withMessage('Invalid flight id'),
];

const searchFlightRules = [
  query('origin').optional().trim().toUpperCase().matches(/^[A-Z]{3}$/).withMessage('origin must be a 3-letter IATA code'),
  query('destination').optional().trim().toUpperCase().matches(/^[A-Z]{3}$/).withMessage('destination must be a 3-letter IATA code'),
  query('departureDate').optional().isISO8601().withMessage('departureDate must be YYYY-MM-DD'),
  query('returnDate').optional().isISO8601().withMessage('returnDate must be YYYY-MM-DD'),
  query('cabinClass').optional().isIn(CABINS).withMessage(`cabinClass must be one of: ${CABINS.join(', ')}`),
  query('passengers').optional().isInt({ min: 1, max: 9 }).withMessage('passengers must be 1-9').toInt(),
  query('minPrice').optional().isFloat({ min: 0 }).toFloat(),
  query('maxPrice').optional().isFloat({ min: 0 }).toFloat(),
  query('airline').optional().trim().isLength({ max: 80 }),
  query('status').optional().isIn(STATUSES),
  query('sort')
    .optional()
    .isIn(['price', '-price', 'duration', '-duration', 'departureTime', '-departureTime'])
    .withMessage('sort must be one of: price, duration, departureTime (prefix with - to reverse)'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100').toInt(),
  query('includeInactive').optional().isBoolean().toBoolean(),
  query('flightType')
    .optional()
    .isIn(['domestic', 'international'])
    .withMessage('flightType must be domestic or international'),

  // ✅ ADD: travelType filter
  query('travelType')
    .optional()
    .isString()
    .withMessage('travelType must be a string'),

  // ✅ ADD: search filter
  query('search')
    .optional()
    .isString()
    .withMessage('search must be a string')
    .trim()
];

const statusRule = [
  param('id').isMongoId().withMessage('Invalid flight id'),
  body('status').isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
];

module.exports = {
  createFlightRules,
  updateFlightRules,
  flightIdRule,
  searchFlightRules,
  statusRule,
  CABINS,
  STATUSES,
  FLIGHT_TYPES,
};