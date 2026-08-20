// backend/src/routes/umrahRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  // Package controllers
  getPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  updatePackageStatus,
  // Booking controllers
  createBooking,
  getBookings,
  getBooking,
  cancelBooking,
  updateBookingStatus,
  // Hotel controllers
  getHotels,
  createHotel,
  updateHotel,
  deleteHotel
} = require('../controllers/umrahController');

// ============================================
// PUBLIC ROUTES
// ============================================

// Package routes (public)
router.get('/packages', getPackages);
router.get('/packages/:id', getPackage);
router.get('/hotels', getHotels);

// ============================================
// PROTECTED ROUTES
// ============================================

router.use(protect);

// Booking routes
router.post('/bookings', createBooking);
router.get('/bookings', getBookings);
router.get('/bookings/:id', getBooking);
router.patch('/bookings/:id/cancel', cancelBooking);

// ============================================
// ADMIN ROUTES
// ============================================

router.use(authorize('admin'));

// Package management
router.post('/packages', createPackage);
router.put('/packages/:id', updatePackage);
router.delete('/packages/:id', deletePackage);
router.patch('/packages/:id/status', updatePackageStatus);

// Booking management
router.patch('/bookings/:id/status', updateBookingStatus);

// Hotel management
router.post('/hotels', createHotel);
router.put('/hotels/:id', updateHotel);
router.delete('/hotels/:id', deleteHotel);

module.exports = router;