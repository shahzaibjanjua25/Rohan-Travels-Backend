const mongoose = require('mongoose');
const mongooseLeanVirtuals = require('mongoose-lean-virtuals');

const CABIN_CLASSES = ['economy', 'business', 'first'];

/** One airport endpoint. Reused for both origin and destination. */
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

/** Inventory and pricing for a single cabin on a single flight. */
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
      unique: true,
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

    // ✅ ADDED: Flight Type (domestic/international)
    flightType: {
      type: String,
      enum: ['domestic', 'international'],
      default: 'domestic',
    },

    // ✅ ADDED: Travel Types allowed for this flight
    travelTypes: {
      type: [String],
      default: ['tour', 'family', 'business', 'other'],
    },

    origin: { type: endpointSchema, required: true },
    destination: { type: endpointSchema, required: true },

    departureTime: { type: Date, required: [true, 'Departure time is required'] },
    arrivalTime: { type: Date, required: [true, 'Arrival time is required'] },

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

flightSchema.virtual('durationMinutes').get(function durationMinutes() {
  if (!this.departureTime || !this.arrivalTime) return null;
  return Math.round((this.arrivalTime - this.departureTime) / 60000);
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

flightSchema.pre('validate', function validateFlight(next) {
  if (this.arrivalTime && this.departureTime && this.arrivalTime <= this.departureTime) {
    return next(new Error('Arrival time must be after departure time'));
  }

  if (
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
// uses .lean() for speed but still needs lowestPrice / durationMinutes, so
// this plugin adds them back. Without it those fields silently vanish from
// search results while working fine on single-document reads.
flightSchema.plugin(mongooseLeanVirtuals);

flightSchema.statics.CABIN_CLASSES = CABIN_CLASSES;

module.exports = mongoose.model('Flight', flightSchema);