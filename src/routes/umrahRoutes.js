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
// PUBLIC ROUTES (No authentication required)
// ============================================

// Package routes (public - anyone can view packages)
router.get('/packages', getPackages);
router.get('/packages/:id', getPackage);
router.get('/hotels', getHotels);

// ============================================
// PROTECTED ROUTES (Require authentication)
// ============================================

// All routes below this line require authentication
router.use(protect);

// Booking routes (authenticated users)
router.post('/bookings', createBooking);
router.get('/bookings', getBookings);
router.get('/bookings/:id', getBooking);
router.patch('/bookings/:id/cancel', cancelBooking);

// ============================================
// ADMIN ROUTES (Require admin role)
// ============================================

// All routes below this line require admin role
router.use(authorize('admin'));

// Package management (admin only)
router.post('/packages', createPackage);
router.put('/packages/:id', updatePackage);
router.delete('/packages/:id', deletePackage);
router.patch('/packages/:id/status', updatePackageStatus);

// Booking management (admin only)
router.patch('/bookings/:id/status', updateBookingStatus);

// Hotel management (admin only)
router.post('/hotels', createHotel);
router.put('/hotels/:id', updateHotel);
router.delete('/hotels/:id', deleteHotel);

module.exports = router;