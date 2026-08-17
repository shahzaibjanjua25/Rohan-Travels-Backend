/**
 * Booking policy: pricing, cancellation eligibility and refunds.
 *
 * Deliberately pure — no database, no models, no `req`. Money and refund
 * rules are the part of this system where a quiet bug costs real cash, so
 * they live somewhere they can be tested exhaustively without a database.
 */

/** Currency arithmetic to 2dp. Guards against 0.1 + 0.2 creeping into totals. */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Price a booking from the flight's cabin fare plus configured tax and fees.
 * Tax applies to the fare; the service fee is flat per booking, not per seat.
 */
const computePricing = ({ pricePerSeat, seatCount, taxRatePercent = 0, serviceFee = 0, currency = 'PKR' }) => {
  const subtotal = round2(pricePerSeat * seatCount);
  const taxes = round2(subtotal * (taxRatePercent / 100));
  const fees = round2(serviceFee);
  return {
    pricePerSeat: round2(pricePerSeat),
    seatCount,
    subtotal,
    taxes,
    fees,
    totalAmount: round2(subtotal + taxes + fees),
    currency,
  };
};

const hoursUntil = (date, now = new Date()) => (new Date(date).getTime() - now.getTime()) / HOUR_MS;

/**
 * Can this booking still be cancelled?
 *
 * Returns a reason rather than a bare boolean so the API can tell the
 * customer *why* — "too close to departure" and "already cancelled" need
 * different responses in the UI.
 */
const canCancel = ({ booking, flight, settings, now = new Date() }) => {
  if (!['pending', 'confirmed'].includes(booking.status)) {
    return { allowed: false, code: 'NOT_CANCELLABLE', reason: `Booking is already ${booking.status}` };
  }

  // When the airline cancels, customer-facing cancellation windows do not
  // apply — the passenger is owed a full refund regardless of timing.
  if (flight.status === 'cancelled') {
    return { allowed: true, code: 'FLIGHT_CANCELLED', reason: 'Flight was cancelled by the operator' };
  }

  if (!settings.cancellation.enabled) {
    return { allowed: false, code: 'DISABLED', reason: 'Cancellations are currently disabled' };
  }

  if (['departed', 'arrived'].includes(flight.status)) {
    return { allowed: false, code: 'FLOWN', reason: 'This flight has already departed' };
  }

  const remaining = hoursUntil(flight.departureTime, now);
  if (remaining < settings.cancellation.allowedUntilHours) {
    return {
      allowed: false,
      code: 'TOO_LATE',
      reason: `Cancellation closed ${settings.cancellation.allowedUntilHours} hours before departure`,
    };
  }

  return { allowed: true, code: 'OK', reason: 'Within the cancellation window' };
};

/**
 * How much comes back.
 *
 * An operator-cancelled flight refunds in full. Otherwise the configured
 * percentage applies and a flat fee is deducted, floored at zero — a refund
 * must never turn into a charge because the fee exceeded the fare.
 */
const computeRefund = ({ booking, flight, settings }) => {
  const total = booking.pricing.totalAmount;

  if (flight.status === 'cancelled') {
    return { refundAmount: round2(total), feeApplied: 0, reason: 'Operator cancellation — full refund' };
  }

  if (booking.paymentStatus === 'unpaid') {
    return { refundAmount: 0, feeApplied: 0, reason: 'Nothing was paid, so nothing is refunded' };
  }

  const gross = round2(total * (settings.cancellation.refundPercent / 100));
  const fee = round2(settings.cancellation.flatFee || 0);
  const net = Math.max(0, round2(gross - fee));

  return {
    refundAmount: net,
    feeApplied: round2(Math.min(fee, gross)),
    reason: `${settings.cancellation.refundPercent}% of fare less a ${fee} fee`,
  };
};

/** Is this flight open for new bookings at all? */
const canBook = ({ flight, settings, seatCount, cabinClass, now = new Date() }) => {
  if (!flight.isActive) return { allowed: false, code: 'UNAVAILABLE', reason: 'Flight is not available' };

  if (['departed', 'arrived', 'cancelled'].includes(flight.status)) {
    return { allowed: false, code: 'CLOSED', reason: `Flight is ${flight.status}` };
  }

  const remaining = hoursUntil(flight.departureTime, now);
  if (remaining < settings.booking.cutoffHours) {
    return {
      allowed: false,
      code: 'CUTOFF',
      reason: `Bookings close ${settings.booking.cutoffHours} hours before departure`,
    };
  }

  if (remaining / 24 > settings.booking.maxAdvanceDays) {
    return {
      allowed: false,
      code: 'TOO_EARLY',
      reason: `Bookings open ${settings.booking.maxAdvanceDays} days before departure`,
    };
  }

  if (seatCount > settings.booking.maxPassengersPerBooking) {
    return {
      allowed: false,
      code: 'TOO_MANY',
      reason: `Maximum ${settings.booking.maxPassengersPerBooking} passengers per booking`,
    };
  }

  const cabin = flight.cabins?.[cabinClass];
  if (!cabin || cabin.totalSeats === 0) {
    return { allowed: false, code: 'NO_CABIN', reason: `This flight has no ${cabinClass} cabin` };
  }

  return { allowed: true, code: 'OK', reason: 'Bookable' };
};

module.exports = { computePricing, canCancel, computeRefund, canBook, round2, hoursUntil };
