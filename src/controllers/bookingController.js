// backend/src/controllers/bookingController.js
const { Flight, Booking, Ledger, Notification, Settings, User } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { sendEmail } = require('../config/email');
const config = require('../config/env');
const { computePricing, canCancel, computeRefund, canBook } = require('../utils/bookingPolicy');
const {
  reserveSeats,
  releaseSeats,
  explainReservationFailure,
  getOccupiedSeats,
  findSeatConflicts,
} = require('../utils/seatInventory');

/** Owner or admin. Everyone else gets 404 rather than 403. */
const assertCanView = (booking, user) => {
  const isOwner = String(booking.user?._id || booking.user) === String(user._id);
  if (isOwner || user.role === 'admin') return;
  throw AppError.notFound('Booking not found');
};

/** Append a ledger entry with a freshly derived running balance. */
const postLedgerEntry = async ({
  user,
  booking,
  type,
  category,
  amount,
  description,
  paymentMethod,
  createdBy,
  transactionId,
}) => {
  const balance = await Ledger.getBalance(user);
  const delta = type === 'credit' ? amount : -amount;

  return Ledger.create({
    user,
    booking,
    type,
    category,
    amount,
    description,
    paymentMethod: paymentMethod || 'system',
    transactionId,
    balanceAfter: Math.round((balance + delta) * 100) / 100,
    createdBy: createdBy || user,
  });
};

/** Fire-and-forget side effects. A failed notice must not roll back a booking. */
const notifySafely = async (fn, label) => {
  try {
    await fn();
  } catch (err) {
    console.error(`[booking] ${label} failed: ${err.message}`);
  }
};

// ---------------------------------------------------------------------------
// Itinerary helpers
// ---------------------------------------------------------------------------

/**
 * Freeze the itinerary as it stands right now.
 *
 * The booking must keep describing what the customer was actually sold. If it
 * read through to the live Flight document instead, an admin rescheduling a
 * departure would silently rewrite every historical ticket on that route.
 */
const snapshotItinerary = (flight, cabinPrice) => ({
  flightNumber: flight.flightNumber,
  airline: flight.airline,
  aircraft: flight.aircraft,
  tripType: flight.tripType || 'one_way',
  origin: flight.origin,
  destination: flight.destination,
  departureDate: flight.departureTime,
  arrivalDate: flight.arrivalTime,
  segments:
    flight.tripType === 'multi_city' && flight.segments?.length
      ? flight.segments.map((s) => ({
          origin: s.origin,
          destination: s.destination,
          departureTime: s.departureTime,
          arrivalTime: s.arrivalTime,
          flightNumber: s.flightNumber,
          airline: s.airline,
          aircraft: s.aircraft,
        }))
      : [],
  returnSegment:
    flight.tripType === 'round_trip' && flight.returnSegment
      ? {
          departureTime: flight.returnSegment.departureTime,
          arrivalTime: flight.returnSegment.arrivalTime,
          flightNumber: flight.returnSegment.flightNumber,
          aircraft: flight.returnSegment.aircraft,
        }
      : undefined,
  price: cabinPrice,
});

/** One human-readable line describing the route, for emails and logs. */
const describeRoute = (flight) => {
  if (flight.tripType === 'multi_city' && flight.segments?.length) {
    const chain = [
      flight.segments[0].origin?.airportCode,
      ...flight.segments.map((s) => s.destination?.airportCode),
    ].filter(Boolean);
    return `${chain.join(' -> ')} (multi-city, ${flight.segments.length} legs)`;
  }

  const base = `${flight.origin?.airportCode} -> ${flight.destination?.airportCode}`;
  if (flight.tripType === 'round_trip') {
    return `${base} -> ${flight.origin?.airportCode} (round trip)`;
  }
  return `${base} (one way)`;
};

/** Notify every admin about a new booking. */
const notifyAdminsAboutBooking = async (booking, flight, customerName) => {
  try {
    const admins = await User.find({ role: 'admin' }).select('_id');
    if (admins.length === 0) return;

    const notifications = admins.map((admin) => ({
      user: admin._id,
      title: 'New Booking Alert',
      message: `Booking ${booking.bookingReference} created by ${customerName || 'a customer'} for flight ${flight.flightNumber} (${describeRoute(flight)})`,
      type: 'booking',
      priority: 'high',
      relatedBooking: booking._id,
      relatedFlight: flight._id,
      link: `/bookings/${booking._id}`,
    }));

    await Notification.insertMany(notifications);
  } catch (error) {
    console.error('[booking] admin notification failed:', error.message);
  }
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * POST /api/bookings
 *
 * Seat inventory lives on the Flight document, and a Flight document is a
 * whole itinerary. So a three-leg multi-city trip reserves seats with the same
 * single atomic update as a one-way hop — there is no window in which leg one
 * is held and leg two turns out to be sold out.
 */
exports.createBooking = catchAsync(async (req, res) => {
  const {
    flightId,
    cabinClass,
    passengers,
    contactEmail,
    contactPhone,
    customerName,
    customerAddress,
    customerCnic,
    customerPassport,
    specialRequests,
  } = req.body;

  if (!flightId) throw AppError.badRequest('Flight ID is required');
  if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
    throw AppError.badRequest('At least one passenger is required');
  }
  if (!contactEmail) throw AppError.badRequest('Contact email is required');
  if (!contactPhone) throw AppError.badRequest('Contact phone is required');

  const seatCount = passengers.length;
  const cabin = cabinClass || 'economy';

  const settings = await Settings.getSettings();
  const flight = await Flight.findById(flightId);
  if (!flight) throw AppError.notFound('Flight not found');

  const eligibility = canBook({ flight, settings, seatCount, cabinClass: cabin });
  if (!eligibility.allowed) throw AppError.conflict(eligibility.reason);

  // Seat numbers, if the customer picked any.
  const requestedSeats = passengers.map((p) => p.seatNumber).filter(Boolean);
  if (new Set(requestedSeats).size !== requestedSeats.length) {
    throw AppError.badRequest('The same seat was requested for more than one passenger');
  }
  if (requestedSeats.length) {
    const taken = await findSeatConflicts(flight._id, requestedSeats);
    if (taken.length) throw AppError.conflict(`Seat(s) already taken: ${taken.join(', ')}`);
  }

  // --- the atomic step -----------------------------------------------------
  const reserved = await reserveSeats({ flightId: flight._id, cabinClass: cabin, seatCount });
  if (!reserved) {
    throw await explainReservationFailure({ flightId: flight._id, cabinClass: cabin, seatCount });
  }

  // From here on, seats are held. Every failure path must give them back.
  let booking;
  try {
    const cabinPrice = flight.cabins[cabin]?.price ?? flight.cabins.economy.price;

    const pricing = computePricing({
      pricePerSeat: cabinPrice,
      seatCount,
      taxRatePercent: settings.booking.taxRatePercent || 0,
      serviceFee: settings.booking.serviceFee || 0,
      currency: settings.defaultCurrency || 'PKR',
    });

    const count = await Booking.countDocuments();
    const bookingReference = `BK-${String(count + 1).padStart(6, '0')}`;

    const passengerDetails = passengers.map((p) => ({
      title: p.title || '',
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      dateOfBirth: p.dateOfBirth || '',
      type: p.type || 'adult',
      seatNumber: p.seatNumber || null,
      passportNumber: p.passportNumber || '',
      passportExpiry: p.passportExpiry || null,
      nationality: p.nationality || '',
      cnic: p.cnic || '',
      address: p.address || '',
    }));

    const adults = passengers.filter((p) => p.type !== 'infant').length || 1;
    const infants = passengers.filter((p) => p.type === 'infant').length || 0;

    booking = new Booking({
      user: req.user._id,
      flight: flight._id,
      cabinClass: cabin,
      passengers: passengerDetails,
      passengerCounts: { adults, infants, totalSeats: passengers.length },
      pricing: {
        pricePerSeat: pricing.pricePerSeat,
        seatCount,
        subtotal: pricing.subtotal,
        taxes: pricing.taxes,
        fees: pricing.fees,
        totalAmount: pricing.totalAmount,
        currency: pricing.currency || 'PKR',
      },
      customerDetails: {
        name: customerName || contactEmail || '',
        email: contactEmail || '',
        phone: contactPhone || '',
        address: customerAddress || '',
        cnic: customerCnic || '',
        passportNumber: customerPassport || '',
        specialRequests: specialRequests || '',
      },
      flightDetails: snapshotItinerary(flight, cabinPrice),
      status: 'pending',
      paymentStatus: 'unpaid',
      bookingReference,
    });

    await booking.save();

    // Seat *numbers* have no single-document precondition to hang an atomic
    // update on, so this is check-then-verify: look again after writing and
    // roll back if someone slipped in during the gap.
    if (requestedSeats.length) {
      const conflicts = await findSeatConflicts(flight._id, requestedSeats, booking._id);
      if (conflicts.length) {
        await booking.deleteOne();
        throw AppError.conflict(`Seat(s) were taken while you were booking: ${conflicts.join(', ')}`);
      }
    }
  } catch (err) {
    // Compensating action for the reservation above.
    await releaseSeats({ flightId: flight._id, cabinClass: cabin, seatCount });
    throw err;
  }

  await notifySafely(
    () =>
      Notification.create({
        user: req.user._id,
        title: 'Booking created',
        message: `Your booking ${booking.bookingReference} on flight ${flight.flightNumber} (${describeRoute(flight)}) is held pending payment.`,
        type: 'booking',
        relatedBooking: booking._id,
        relatedFlight: flight._id,
        link: `/bookings/${booking._id}`,
      }),
    'customer notification'
  );

  await notifyAdminsAboutBooking(booking, flight, customerName || contactEmail);

  const itineraryLines =
    flight.tripType === 'multi_city' && flight.segments?.length
      ? flight.segments
          .map(
            (s, i) =>
              `  Leg ${i + 1}: ${s.origin?.airportCode} -> ${s.destination?.airportCode}  ${new Date(s.departureTime).toISOString()}`
          )
          .join('\n')
      : flight.tripType === 'round_trip' && flight.returnSegment
        ? `  Out: ${flight.origin?.airportCode} -> ${flight.destination?.airportCode}  ${flight.departureTime.toISOString()}\n` +
          `  Back: ${flight.destination?.airportCode} -> ${flight.origin?.airportCode}  ${new Date(flight.returnSegment.departureTime).toISOString()}`
        : `  ${flight.origin?.airportCode} -> ${flight.destination?.airportCode}  ${flight.departureTime.toISOString()}`;

  await notifySafely(
    () =>
      sendEmail({
        to: settings.supportEmail || config.email.user,
        subject: `New booking ${booking.bookingReference} (${flight.flightNumber})`,
        text:
          `A new booking has been created.\n\n` +
          `Reference:  ${booking.bookingReference}\n` +
          `Flight:     ${flight.flightNumber}\n` +
          `Trip type:  ${flight.tripType || 'one_way'}\n` +
          `Itinerary:\n${itineraryLines}\n\n` +
          `Cabin:      ${cabin}\n` +
          `Seats:      ${seatCount}\n` +
          `Passengers: ${passengers.map((p) => `${p.firstName} ${p.lastName}`.trim()).join(', ')}\n` +
          `Contact:    ${customerName || contactEmail} | ${contactPhone}\n` +
          `Address:    ${customerAddress || 'Not provided'}\n` +
          `CNIC:       ${customerCnic || 'Not provided'}\n` +
          `Passport:   ${customerPassport || 'Not provided'}\n` +
          `Total:      ${booking.pricing.totalAmount} ${booking.pricing.currency}\n\n` +
          `View here (sign-in required):\n${config.frontendUrl}/bookings/${booking._id}\n`,
      }),
    'admin email notification'
  );

  res.status(201).json({ success: true, data: booking });
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** GET /api/bookings — customers see their own; admins see everything. */
exports.getBookings = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const filter = {};
  if (req.user.role !== 'admin') filter.user = req.user._id;
  else if (req.query.user) filter.user = req.query.user;

  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
  if (req.query.tripType) filter['flightDetails.tripType'] = req.query.tripType;

  const sort = req.query.sort === 'createdAt' ? { createdAt: 1 } : { createdAt: -1 };

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .populate(
        'flight',
        'flightNumber airline origin destination departureTime arrivalTime status tripType segments returnSegment'
      )
      .populate('user', 'name email')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    Booking.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    count: bookings.length,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      pages: Math.ceil(total / limit) || 1,
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
    data: bookings,
  });
});

/** GET /api/bookings/:id */
exports.getBooking = catchAsync(async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate('flight')
    .populate('user', 'name email phone');

  if (!booking) throw AppError.notFound('Booking not found');
  assertCanView(booking, req.user);

  res.status(200).json({ success: true, data: booking });
});

/** GET /api/bookings/:id/documents — admin only, audited. */
exports.getBookingDocuments = catchAsync(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw AppError.notFound('Booking not found');

  console.log(
    `[audit] admin ${req.user._id} read travel documents for booking ${booking.bookingReference}`
  );

  res.status(200).json({
    success: true,
    bookingReference: booking.bookingReference,
    data: booking.revealPassengerDocuments ? booking.revealPassengerDocuments() : [],
  });
});

/** GET /api/bookings/flights/:flightId/seats */
exports.getFlightSeatMap = catchAsync(async (req, res) => {
  const flight = await Flight.findById(req.params.flightId);
  if (!flight) throw AppError.notFound('Flight not found');

  const occupied = await getOccupiedSeats(flight._id);

  res.status(200).json({
    success: true,
    data: {
      flightNumber: flight.flightNumber,
      tripType: flight.tripType || 'one_way',
      // Seats are held across the whole itinerary, so one seat map covers
      // every leg rather than one per segment.
      occupiedSeats: occupied,
      cabins: {
        economy: flight.cabins.economy,
        business: flight.cabins.business,
        first: flight.cabins.first,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Mutate
// ---------------------------------------------------------------------------

/** PATCH /api/bookings/:id/cancel */
exports.cancelBooking = catchAsync(async (req, res) => {
  const existing = await Booking.findById(req.params.id).populate('flight');
  if (!existing) throw AppError.notFound('Booking not found');
  assertCanView(existing, req.user);

  const settings = await Settings.getSettings();
  const verdict = canCancel({ booking: existing, flight: existing.flight, settings });
  if (!verdict.allowed) throw AppError.conflict(verdict.reason);

  const { refundAmount, feeApplied } = computeRefund({
    booking: existing,
    flight: existing.flight,
    settings,
  });

  const booking = await Booking.findOneAndUpdate(
    { _id: existing._id, status: { $in: ['pending', 'confirmed'] } },
    {
      $set: {
        status: 'cancelled',
        paymentStatus: existing.paymentStatus === 'paid' ? 'refunded' : existing.paymentStatus,
        'cancellation.cancelledAt': new Date(),
        'cancellation.cancelledBy': req.user._id,
        'cancellation.reason': req.body.reason || verdict.reason,
        'cancellation.refundAmount': refundAmount,
      },
    },
    { new: true }
  );

  if (!booking) throw AppError.conflict('This booking was already cancelled');

  const seatCount = booking.passengers
    ? booking.passengers.length
    : booking.passengerCounts?.totalSeats || 0;

  // One release covers the whole itinerary, including every multi-city leg.
  await releaseSeats({
    flightId: existing.flight._id,
    cabinClass: existing.cabinClass || 'economy',
    seatCount,
  });

  if (refundAmount > 0) {
    await notifySafely(
      () =>
        postLedgerEntry({
          user: existing.user,
          booking: booking._id,
          type: 'credit',
          category: 'refund',
          amount: refundAmount,
          description: `Refund for cancelled booking ${booking.bookingReference}`,
          createdBy: req.user._id,
        }),
      'refund ledger entry'
    );
  }

  if (feeApplied > 0) {
    await notifySafely(
      () =>
        postLedgerEntry({
          user: existing.user,
          booking: booking._id,
          type: 'debit',
          category: 'cancellation_fee',
          amount: feeApplied,
          description: `Cancellation fee for ${booking.bookingReference}`,
          createdBy: req.user._id,
        }),
      'cancellation fee ledger entry'
    );
  }

  await notifySafely(
    () =>
      Notification.create({
        user: existing.user,
        title: 'Booking cancelled',
        message: `Booking ${booking.bookingReference} was cancelled. Refund: ${refundAmount} ${booking.pricing.currency}.`,
        type: 'booking',
        relatedBooking: booking._id,
        link: `/bookings/${booking._id}`,
      }),
    'cancellation notification'
  );

  res.status(200).json({ success: true, data: booking, refund: { refundAmount, feeApplied } });
});

/** PATCH /api/bookings/:id/pay — admin */
exports.markPaid = catchAsync(async (req, res) => {
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, paymentStatus: 'unpaid', status: { $in: ['pending', 'confirmed'] } },
    { $set: { paymentStatus: 'paid', status: 'confirmed' } },
    { new: true }
  );

  if (!booking) {
    const exists = await Booking.findById(req.params.id);
    if (!exists) throw AppError.notFound('Booking not found');
    throw AppError.conflict(`Booking is ${exists.status} and ${exists.paymentStatus}`);
  }

  await postLedgerEntry({
    user: booking.user,
    booking: booking._id,
    type: 'debit',
    category: 'booking_payment',
    amount: booking.pricing.totalAmount,
    description: `Payment for booking ${booking.bookingReference}`,
    paymentMethod: req.body.paymentMethod || 'card',
    transactionId: req.body.transactionId,
    createdBy: req.user._id,
  });

  await notifySafely(
    () =>
      Notification.create({
        user: booking.user,
        title: 'Booking confirmed',
        message: `Payment received. Booking ${booking.bookingReference} is confirmed.`,
        type: 'payment',
        relatedBooking: booking._id,
        link: `/bookings/${booking._id}`,
      }),
    'payment notification'
  );

  res.status(200).json({ success: true, data: booking });
});

/** PATCH /api/bookings/:id/status — admin */
exports.updateBookingStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // Cancelling releases seats and may post a refund, so it has to go through
  // the cancel route rather than a bare status write.
  if (status === 'cancelled') {
    throw AppError.badRequest('Use PATCH /api/bookings/:id/cancel to cancel a booking');
  }

  const allowedStatuses = ['pending', 'confirmed', 'completed'];
  if (!allowedStatuses.includes(status)) {
    throw AppError.badRequest(`Status must be one of: ${allowedStatuses.join(', ')}`);
  }

  const result = await Booking.updateOne(
    { _id: id },
    {
      $set: {
        status,
        ...(status === 'confirmed' && { paymentStatus: 'paid' }),
      },
      $push: {
        statusHistory: {
          status,
          date: new Date(),
          note: `Status changed to ${status} by admin`,
          updatedBy: req.user._id,
        },
      },
    }
  );

  if (result.matchedCount === 0) throw AppError.notFound('Booking not found');

  const updatedBooking = await Booking.findById(id);

  res.status(200).json({
    success: true,
    data: updatedBooking,
    message: `Booking status updated to ${status}`,
  });
});