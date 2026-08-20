// backend/src/models/Hotel.js
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
  distanceInMeters: {
    type: Number,
    default: 0
  },
  description: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  starRating: {
    type: Number,
    min: 0,
    max: 5,
    default: 3
  },
  images: [{
    url: String,
    publicId: String
  }],
  amenities: {
    type: [String],
    default: []
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

hotelSchema.index({ city: 1 });
hotelSchema.index({ isActive: 1 });
hotelSchema.index({ name: 1 });

module.exports = mongoose.model('Hotel', hotelSchema);