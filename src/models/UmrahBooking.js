// backend/src/models/UmrahBooking.js
const mongoose = require('mongoose');

const umrahBookingSchema = new mongoose.Schema({
  package: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UmrahPackage',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bookingReference: {
    type: String,
    unique: true,
    trim: true
  },
  passengers: [{
    title: { type: String, enum: ['Mr', 'Mrs', 'Ms', 'Dr', 'Master', 'Miss'], default: 'Mr' },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    passportNumber: { type: String, trim: true },
    passportExpiry: { type: Date },
    nationality: { type: String, default: 'Pakistani' },
    cnic: { type: String, trim: true },
    type: { type: String, enum: ['adult', 'child', 'infant'], default: 'adult' }
  }],
  roomType: {
    type: String,
    enum: ['quad', 'triple', 'double'],
    default: 'quad'
  },
  pricing: {
    basePrice: { type: Number, required: true },
    sharingPrice: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    currency: { type: String, default: 'PKR' }
  },
  customerDetails: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, default: '' },
    cnic: { type: String, default: '' },
    passportNumber: { type: String, default: '' }
  },
  specialRequests: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'refunded', 'failed'],
    default: 'unpaid'
  },
  cancellation: {
    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    refundAmount: Number
  },
  adminNotes: String,
  statusHistory: [{
    status: String,
    date: { type: Date, default: Date.now },
    note: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }]
}, { timestamps: true });

// Pre-save hook to generate booking reference
umrahBookingSchema.pre('save', async function(next) {
  if (this.bookingReference) return next();
  const count = await mongoose.model('UmrahBooking').countDocuments();
  this.bookingReference = `UMR-${String(count + 1).padStart(6, '0')}`;
  return next();
});

umrahBookingSchema.virtual('passengerCount').get(function() {
  return this.passengers ? this.passengers.length : 0;
});

umrahBookingSchema.set('toJSON', { virtuals: true });
umrahBookingSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('UmrahBooking', umrahBookingSchema);