// backend/src/models/Booking.js
const mongoose = require('mongoose');

const TRIP_TYPES = ['one_way', 'round_trip', 'multi_city'];

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** Individual passenger details. */
const passengerSchema = new mongoose.Schema({
  title: {
    type: String,
    enum: ['Mr', 'Mrs', 'Ms', 'Dr', 'Master', 'Miss', ''],
    default: '',
  },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  dateOfBirth: { type: String, default: '' },
  type: { type: String, enum: ['adult', 'infant'], default: 'adult' },
  seatNumber: { type: String, default: null },
  passportNumber: { type: String, default: '', trim: true },
  passportExpiry: { type: Date, default: null },
  nationality: { type: String, default: '', trim: true },
  cnic: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
});

/** Airport endpoint as captured at booking time. */
const snapshotEndpointSchema = new mongoose.Schema(
  {
    airportCode: String,
    airportName: String,
    city: String,
    country: String,
    terminal: String,
  },
  { _id: false }
);

/**
 * One leg of a multi-city itinerary, frozen at booking time.
 *
 * Mongoose silently discards paths a sub-schema does not declare, so anything
 * the booking detail page needs to render has to be spelled out here — a
 * missing field would not error, it would just quietly vanish from the record.
 */
const snapshotSegmentSchema = new mongoose.Schema(
  {
    origin: snapshotEndpointSchema,
    destination: snapshotEndpointSchema,
    departureTime: Date,
    arrivalTime: Date,
    flightNumber: String,
    airline: String,
    aircraft: String,
  },
  { _id: false }
);

const snapshotReturnSchema = new mongoose.Schema(
  {
    departureTime: Date,
    arrivalTime: Date,
    flightNumber: String,
    aircraft: String,
  },
  { _id: false }
);

/**
 * The itinerary as it stood when the customer paid for it.
 *
 * This is a snapshot on purpose, not a join. An admin rescheduling a flight
 * must not retroactively rewrite what a passenger was sold — the ticket has to
 * keep saying what it said at purchase, or a dispute has no record to settle
 * against.
 */
const flightDetailsSchema = new mongoose.Schema(
  {
    flightNumber: String,
    airline: String,
    aircraft: String,

    tripType: { type: String, enum: TRIP_TYPES, default: 'one_way' },

    origin: snapshotEndpointSchema,
    destination: snapshotEndpointSchema,

    departureDate: Date,
    arrivalDate: Date,

    /** multi_city only. Ordered legs, origin -> ... -> destination. */
    segments: { type: [snapshotSegmentSchema], default: [] },

    /** round_trip only. Runs destination -> origin. */
    returnSegment: snapshotReturnSchema,

    price: Number,
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

const bookingSchema = new mongoose.Schema(
  {
    bookingReference: { type: String, unique: true },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    flight: { type: mongoose.Schema.Types.ObjectId, ref: 'Flight', required: true },

    cabinClass: {
      type: String,
      enum: ['economy', 'business', 'first'],
      default: 'economy',
    },

    flightDetails: flightDetailsSchema,

    passengers: [passengerSchema],

    passengerCounts: {
      adults: { type: Number, default: 0 },
      infants: { type: Number, default: 0 },
      totalSeats: { type: Number, default: 0 },
    },

    pricing: {
      pricePerSeat: { type: Number, default: 0 },
      seatCount: { type: Number, default: 0 },
      subtotal: { type: Number, default: 0 },
      taxes: { type: Number, default: 0 },
      fees: { type: Number, default: 0 },
      totalAmount: { type: Number, required: true, default: 0 },
      currency: { type: String, default: 'PKR' },
    },

    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded', 'failed'],
      default: 'unpaid',
    },

    customerDetails: {
      name: { type: String, default: '' },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      address: { type: String, default: '' },
      cnic: { type: String, default: '' },
      passportNumber: { type: String, default: '' },
      specialRequests: { type: String, default: '' },
    },

    paymentDetails: {
      method: {
        type: String,
        enum: ['cash', 'bank_transfer', 'credit_card', 'debit_card', ''],
        default: '',
      },
      reference: String,
      amount: Number,
      date: Date,
      status: {
        type: String,
        enum: ['pending', 'completed', 'failed', ''],
        default: 'pending',
      },
    },

    ticketDetails: {
      ticketNumber: String,
      pnr: String,
      issueDate: Date,
      issuedBy: String,
    },

    cancellation: {
      cancelledAt: Date,
      cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      refundAmount: Number,
    },

    adminNotes: String,

    statusHistory: [
      {
        status: String,
        date: { type: Date, default: Date.now },
        note: String,
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true }
);

// ---------------------------------------------------------------------------
// Hooks, virtuals, methods
// ---------------------------------------------------------------------------

bookingSchema.pre('save', async function assignReference(next) {
  if (this.bookingReference) return next();
  const count = await mongoose.model('Booking').countDocuments();
  this.bookingReference = `BK-${String(count + 1).padStart(6, '0')}`;
  return next();
});

bookingSchema.virtual('passengerCount').get(function passengerCount() {
  return this.passengers ? this.passengers.length : 0;
});

/** Every leg the passenger actually flies, in order, whatever the trip type. */
bookingSchema.virtual('itineraryLegs').get(function itineraryLegs() {
  const d = this.flightDetails;
  if (!d) return [];

  if (d.tripType === 'multi_city' && d.segments?.length) {
    return d.segments.map((s) => ({
      origin: s.origin,
      destination: s.destination,
      departureTime: s.departureTime,
      arrivalTime: s.arrivalTime,
      flightNumber: s.flightNumber || d.flightNumber,
      leg: 'outbound',
    }));
  }

  const legs = [
    {
      origin: d.origin,
      destination: d.destination,
      departureTime: d.departureDate,
      arrivalTime: d.arrivalDate,
      flightNumber: d.flightNumber,
      leg: 'outbound',
    },
  ];

  if (d.tripType === 'round_trip' && d.returnSegment?.departureTime) {
    legs.push({
      origin: d.destination,
      destination: d.origin,
      departureTime: d.returnSegment.departureTime,
      arrivalTime: d.returnSegment.arrivalTime,
      flightNumber: d.returnSegment.flightNumber || d.flightNumber,
      leg: 'return',
    });
  }

  return legs;
});

/** Admin-only. Every call site is greppable because this is a method, not a virtual. */
bookingSchema.methods.revealPassengerDocuments = function revealPassengerDocuments() {
  if (!this.passengers || this.passengers.length === 0) return [];

  return this.passengers.map((p) => ({
    name: `${p.firstName} ${p.lastName}`.trim(),
    type: p.type,
    dateOfBirth: p.dateOfBirth,
    cnic: p.cnic || 'Not provided',
    passportNumber: p.passportNumber || 'Not provided',
    passportExpiry: p.passportExpiry || null,
    nationality: p.nationality || 'Not provided',
    address: p.address || 'Not provided',
  }));
};

bookingSchema.set('toJSON', { virtuals: true });
bookingSchema.set('toObject', { virtuals: true });

bookingSchema.statics.TRIP_TYPES = TRIP_TYPES;

module.exports = mongoose.model('Booking', bookingSchema);