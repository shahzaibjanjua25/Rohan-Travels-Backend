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
const postLedgerEntry = async ({ user, booking, type, category, amount, description, paymentMethod, createdBy, transactionId }) => {
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

/**
 * Fire-and-forget side effects.
 */
const notifySafely = async (fn, label) => {
  try {
    await fn();
  } catch (err) {
    console.error(`[booking] ${label} failed: ${err.message}`);
  }
};

/**
 * Notify all admins about a new booking
 */
const notifyAdminsAboutBooking = async (booking, flight, customerName) => {
  try {
    const admins = await User.find({ role: 'admin' }).select('_id');
    
    if (admins.length === 0) return;
    
    const notifications = admins.map(admin => ({
      user: admin._id,
      title: '📋 New Booking Alert',
      message: `A new booking (${booking.bookingReference}) has been created by ${customerName || 'a customer'} for flight ${flight.flightNumber}`,
      type: 'booking',
      priority: 'high',
      relatedBooking: booking._id,
      relatedFlight: flight._id,
      link: `/admin/bookings/${booking._id}`,
    }));
    
    await Notification.insertMany(notifications);
    console.log(`✅ Notified ${admins.length} admin(s) about new booking`);
  } catch (error) {
    console.error('❌ Failed to notify admins:', error.message);
  }
};

/**
 * POST /api/bookings
 * 
 * Creates a new booking with full passenger details
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
    specialRequests
  } = req.body;

  console.log('📦 Received booking data:', {
    flightId,
    cabinClass,
    passengerCount: passengers?.length,
    contactEmail,
    contactPhone,
    customerName,
    customerAddress,
    customerCnic,
    customerPassport,
    specialRequests
  });

  // Validate required fields
  if (!flightId) throw AppError.badRequest('Flight ID is required');
  if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
    throw AppError.badRequest('At least one passenger is required');
  }
  if (!contactEmail) throw AppError.badRequest('Contact email is required');
  if (!contactPhone) throw AppError.badRequest('Contact phone is required');

  const seatCount = passengers.length;

  const settings = await Settings.getSettings();
  const flight = await Flight.findById(flightId);
  if (!flight) throw AppError.notFound('Flight not found');

  const eligibility = canBook({ flight, settings, seatCount, cabinClass: cabinClass || 'economy' });
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

  // --- the atomic step ---
  const reserved = await reserveSeats({ flightId: flight._id, cabinClass: cabinClass || 'economy', seatCount });
  if (!reserved) throw await explainReservationFailure({ flightId: flight._id, cabinClass: cabinClass || 'economy', seatCount });

  // From here on, seats are held. Every failure path must give them back.
  let booking;
  try {
    const cabinPrice = flight.cabins[cabinClass || 'economy']?.price || flight.cabins.economy.price;

    const pricing = computePricing({
      pricePerSeat: cabinPrice,
      seatCount,
      taxRatePercent: settings.booking.taxRatePercent || 0,
      serviceFee: settings.booking.serviceFee || 0,
      currency: settings.defaultCurrency || 'PKR',
    });

    // Generate booking reference
    const count = await Booking.countDocuments();
    const bookingReference = `BK-${String(count + 1).padStart(6, '0')}`;

    // Store individual passenger details in an array
    const passengerDetails = passengers.map(p => ({
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

    // Calculate passenger counts
    const adults = passengers.filter(p => p.type !== 'infant').length || 1;
    const infants = passengers.filter(p => p.type === 'infant').length || 0;
    const totalSeats = passengers.length;

    console.log('🔍 RECEIVED CUSTOMER FIELDS:');
    console.log('  customerAddress:', customerAddress);
    console.log('  customerCnic:', customerCnic);
    console.log('  customerPassport:', customerPassport);
    console.log('  specialRequests:', specialRequests);

    // CREATE BOOKING WITH PROPER MAPPING
    booking = new Booking({
      user: req.user._id,
      flight: flight._id,
      cabinClass: cabinClass || 'economy',
      passengers: passengerDetails,
      passengerCounts: {
        adults: adults,
        infants: infants,
        totalSeats: totalSeats,
      },
      pricing: {
        pricePerSeat: pricing.pricePerSeat,
        seatCount: seatCount,
        subtotal: pricing.subtotal,
        taxes: pricing.taxes,
        fees: pricing.serviceFee,
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
      flightDetails: {
        flightNumber: flight.flightNumber,
        airline: flight.airline,
        origin: flight.origin,
        destination: flight.destination,
        departureDate: flight.departureTime,
        arrivalDate: flight.arrivalTime,
        price: cabinPrice,
      },
      status: 'pending',
      paymentStatus: 'unpaid',
      bookingReference: bookingReference,
    });

    console.log('💾 SAVED CUSTOMER DETAILS:', booking.customerDetails);

    await booking.save();

    console.log('✅ Booking saved with customer details:', {
      name: booking.customerDetails.name,
      email: booking.customerDetails.email,
      phone: booking.customerDetails.phone,
      address: booking.customerDetails.address,
      cnic: booking.customerDetails.cnic,
      passportNumber: booking.customerDetails.passportNumber,
      specialRequests: booking.customerDetails.specialRequests
    });

    // Verify step for seat numbers
    if (requestedSeats.length) {
      const conflicts = await findSeatConflicts(flight._id, requestedSeats, booking._id);
      if (conflicts.length) {
        await booking.deleteOne();
        throw AppError.conflict(`Seat(s) were taken while you were booking: ${conflicts.join(', ')}`);
      }
    }
  } catch (err) {
    // Compensating action
    await releaseSeats({ flightId: flight._id, cabinClass: cabinClass || 'economy', seatCount });
    throw err;
  }

  // Send customer notification
  await notifySafely(
    () =>
      Notification.create({
        user: req.user._id,
        title: 'Booking created',
        message: `Your booking ${booking.bookingReference} on flight ${flight.flightNumber} is held pending payment.`,
        type: 'booking',
        relatedBooking: booking._id,
        relatedFlight: flight._id,
        link: `/bookings/${booking._id}`,
      }),
    'customer notification'
  );

  // Notify all admins about the new booking
  await notifyAdminsAboutBooking(booking, flight, customerName || contactEmail);

  // Admin email alert
  await notifySafely(
    () =>
      sendEmail({
        to: settings.supportEmail || config.email.user,
        subject: `New booking ${booking.bookingReference} (${flight.flightNumber})`,
        text:
          `A new booking has been created.\n\n` +
          `Reference: ${booking.bookingReference}\n` +
          `Flight:    ${flight.flightNumber} ${flight.origin.airportCode} to ${flight.destination.airportCode}\n` +
          `Departs:   ${flight.departureTime.toISOString()}\n` +
          `Cabin:     ${cabinClass || 'economy'}\n` +
          `Seats:     ${seatCount}\n` +
          `Passengers: ${passengers.map(p => `${p.firstName} ${p.lastName}`.trim()).join(', ')}\n` +
          `Contact:   ${customerName || contactEmail} | ${contactPhone}\n` +
          `Address:   ${customerAddress || 'Not provided'}\n` +
          `CNIC:      ${customerCnic || 'Not provided'}\n` +
          `Passport:  ${customerPassport || 'Not provided'}\n` +
          `Total:     ${booking.pricing.totalAmount} ${booking.pricing.currency}\n\n` +
          `View here (sign-in required):\n` +
          `${config.frontendUrl}/admin/bookings/${booking._id}\n`,
      }),
    'admin email notification'
  );

  res.status(201).json({ success: true, data: booking });
});

/**
 * GET /api/bookings
 * Customers see their own; admins see everything.
 */
exports.getBookings = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  const filter = {};
  if (req.user.role !== 'admin') filter.user = req.user._id;
  else if (req.query.user) filter.user = req.query.user;

  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;

  const sort = req.query.sort === 'createdAt' ? { createdAt: 1 } : { createdAt: -1 };

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .populate('flight', 'flightNumber airline origin destination departureTime arrivalTime status')
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

/**
 * GET /api/bookings/:id/documents — admin only
 */
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

/**
 * PATCH /api/bookings/:id/cancel
 */
exports.cancelBooking = catchAsync(async (req, res) => {
  const existing = await Booking.findById(req.params.id).populate('flight');
  if (!existing) throw AppError.notFound('Booking not found');
  assertCanView(existing, req.user);

  const settings = await Settings.getSettings();
  const verdict = canCancel({ booking: existing, flight: existing.flight, settings });
  if (!verdict.allowed) throw AppError.conflict(verdict.reason);

  const { refundAmount, feeApplied } = computeRefund({ booking: existing, flight: existing.flight, settings });

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

  // Release seats - get count from passengers array or passengerCounts
  const seatCount = booking.passengers ? booking.passengers.length : (booking.passengerCounts?.totalSeats || 0);

  await releaseSeats({
    flightId: existing.flight._id,
    cabinClass: existing.cabinClass || 'economy',
    seatCount: seatCount,
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

/**
 * PATCH /api/bookings/:id/pay — admin
 */
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

/**
 * PATCH /api/bookings/:id/status — admin
 */
exports.updateBookingStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  console.log(`📌 Updating booking ${id} to status: ${status}`);

  // Cancelling has to go through the cancel route
  if (status === 'cancelled') {
    throw AppError.badRequest('Use PATCH /api/bookings/:id/cancel to cancel a booking');
  }

  // Validate status
  const allowedStatuses = ['pending', 'confirmed', 'completed'];
  if (!allowedStatuses.includes(status)) {
    throw AppError.badRequest(`Status must be one of: ${allowedStatuses.join(', ')}`);
  }

  // Use updateOne to bypass validation completely
  const result = await Booking.updateOne(
    { _id: id },
    {
      $set: {
        status: status,
        ...(status === 'confirmed' && { paymentStatus: 'paid' })
      },
      $push: {
        statusHistory: {
          status: status,
          date: new Date(),
          note: `Status changed to ${status} by admin`,
          updatedBy: req.user._id,
        }
      }
    }
  );

  if (result.matchedCount === 0) {
    throw AppError.notFound('Booking not found');
  }

  // Fetch the updated booking
  const updatedBooking = await Booking.findById(id);

  console.log(`✅ Booking ${id} status updated to: ${status}`);

  res.status(200).json({
    success: true,
    data: updatedBooking,
    message: `Booking status updated to ${status}`
  });
});

/**
 * GET /api/bookings/flights/:flightId/seats — which seats are gone
 */
exports.getFlightSeatMap = catchAsync(async (req, res) => {
  const flight = await Flight.findById(req.params.flightId);
  if (!flight) throw AppError.notFound('Flight not found');

  const occupied = await getOccupiedSeats(flight._id);

  res.status(200).json({
    success: true,
    data: {
      flightNumber: flight.flightNumber,
      occupiedSeats: occupied,
      cabins: {
        economy: flight.cabins.economy,
        business: flight.cabins.business,
        first: flight.cabins.first,
      },
    },
  });
});