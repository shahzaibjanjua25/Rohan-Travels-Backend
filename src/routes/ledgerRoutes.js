const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ledgerController = require('../controllers/ledgerController');

// All ledger routes require authentication
router.use(protect);

// User routes
router.get('/balance', ledgerController.getBalance);
router.get('/entries', ledgerController.getEntries);
router.get('/entries/:id', ledgerController.getEntry);
router.get('/summary', ledgerController.getSummary);

// Admin only routes
router.post('/entries', authorize('admin'), ledgerController.createEntry);

module.exports = router;