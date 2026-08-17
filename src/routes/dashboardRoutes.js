const express = require('express');
const { query } = require('express-validator');

const ctrl = require('../controllers/dashboardController');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

const periodRules = [
  query('period').optional().isIn(['today', '7d', '30d', '90d', '365d', 'mtd', 'ytd', 'all']),
  query('from').optional().isISO8601().withMessage('from must be YYYY-MM-DD'),
  query('to').optional().isISO8601().withMessage('to must be YYYY-MM-DD'),
];

router.use(protect);

router.get('/', periodRules, validate, ctrl.getDashboard);
router.get('/revenue', authorize('admin'), periodRules, validate, ctrl.getRevenueSeries);

module.exports = router;
