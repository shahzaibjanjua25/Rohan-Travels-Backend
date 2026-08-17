const mongoose = require('mongoose');

// Passenger sub-schema for individual passenger details
// Passenger sub-schema for individual passenger details
const passengerSchema = new mongoose.Schema({
  title: {
    type: String,
    enum: ['Mr', 'Mrs', 'Ms', 'Dr', 'Master', 'Miss', ''],
    default: '',
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
  },
  dateOfBirth: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    enum: ['adult', 'infant'],
    default: 'adult',
  },
  seatNumber: {
    type: String,
    default: null,
  },
  passportNumber: {
    type: String,
    default: '',
    trim: true,
  },
  passportExpiry: {
    type: Date,
    default: null,
  },
  nationality: {
    type: String,
    default: '',
    trim: true,
  },
  // ✅ NEW FIELDS
  cnic: {
    type: String,
    default: '',
    trim: true,
  },
  address: {
    type: String,
    default: '',
    trim: true,
  },
});

const bookingSchema = new mongoose.Schema(
  {
    bookingReference: {
      type: String,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    flight: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Flight',
      required: true,
    },
    cabinClass: {
      type: String,
      enum: ['economy', 'business', 'first'],
      default: 'economy',
    },
    flightDetails: {
      flightNumber: String,
      airline: String,
      origin: {
        airportCode: String,
        city: String,
        country: String,
      },
      destination: {
        airportCode: String,
        city: String,
        country: String,
      },
      departureDate: Date,
      arrivalDate: Date,
      price: Number,
    },
    // passengers is now an array of passenger objects
    passengers: [passengerSchema],
    // Keep these for backward compatibility and quick reference
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
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      reason: String,
      refundAmount: Number,
    },
    adminNotes: String,
    statusHistory: [
      {
        status: String,
        date: { type: Date, default: Date.now },
        note: String,
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Generate booking reference before saving
bookingSchema.pre('save', async function (next) {
  if (!this.bookingReference) {
    const count = await mongoose.model('Booking').countDocuments();
    const reference = `BK-${String(count + 1).padStart(6, '0')}`;
    this.bookingReference = reference;
  }
  next();
});

// Virtual for getting passenger count
bookingSchema.virtual('passengerCount').get(function () {
  return this.passengers ? this.passengers.length : 0;
});

// Method to reveal passenger documents (for admin)
bookingSchema.methods.revealPassengerDocuments = function () {
  if (!this.passengers || this.passengers.length === 0) {
    return [];
  }

  return this.passengers.map(p => ({
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

// Ensure virtuals are included in JSON output
bookingSchema.set('toJSON', { virtuals: true });
bookingSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Booking', bookingSchema);