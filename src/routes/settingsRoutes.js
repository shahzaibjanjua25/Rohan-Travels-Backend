// backend/src/routes/settingsRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

// Get settings (public - no auth required)
router.get('/', settingsController.getSettings);

// Update settings (admin only)
router.put('/', protect, authorize('admin'), settingsController.updateSettings);

// Reset settings (admin only)
router.post('/reset', protect, authorize('admin'), settingsController.resetSettings);

module.exports = router;