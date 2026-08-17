const { User, Booking, Ledger } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Refuse an action that would leave the system with no way in.
 *
 * Demoting or deactivating the last admin is unrecoverable through the API —
 * the fix is a database edit or a re-run of the seeder, which is exactly the
 * kind of 2am problem worth preventing at the source.
 */
const assertNotLastAdmin = async (targetUser, { becomingInactive = false, becomingUser = false } = {}) => {
  if (targetUser.role !== 'admin') return;
  if (!becomingInactive && !becomingUser) return;

  const otherActiveAdmins = await User.countDocuments({
    _id: { $ne: targetUser._id },
    role: 'admin',
    isActive: true,
  });

  if (otherActiveAdmins === 0) {
    throw AppError.conflict(
      'This is the only active administrator. Promote another user before changing this account.'
    );
  }
};

/** GET /api/users — admin */
exports.getUsers = catchAsync(async (req, res) => {
  const page = req.query.page || 1;
  const limit = req.query.limit || 25;

  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive;

  if (req.query.search) {
    const safe = escapeRegex(req.query.search);
    filter.$or = [
      { name: { $regex: safe, $options: 'i' } },
      { email: { $regex: safe, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    count: users.length,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
    data: users,
  });
});

/** GET /api/users/:id — admin, with a light activity summary */
exports.getUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('User not found');

  const [bookingCount, balance] = await Promise.all([
    Booking.countDocuments({ user: user._id }),
    Ledger.getBalance(user._id),
  ]);

  res.status(200).json({
    success: true,
    data: { ...user.toJSON(), stats: { bookingCount, balance } },
  });
});

/**
 * PATCH /api/users/:id — admin
 *
 * Handles role and activation only. There is deliberately no password field:
 * an admin who could set passwords could take over any account silently,
 * which turns one compromised admin session into full impersonation. Account
 * recovery goes through the user's own reset-by-email flow.
 */
exports.updateUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('User not found');

  const isSelf = String(user._id) === String(req.user._id);

  if (req.body.role !== undefined && req.body.role !== user.role) {
    // Self-demotion is how an admin locks themselves out mid-session.
    if (isSelf) throw AppError.forbidden('You cannot change your own role');
    await assertNotLastAdmin(user, { becomingUser: req.body.role === 'user' });
    user.role = req.body.role;
  }

  if (req.body.isActive !== undefined && req.body.isActive !== user.isActive) {
    if (isSelf) throw AppError.forbidden('You cannot deactivate your own account');
    await assertNotLastAdmin(user, { becomingInactive: req.body.isActive === false });
    user.isActive = req.body.isActive;
  }

  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.phone !== undefined) user.phone = req.body.phone;

  await user.save();

  console.log(`[audit] admin ${req.user._id} updated user ${user._id} (${JSON.stringify(req.body)})`);

  res.status(200).json({ success: true, data: user });
});

/**
 * DELETE /api/users/:id — admin
 *
 * Soft-deletes anyone who has booked or transacted. Hard-deleting them would
 * orphan bookings and ledger entries, and the ledger is meant to be an
 * append-only record — silently removing the party to a transaction defeats
 * the point of keeping one.
 */
exports.deleteUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('User not found');

  if (String(user._id) === String(req.user._id)) {
    throw AppError.forbidden('You cannot delete your own account');
  }

  await assertNotLastAdmin(user, { becomingInactive: true });

  const [bookings, ledgerEntries] = await Promise.all([
    Booking.countDocuments({ user: user._id }),
    Ledger.countDocuments({ user: user._id }),
  ]);

  if (bookings > 0 || ledgerEntries > 0) {
    user.isActive = false;
    await user.save();

    console.log(`[audit] admin ${req.user._id} deactivated user ${user._id} (has records)`);

    return res.status(200).json({
      success: true,
      softDeleted: true,
      message: `User has ${bookings} booking(s) and ${ledgerEntries} ledger entr(ies), so the account was deactivated rather than deleted.`,
      data: user,
    });
  }

  await user.deleteOne();
  console.log(`[audit] admin ${req.user._id} deleted user ${user._id}`);

  return res.status(200).json({ success: true, softDeleted: false, data: {} });
});

/** GET /api/users/:id/bookings — admin */
exports.getUserBookings = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('User not found');

  const bookings = await Booking.find({ user: user._id })
    .populate('flight', 'flightNumber airline origin destination departureTime status')
    .sort({ createdAt: -1 })
    .limit(100);

  res.status(200).json({ success: true, count: bookings.length, data: bookings });
});
