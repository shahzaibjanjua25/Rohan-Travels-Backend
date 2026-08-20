// backend/src/models/UmrahPackage.js
const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  city: {
    type: String,
    enum: ['makkah', 'madinah'],
    required: true
  },
  distance: {
    type: String, // e.g., "1200 M", "Shuttle"
    default: ''
  },
  nights: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

const sharingPricingSchema = new mongoose.Schema({
  quad: { type: Number, default: 0 },
  triple: { type: Number, default: 0 },
  double: { type: Number, default: 0 }
}, { _id: false });

const umrahPackageSchema = new mongoose.Schema({
  // Flight Details
  airline: {
    type: String,
    required: true,
    trim: true
  },
  airlineCode: {
    type: String,
    trim: true,
    uppercase: true
  },
  flightNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  origin: {
    airportCode: { type: String, required: true, uppercase: true, trim: true },
    city: { type: String, required: true, trim: true }
  },
  destination: {
    airportCode: { type: String, required: true, uppercase: true, trim: true },
    city: { type: String, required: true, trim: true }
  },
  departureDate: {
    type: Date,
    required: true
  },
  departureTime: {
    type: String,
    default: '00:00'
  },
  arrivalDate: {
    type: Date,
    required: true
  },
  arrivalTime: {
    type: String,
    default: '00:00'
  },
  returnDate: {
    type: Date,
    required: true
  },
  returnDepartureTime: {
    type: String,
    default: '00:00'
  },
  returnArrivalDate: {
    type: Date,
    required: true
  },
  returnArrivalTime: {
    type: String,
    default: '00:00'
  },
  duration: {
    type: Number, // in days
    required: true,
    min: 1
  },
  flightType: {
    type: String,
    enum: ['direct', 'connecting'],
    default: 'direct'
  },
  stops: {
    type: Number,
    default: 0
  },
  stopDetails: {
    type: String,
    default: ''
  },
  baggageAllowance: {
    departure: { type: String, default: '23 KG' },
    arrival: { type: String, default: '46 KG' }
  },

  // Hotel Details
  makkahHotel: {
    type: hotelSchema,
    required: true
  },
  madinahHotel: {
    type: hotelSchema,
    required: true
  },

  // Pricing
  perPersonPrice: {
    type: Number,
    required: true,
    min: 0
  },
  sharingPrices: {
    type: sharingPricingSchema,
    default: () => ({})
  },
  childWithoutBedPrice: {
    type: Number,
    default: 0
  },
  infantPrice: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    default: 'PKR',
    uppercase: true
  },

  // Package details
  packageName: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  includes: {
    type: [String],
    default: ['Visa', 'Ticket', 'Accommodation', 'Transport']
  },
  excludes: {
    type: [String],
    default: []
  },
  availableSeats: {
    type: Number,
    default: 0
  },
  totalSeats: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  bookings: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UmrahBooking'
  }]
}, { timestamps: true });

// Indexes for search
umrahPackageSchema.index({ departureDate: 1 });
umrahPackageSchema.index({ airline: 1 });
umrahPackageSchema.index({ 'origin.city': 1 });
umrahPackageSchema.index({ 'destination.city': 1 });
umrahPackageSchema.index({ isActive: 1 });
umrahPackageSchema.index({ isFeatured: 1 });

// Virtual for lowest price
umrahPackageSchema.virtual('lowestPrice').get(function() {
  const prices = [
    this.sharingPrices?.quad,
    this.sharingPrices?.triple,
    this.sharingPrices?.double,
    this.perPersonPrice
  ].filter(p => p && p > 0);
  return prices.length ? Math.min(...prices) : this.perPersonPrice;
});

// Virtual for available seats
umrahPackageSchema.virtual('availableSeatsCount').get(function() {
  return this.availableSeats || 0;
});

umrahPackageSchema.set('toJSON', { virtuals: true });
umrahPackageSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('UmrahPackage', umrahPackageSchema);