const express = require('express');

const ctrl = require('../controllers/userController');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');
const { listUserRules, updateUserRules, userIdRule } = require('../validators/userValidators');

const router = express.Router();

// Every route here is administrative.
router.use(protect, authorize('admin'));

router.get('/', listUserRules, validate, ctrl.getUsers);
router.get('/:id', userIdRule, validate, ctrl.getUser);
router.get('/:id/bookings', userIdRule, validate, ctrl.getUserBookings);
router.patch('/:id', updateUserRules, validate, ctrl.updateUser);
router.delete('/:id', userIdRule, validate, ctrl.deleteUser);

module.exports = router;
