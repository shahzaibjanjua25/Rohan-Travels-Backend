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
    type: String,
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
  }
}, { _id: false });

const sharingPricingSchema = new mongoose.Schema({
  single: { type: Number, default: 0 },
  double: { type: Number, default: 0 },
  triple: { type: Number, default: 0 },
  quad: { type: Number, default: 0 },
  sharing: { type: Number, default: 0 } // For 5+ people sharing
}, { _id: false });

const umrahPackageSchema = new mongoose.Schema({
  packageName: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
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
    type: Number,
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
  baggageAllowance: {
    departure: { type: String, default: '23 KG' },
    arrival: { type: String, default: '46 KG' }
  },
  makkahHotel: {
    type: hotelSchema,
    required: true
  },
  makkahReturnHotel: {
    type: hotelSchema,
    default: null
  },
  madinahHotel: {
    type: hotelSchema,
    required: true
  },
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
  totalSeats: {
    type: Number,
    default: 0
  },
  includes: {
    type: [String],
    default: ['Visa', 'Ticket', 'Accommodation', 'Transport']
  },
  // ✨ NEW: Ziyarat Package Pricing
  ziyaratEnabled: {
    type: Boolean,
    default: false
  },
  ziyaratPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  ziyaratDescription: {
    type: String,
    default: 'Guided Ziyarat tour of holy sites in Makkah and Madinah'
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
  }
}, { timestamps: true });

// Indexes
umrahPackageSchema.index({ departureDate: 1 });
umrahPackageSchema.index({ airline: 1 });
umrahPackageSchema.index({ 'origin.city': 1 });
umrahPackageSchema.index({ isActive: 1 });
umrahPackageSchema.index({ isFeatured: 1 });

// Virtual for lowest price
umrahPackageSchema.virtual('lowestPrice').get(function() {
  const prices = [
    this.sharingPrices?.single,
    this.sharingPrices?.double,
    this.sharingPrices?.triple,
    this.sharingPrices?.quad,
    this.sharingPrices?.sharing,
    this.perPersonPrice
  ].filter(p => p && p > 0);
  return prices.length ? Math.min(...prices) : this.perPersonPrice;
});

umrahPackageSchema.set('toJSON', { virtuals: true });
umrahPackageSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('UmrahPackage', umrahPackageSchema);