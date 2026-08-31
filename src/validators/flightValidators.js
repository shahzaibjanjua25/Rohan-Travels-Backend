// backend/src/validators/flightValidators.js

const { body, query, param } = require('express-validator');

const CABINS = ['economy', 'business', 'first'];
const STATUSES = ['scheduled', 'delayed', 'boarding', 'departed', 'arrived', 'cancelled'];
const FLIGHT_TYPES = ['domestic', 'international'];
const TRIP_TYPES = ['one_way', 'round_trip', 'multi_city'];

/**
 * `generic` is not a travel purpose. It marks an itinerary as sellable under
 * every purpose, so it surfaces in every purpose-filtered search. Kept in sync
 * with TRAVEL_TYPES in models/Flight.js.
 */
const TRAVEL_TYPES = [
  'generic',
  'tour',
  'work_visa',
  'study_visa',
  'umrah',
  'hajj',
  'business',
  'family',
  'medical',
  'other',
];

const MAX_SEGMENTS = 8;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const endpointRules = (side) => [
  body(`${side}.airportCode`)
    .optional()
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{3}$/)
    .withMessage(`${side}.airportCode must be a 3-letter IATA code, e.g. JFK`),
  body(`${side}.city`).optional().trim().notEmpty().withMessage(`${side}.city is required`),
  body(`${side}.country`).optional().trim().notEmpty().withMessage(`${side}.country is required`),
  body(`${side}.airportName`).optional().trim().isLength({ max: 120 }),
  body(`${side}.terminal`).optional().trim().isLength({ max: 20 }),
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
    .isFloat({ min: 0, max: 10000000 })
    .withMessage(`cabins.${cabin}.price must be a positive number`)
    .toFloat(),
];

/**
 * Multi-city segments.
 *
 * Only shape is checked here. The rules that need to see the whole chain
 * (contiguity, chronological order, at least two legs) live in the model's
 * pre('validate') hook, because that is the one place they cannot be bypassed
 * — a seeder or a script writing directly through Mongoose never touches
 * express-validator.
 */
const segmentRules = [
  body('segments')
    .optional()
    .isArray({ max: MAX_SEGMENTS })
    .withMessage(`segments must be an array of at most ${MAX_SEGMENTS} legs`),

  ...['segments.*.origin', 'segments.*.destination'].flatMap((path) => [
    body(`${path}.airportCode`)
      .optional()
      .trim()
      .toUpperCase()
      .matches(/^[A-Z]{3}$/)
      .withMessage(`${path}.airportCode must be a 3-letter IATA code`),
    body(`${path}.city`).optional().trim().notEmpty(),
    body(`${path}.country`).optional().trim().notEmpty(),
    body(`${path}.airportName`).optional().trim().isLength({ max: 120 }),
    body(`${path}.terminal`).optional().trim().isLength({ max: 20 }),
  ]),

  body('segments.*.departureTime')
    .optional()
    .isISO8601()
    .withMessage('Each segment departureTime must be an ISO-8601 date')
    .toDate(),
  body('segments.*.arrivalTime')
    .optional()
    .isISO8601()
    .withMessage('Each segment arrivalTime must be an ISO-8601 date')
    .toDate(),
  body('segments.*.flightNumber').optional().trim().toUpperCase().isLength({ max: 10 }),
  body('segments.*.airline').optional().trim().isLength({ max: 80 }),
  body('segments.*.aircraft').optional().trim().isLength({ max: 80 }),
];

/**
 * Round-trip return leg.
 *
 * No origin or destination: the return is implied to run destination -> origin.
 * Accepting them would let an edit leave a return pointing somewhere the
 * outbound never went. Open-jaw itineraries are modelled as multi_city.
 */
const returnSegmentRules = [
  body('returnSegment.departureTime')
    .optional()
    .isISO8601()
    .withMessage('returnSegment.departureTime must be an ISO-8601 date')
    .toDate(),
  body('returnSegment.arrivalTime')
    .optional()
    .isISO8601()
    .withMessage('returnSegment.arrivalTime must be an ISO-8601 date')
    .toDate(),
  body('returnSegment.flightNumber').optional().trim().toUpperCase().isLength({ max: 10 }),
  body('returnSegment.aircraft').optional().trim().isLength({ max: 80 }),

  body('returnSegment.origin')
    .not()
    .exists()
    .withMessage('The return leg always flies destination to origin and cannot be redirected'),
  body('returnSegment.destination')
    .not()
    .exists()
    .withMessage('The return leg always flies destination to origin and cannot be redirected'),
];

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

const createFlightRules = [
  body('flightNumber')
    .trim()
    .toUpperCase()
    .matches(/^[A-Z0-9]{2}\d{1,4}$/)
    .withMessage('flightNumber looks like AA100 or BA1326'),
  body('airline').trim().notEmpty().withMessage('airline is required').isLength({ max: 80 }),
  body('aircraft').optional().trim().isLength({ max: 80 }),

  body('tripType')
    .optional()
    .isIn(TRIP_TYPES)
    .withMessage(`tripType must be one of: ${TRIP_TYPES.join(', ')}`),

  body('flightType')
    .optional()
    .isIn(FLIGHT_TYPES)
    .withMessage(`flightType must be one of: ${FLIGHT_TYPES.join(', ')}`),

  body('travelTypes').optional().isArray({ max: TRAVEL_TYPES.length })
    .withMessage('travelTypes must be an array'),
  body('travelTypes.*')
    .optional()
    .isIn(TRAVEL_TYPES)
    .withMessage(`Each travel type must be one of: ${TRAVEL_TYPES.join(', ')}`),

  ...endpointRules('origin'),
  ...endpointRules('destination'),

  // Optional rather than required, because on a multi_city itinerary the model
  // DERIVES these from the first and last segment. A genuinely missing time on
  // a one-way or round trip is still caught by `required: true` in the schema,
  // which surfaces as a 400 through the ValidationError branch of errorHandler.
  body('departureTime')
    .optional()
    .isISO8601()
    .withMessage('departureTime must be an ISO-8601 date')
    .toDate(),
  body('arrivalTime')
    .optional()
    .isISO8601()
    .withMessage('arrivalTime must be an ISO-8601 date')
    .toDate(),

  ...segmentRules,
  ...returnSegmentRules,

  ...CABINS.flatMap(cabinRules),

  body('status')
    .optional()
    .isIn(STATUSES)
    .withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  body('baggageAllowance.cabinKg').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('baggageAllowance.checkedKg').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  // ✨ NEW: Return baggage validation
  body('baggageAllowance.returnCheckedKg').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('isActive').optional().isBoolean().toBoolean(),

  // Reject unknown or server-owned keys rather than silently dropping them —
  // a typo in a field name should fail loudly, not look like it saved.
  body('_id').not().exists().withMessage('_id cannot be set directly'),
  body('routeKey').not().exists().withMessage('routeKey is derived by the server'),
];

/** Same rules, all optional — a PUT may send only the fields being changed. */
const updateFlightRules = createFlightRules.map((chain) => chain.optional());

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const flightIdRule = [param('id').isMongoId().withMessage('Invalid flight id')];

const statusRule = [
  param('id').isMongoId().withMessage('Invalid flight id'),
  body('status').isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
];

const searchFlightRules = [
  query('origin')
    .optional()
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{3}$/)
    .withMessage('origin must be a 3-letter IATA code'),
  query('destination')
    .optional()
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{3}$/)
    .withMessage('destination must be a 3-letter IATA code'),

  query('departureDate').optional().isISO8601().withMessage('departureDate must be YYYY-MM-DD'),
  query('returnDate').optional().isISO8601().withMessage('returnDate must be YYYY-MM-DD'),

  query('tripType')
    .optional()
    .isIn(TRIP_TYPES)
    .withMessage(`tripType must be one of: ${TRIP_TYPES.join(', ')}`),
  query('travelType')
    .optional()
    .isIn(TRAVEL_TYPES)
    .withMessage(`travelType must be one of: ${TRAVEL_TYPES.join(', ')}`),
  query('flightType')
    .optional()
    .isIn(FLIGHT_TYPES)
    .withMessage(`flightType must be one of: ${FLIGHT_TYPES.join(', ')}`),

  query('cabinClass')
    .optional()
    .isIn(CABINS)
    .withMessage(`cabinClass must be one of: ${CABINS.join(', ')}`),
  query('passengers')
    .optional()
    .isInt({ min: 1, max: 9 })
    .withMessage('passengers must be 1-9')
    .toInt(),

  query('minPrice').optional().isFloat({ min: 0 }).toFloat(),
  query('maxPrice').optional().isFloat({ min: 0 }).toFloat(),
  query('airline').optional().trim().isLength({ max: 80 }),
  query('search').optional().trim().isLength({ max: 120 }),
  query('status').optional().isIn(STATUSES),

  query('sort')
    .optional()
    .isIn([
      'price',
      '-price',
      'duration',
      '-duration',
      'departureTime',
      '-departureTime',
      'route',
      '-route',
    ])
    .withMessage('sort must be one of: price, duration, departureTime, route (prefix - to reverse)'),

  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be 1-100')
    .toInt(),
  query('includeInactive').optional().isBoolean(),
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
  TRIP_TYPES,
  TRAVEL_TYPES,
};