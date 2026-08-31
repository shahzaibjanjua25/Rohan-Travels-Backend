// backend/src/models/Flight.js
const mongoose = require('mongoose');
const mongooseLeanVirtuals = require('mongoose-lean-virtuals');

const CABIN_CLASSES = ['economy', 'business', 'first'];

/**
 * A Flight document is a *sellable itinerary*, not a single leg.
 *
 *   one_way     origin -> destination, one hop
 *   round_trip  origin -> destination, plus a return leg back to origin
 *   multi_city  a chain of 2+ segments, e.g. KHI -> JED -> MAK -> ISB
 *
 * Keeping the whole itinerary in one document is deliberate. Seat inventory
 * lives in `cabins`, and `utils/seatInventory.js` reserves seats with a single
 * atomic findOneAndUpdate on a single document. If a multi-city trip were
 * three separate Flight documents, holding seats across all three would need
 * a transaction (and therefore a replica set), or a compensating rollback that
 * can itself fail halfway. One document keeps overselling impossible.
 *
 * The cost is that legs cannot be sold individually. That is the correct
 * trade for a packaged itinerary and the wrong one for a generic GDS.
 */
const TRIP_TYPES = ['one_way', 'round_trip', 'multi_city'];

/**
 * `generic` is not a travel purpose. It marks an itinerary as sellable under
 * *every* purpose, so a generic ticket surfaces alongside umrah results, hajj
 * results, family results and so on. See utils/flightQuery.js.
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

/** One airport endpoint. Reused for origin, destination and every segment. */
const endpointSchema = new mongoose.Schema(
  {
    airportCode: {
      type: String,
      required: [true, 'Airport code is required'],
      uppercase: true,
      trim: true,
      match: [/^[A-Z]{3}$/, 'Airport code must be 3 letters (IATA), e.g. JFK'],
    },
    airportName: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    terminal: { type: String, trim: true },
  },
  { _id: false }
);

/** One leg of a multi-city chain. */
const segmentSchema = new mongoose.Schema(
  {
    origin: { type: endpointSchema, required: true },
    destination: { type: endpointSchema, required: true },
    departureTime: { type: Date, required: true },
    arrivalTime: { type: Date, required: true },
    // Optional per-leg overrides. A packaged itinerary is often flown by more
    // than one carrier, so a leg may carry its own number and aircraft.
    flightNumber: { type: String, uppercase: true, trim: true },
    airline: { type: String, trim: true },
    aircraft: { type: String, trim: true },
  },
  { _id: false }
);

/**
 * The return leg of a round trip.
 *
 * Origin and destination are deliberately implied (destination -> origin)
 * rather than stored. Storing them would let an edit leave the return
 * pointing somewhere the outbound never went. Open-jaw returns are therefore
 * not supported here; model those as multi_city instead.
 */
const returnSegmentSchema = new mongoose.Schema(
  {
    departureTime: { type: Date, required: true },
    arrivalTime: { type: Date, required: true },
    flightNumber: { type: String, uppercase: true, trim: true },
    aircraft: { type: String, trim: true },
  },
  { _id: false }
);

/** Inventory and pricing for a single cabin across the WHOLE itinerary. */
const cabinSchema = new mongoose.Schema(
  {
    totalSeats: { type: Number, required: true, min: 0, default: 0 },
    availableSeats: { type: Number, required: true, min: 0, default: 0 },
    price: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false }
);

const flightSchema = new mongoose.Schema(
  {
    flightNumber: {
      type: String,
      required: [true, 'Flight number is required'],
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9]{2}\d{1,4}$/, 'Flight number looks like AA100 or BA1326'],
    },
    airline: {
      type: String,
      required: [true, 'Airline is required'],
      trim: true,
      index: true,
    },
    aircraft: { type: String, trim: true },

    tripType: {
      type: String,
      enum: {
        values: TRIP_TYPES,
        message: `tripType must be one of: ${TRIP_TYPES.join(', ')}`,
      },
      default: 'one_way',
      index: true,
    },

    flightType: {
      type: String,
      enum: ['domestic', 'international'],
      default: 'domestic',
    },

    travelTypes: {
      type: [{ type: String, enum: TRAVEL_TYPES }],
      default: ['generic'],
    },

    // For multi_city these are DERIVED from the segment chain in pre('validate').
    // Never set them by hand on a multi-city itinerary; they will be overwritten.
    origin: { type: endpointSchema, required: true },
    destination: { type: endpointSchema, required: true },
    departureTime: { type: Date, required: [true, 'Departure time is required'] },
    arrivalTime: { type: Date, required: [true, 'Arrival time is required'] },

    /** multi_city only. Ordered, contiguous, at least 2 entries. */
    segments: { type: [segmentSchema], default: [] },

    /** round_trip only. */
    returnSegment: { type: returnSegmentSchema },

    cabins: {
      economy: { type: cabinSchema, default: () => ({}) },
      business: { type: cabinSchema, default: () => ({}) },
      first: { type: cabinSchema, default: () => ({}) },
    },

    status: {
      type: String,
      enum: ['scheduled', 'delayed', 'boarding', 'departed', 'arrived', 'cancelled'],
      default: 'scheduled',
      index: true,
    },

    baggageAllowance: {
      cabinKg: { type: Number, default: 7, min: 0 },
      checkedKg: { type: Number, default: 23, min: 0 },
      // ✨ NEW: Return baggage for round trips
      returnCheckedKg: { type: Number, default: 0, min: 0 },
    },

    images: [{ url: String, publicId: String }],

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// The query behind every flight search: route + date.
flightSchema.index({ 'origin.airportCode': 1, 'destination.airportCode': 1, departureTime: 1 });
flightSchema.index({ departureTime: 1, isActive: 1 });
flightSchema.index({ flightType: 1 });
flightSchema.index({ travelTypes: 1 });
flightSchema.index({ tripType: 1, isActive: 1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

flightSchema.virtual('durationMinutes').get(function durationMinutes() {
  if (!this.departureTime || !this.arrivalTime) return null;
  return Math.round((this.arrivalTime - this.departureTime) / 60000);
});

flightSchema.virtual('returnDurationMinutes').get(function returnDurationMinutes() {
  const r = this.returnSegment;
  if (!r?.departureTime || !r?.arrivalTime) return null;
  return Math.round((r.arrivalTime - r.departureTime) / 60000);
});

/**
 * Stable grouping key. The flights list groups results by route, and deriving
 * the key here rather than in the UI keeps every consumer agreeing on what
 * "the same route" means.
 */
flightSchema.virtual('routeKey').get(function routeKey() {
  const from = this.origin?.airportCode || 'XXX';
  const to = this.destination?.airportCode || 'XXX';
  return `${from}-${to}`;
});

/** Intermediate airports on a multi-city chain, in order. */
flightSchema.virtual('viaAirports').get(function viaAirports() {
  if (this.tripType !== 'multi_city' || !this.segments?.length) return [];
  return this.segments
    .slice(0, -1)
    .map((s) => s.destination?.airportCode)
    .filter(Boolean);
});

flightSchema.virtual('stopCount').get(function stopCount() {
  if (this.tripType !== 'multi_city' || !this.segments?.length) return 0;
  return Math.max(0, this.segments.length - 1);
});

flightSchema.virtual('totalAvailableSeats').get(function totalAvailableSeats() {
  if (!this.cabins) return 0;
  return CABIN_CLASSES.reduce((sum, c) => sum + (this.cabins[c]?.availableSeats || 0), 0);
});

/** Cheapest cabin that still has seats — used for "from $X" in search results. */
flightSchema.virtual('lowestPrice').get(function lowestPrice() {
  const prices = CABIN_CLASSES.map((c) => this.cabins?.[c])
    .filter((cabin) => cabin && cabin.availableSeats > 0)
    .map((cabin) => cabin.price);
  return prices.length ? Math.min(...prices) : null;
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Subdocuments need unwrapping before they can be assigned to another path. */
const plain = (value) => (value && typeof value.toObject === 'function' ? value.toObject() : value);

flightSchema.pre('validate', function validateFlight(next) {
  const tripType = this.tripType || 'one_way';

  // --- multi-city: the segment chain is the single source of truth ---------
  if (tripType === 'multi_city') {
    const segs = this.segments || [];

    if (segs.length < 2) {
      return next(new Error('A multi-city itinerary needs at least 2 segments'));
    }

    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      const n = i + 1;

      if (!s.departureTime || !s.arrivalTime) {
        return next(new Error(`Segment ${n} is missing a departure or arrival time`));
      }
      if (s.arrivalTime <= s.departureTime) {
        return next(new Error(`Segment ${n} arrives before it departs`));
      }
      if (s.origin?.airportCode && s.origin.airportCode === s.destination?.airportCode) {
        return next(new Error(`Segment ${n} departs and arrives at the same airport`));
      }

      if (i > 0) {
        const prev = segs[i - 1];
        // A gap in the chain strands the passenger somewhere the ticket does
        // not cover, so it is rejected rather than quietly sold.
        if (prev.destination?.airportCode !== s.origin?.airportCode) {
          return next(
            new Error(
              `Segment ${n} departs from ${s.origin?.airportCode} but segment ${i} lands at ${prev.destination?.airportCode}`
            )
          );
        }
        if (s.departureTime < prev.arrivalTime) {
          return next(new Error(`Segment ${n} departs before segment ${i} has landed`));
        }
      }
    }

    // Derive the journey envelope so search, route grouping and booking
    // snapshots can never disagree with the segments they came from.
    const first = segs[0];
    const last = segs[segs.length - 1];
    this.origin = plain(first.origin);
    this.destination = plain(last.destination);
    this.departureTime = first.departureTime;
    this.arrivalTime = last.arrivalTime;
    this.returnSegment = undefined;
  } else {
    this.segments = [];
  }

  // --- round trip ----------------------------------------------------------
  if (tripType === 'round_trip') {
    const ret = this.returnSegment;
    if (!ret || !ret.departureTime || !ret.arrivalTime) {
      return next(new Error('A round trip needs a return departure and arrival time'));
    }
    if (ret.arrivalTime <= ret.departureTime) {
      return next(new Error('The return leg arrives before it departs'));
    }
    if (this.arrivalTime && ret.departureTime < this.arrivalTime) {
      return next(new Error('The return leg departs before the outbound leg has landed'));
    }
  } else if (tripType === 'one_way') {
    this.returnSegment = undefined;
  }

  // --- shared checks -------------------------------------------------------
  if (this.arrivalTime && this.departureTime && this.arrivalTime <= this.departureTime) {
    return next(new Error('Arrival time must be after departure time'));
  }

  // A multi-city loop legitimately ends where it started (KHI -> JED -> KHI),
  // so only single-hop itineraries are held to this.
  if (
    tripType !== 'multi_city' &&
    this.origin?.airportCode &&
    this.destination?.airportCode &&
    this.origin.airportCode === this.destination.airportCode
  ) {
    return next(new Error('Origin and destination must be different airports'));
  }

  for (const c of CABIN_CLASSES) {
    const cabin = this.cabins?.[c];
    if (cabin && cabin.availableSeats > cabin.totalSeats) {
      return next(new Error(`Available seats in ${c} cannot exceed total seats`));
    }
  }

  return next();
});

// Mongoose does not compute virtuals on .lean() queries. The list endpoint
// uses .lean() for speed but still needs lowestPrice / routeKey / viaAirports,
// so this plugin adds them back. Without it those fields silently vanish from
// search results while working fine on single-document reads.
flightSchema.plugin(mongooseLeanVirtuals);

flightSchema.statics.CABIN_CLASSES = CABIN_CLASSES;
flightSchema.statics.TRIP_TYPES = TRIP_TYPES;
flightSchema.statics.TRAVEL_TYPES = TRAVEL_TYPES;

module.exports = mongoose.model('Flight', flightSchema);