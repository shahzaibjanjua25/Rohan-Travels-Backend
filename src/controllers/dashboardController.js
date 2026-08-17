const mongoose = require('mongoose');

const { Flight, Booking, Ledger, User, Notification } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { resolveRange, customRange, computeRevenue, fillDailySeries, round2 } = require('../utils/reporting');

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * GET /api/dashboard
 *
 * One endpoint, two very different answers. A customer gets their own travel
 * summary; an admin gets business totals. Splitting on role inside the
 * handler keeps the frontend from having to know which to call, but note
 * that the customer branch never touches a company-wide aggregate — there is
 * no filtered-down version of the admin numbers to leak.
 */
exports.getDashboard = catchAsync(async (req, res) => {
  const range = req.query.from && req.query.to
    ? customRange(req.query.from, req.query.to)
    : resolveRange(req.query.period);

  if (!range) throw AppError.badRequest('Invalid date range');

  const data = req.user.role === 'admin'
    ? await adminDashboard(range)
    : await customerDashboard(req.user._id, range);

  res.status(200).json({
    success: true,
    scope: req.user.role === 'admin' ? 'admin' : 'customer',
    period: { label: range.label, from: range.start, to: range.end },
    data,
  });
});

/** Personal summary: spend, trips, upcoming departures. */
async function customerDashboard(userId, range) {
  const [statusCounts, spend, upcoming, unread, balance] = await Promise.all([
    Booking.aggregate([
      { $match: { user: oid(userId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    Booking.aggregate([
      { $match: { user: oid(userId), paymentStatus: 'paid', createdAt: { $gte: range.start, $lt: range.end } } },
      { $group: { _id: null, total: { $sum: '$pricing.totalAmount' }, count: { $sum: 1 } } },
    ]),

    Booking.find({ user: userId, status: { $in: ['pending', 'confirmed'] } })
      .populate({
        path: 'flight',
        match: { departureTime: { $gte: new Date() } },
        select: 'flightNumber airline origin destination departureTime arrivalTime status',
      })
      .sort({ createdAt: -1 })
      .limit(10),

    Notification.unreadCount(userId),
    Ledger.getBalance(userId),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));

  return {
    bookings: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      pending: byStatus.pending || 0,
      confirmed: byStatus.confirmed || 0,
      cancelled: byStatus.cancelled || 0,
      completed: byStatus.completed || 0,
    },
    spendInPeriod: {
      amount: round2(spend[0]?.total || 0),
      bookings: spend[0]?.count || 0,
    },
    accountBalance: round2(balance),
    unreadNotifications: unread,
    // populate() with `match` yields null for flights that failed the filter,
    // so departed trips are stripped here rather than rendered as blanks.
    upcomingTrips: upcoming.filter((b) => b.flight).slice(0, 5),
  };
}

/** Business summary: revenue, volumes, top routes. */
async function adminDashboard(range) {
  const inRange = { createdAt: { $gte: range.start, $lt: range.end } };

  const [
    ledgerTotals,
    bookingStatus,
    dailyBookings,
    flightCounts,
    userCounts,
    topRoutes,
    recentBookings,
  ] = await Promise.all([
    // Revenue comes from the ledger, not from summing booking totals: a
    // booking row shows what was *charged*, the ledger shows what was
    // actually collected and returned.
    Ledger.aggregate([
      { $match: inRange },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    Booking.aggregate([
      { $match: inRange },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$pricing.totalAmount' } } },
    ]),

    Booking.aggregate([
      { $match: inRange },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          amount: { $sum: '$pricing.totalAmount' },
        },
      },
    ]),

    Flight.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } } } },
    ]),

    Booking.aggregate([
      { $match: { ...inRange, status: { $ne: 'cancelled' } } },
      { $lookup: { from: 'flights', localField: 'flight', foreignField: '_id', as: 'f' } },
      { $unwind: '$f' },
      {
        $group: {
          _id: { from: '$f.origin.airportCode', to: '$f.destination.airportCode' },
          bookings: { $sum: 1 },
          seats: { $sum: { $size: '$passengers' } },
          revenue: { $sum: '$pricing.totalAmount' },
        },
      },
      { $sort: { bookings: -1 } },
      { $limit: 5 },
    ]),

    Booking.find(inRange)
      .populate('flight', 'flightNumber origin destination departureTime')
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .limit(10),
  ]);

  const byCategory = Object.fromEntries(ledgerTotals.map((l) => [l._id, l.total]));
  const revenue = computeRevenue({
    payments: byCategory.booking_payment || 0,
    refunds: byCategory.refund || 0,
    cancellationFees: byCategory.cancellation_fee || 0,
    serviceFees: byCategory.service_fee || 0,
  });

  const bookingsByStatus = Object.fromEntries(bookingStatus.map((b) => [b._id, b.count]));
  const flightsByStatus = Object.fromEntries(flightCounts.map((f) => [f._id, f.count]));
  const usersByRole = Object.fromEntries(userCounts.map((u) => [u._id, { total: u.count, active: u.active }]));

  const totalBookings = Object.values(bookingsByStatus).reduce((a, b) => a + b, 0);
  const cancelled = bookingsByStatus.cancelled || 0;

  return {
    revenue,
    bookings: {
      total: totalBookings,
      pending: bookingsByStatus.pending || 0,
      confirmed: bookingsByStatus.confirmed || 0,
      cancelled,
      completed: bookingsByStatus.completed || 0,
      cancellationRate: totalBookings ? round2((cancelled / totalBookings) * 100) : 0,
    },
    flights: {
      total: Object.values(flightsByStatus).reduce((a, b) => a + b, 0),
      scheduled: flightsByStatus.scheduled || 0,
      cancelled: flightsByStatus.cancelled || 0,
      departed: flightsByStatus.departed || 0,
    },
    users: {
      total: (usersByRole.user?.total || 0) + (usersByRole.admin?.total || 0),
      customers: usersByRole.user?.total || 0,
      admins: usersByRole.admin?.total || 0,
      inactive:
        (usersByRole.user?.total || 0) + (usersByRole.admin?.total || 0) -
        ((usersByRole.user?.active || 0) + (usersByRole.admin?.active || 0)),
    },
    dailyBookings: fillDailySeries(dailyBookings, range.start, range.end),
    topRoutes: topRoutes.map((r) => ({
      route: `${r._id.from} → ${r._id.to}`,
      bookings: r.bookings,
      seats: r.seats,
      revenue: round2(r.revenue),
    })),
    recentBookings,
  };
}

/**
 * GET /api/dashboard/revenue — admin
 * Daily revenue series for charting.
 */
exports.getRevenueSeries = catchAsync(async (req, res) => {
  const range = req.query.from && req.query.to
    ? customRange(req.query.from, req.query.to)
    : resolveRange(req.query.period);

  if (!range) throw AppError.badRequest('Invalid date range');

  const rows = await Ledger.aggregate([
    { $match: { createdAt: { $gte: range.start, $lt: range.end }, category: { $in: ['booking_payment', 'refund'] } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        // Refunds subtract, so the series shows net rather than gross intake.
        amount: {
          $sum: { $cond: [{ $eq: ['$category', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({
    success: true,
    period: { label: range.label, from: range.start, to: range.end },
    data: fillDailySeries(rows, range.start, range.end),
  });
});
