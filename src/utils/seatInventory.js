const { Flight, Booking } = require('../models');
const AppError = require('../utils/AppError');

/**
 * Seat inventory.
 *
 * The correctness problem: two customers click "book" on the last seat at the
 * same millisecond. Read-then-write loses here — both read `availableSeats: 1`,
 * both decide it is fine, both write `0`, and the flight is oversold.
 *
 * MongoDB transactions would solve it, but they require a replica set, and a
 * default local `mongod` is standalone. So this uses the primitive that works
 * everywhere: a single atomic findOneAndUpdate whose *filter* carries the
 * precondition. MongoDB guarantees atomicity on a single document, so the
 * seat check and the decrement cannot be interleaved. The loser gets `null`
 * back rather than a corrupted count.
 */

/** Reserve seats, or return null if there are not enough. */
const reserveSeats = async ({ flightId, cabinClass, seatCount }) => {
  const path = `cabins.${cabinClass}.availableSeats`;

  return Flight.findOneAndUpdate(
    {
      _id: flightId,
      isActive: true,
      status: { $nin: ['departed', 'arrived', 'cancelled'] },
      [path]: { $gte: seatCount }, // the precondition, evaluated atomically
    },
    { $inc: { [path]: -seatCount } },
    { new: true }
  );
};

/**
 * Give seats back. Used both for cancellations and to compensate a failed
 * booking write.
 *
 * Clamped to totalSeats so a double-release can never inflate inventory above
 * the aircraft's actual capacity — releasing twice is a bug, but overselling
 * later because of it would be a worse one.
 */
const releaseSeats = async ({ flightId, cabinClass, seatCount }) => {
  const flight = await Flight.findById(flightId);
  if (!flight) return null;

  const cabin = flight.cabins[cabinClass];
  if (!cabin) return null;

  const restored = Math.min(cabin.totalSeats, (cabin.availableSeats || 0) + seatCount);
  return Flight.findOneAndUpdate(
    { _id: flightId },
    { $set: { [`cabins.${cabinClass}.availableSeats`]: restored } },
    { new: true }
  );
};

/**
 * Explain why a reservation failed.
 *
 * Only called on the failure path, so the extra read costs nothing in the
 * common case. Without it every failure looks identical to the customer,
 * whether the flight sold out or never existed.
 */
const explainReservationFailure = async ({ flightId, cabinClass, seatCount }) => {
  const flight = await Flight.findById(flightId);

  if (!flight || !flight.isActive) return AppError.notFound('Flight not found');
  if (['departed', 'arrived', 'cancelled'].includes(flight.status)) {
    return AppError.conflict(`This flight is ${flight.status} and can no longer be booked`);
  }

  const available = flight.cabins?.[cabinClass]?.availableSeats ?? 0;
  if (available === 0) return AppError.conflict(`No ${cabinClass} seats remain on this flight`);
  return AppError.conflict(
    `Only ${available} ${cabinClass} seat(s) remain, but ${seatCount} were requested`
  );
};

/** Seat numbers already taken on a flight, from bookings that still hold them. */
const getOccupiedSeats = async (flightId) => {
  const rows = await Booking.aggregate([
    { $match: { flight: flightId, status: { $in: ['pending', 'confirmed', 'completed'] } } },
    { $unwind: '$passengers' },
    { $match: { 'passengers.seatNumber': { $ne: null, $exists: true } } },
    { $group: { _id: null, seats: { $addToSet: '$passengers.seatNumber' } } },
  ]);
  return rows[0]?.seats || [];
};

/**
 * Seat-number conflicts are checked, then re-checked after the write.
 *
 * Unlike seat *counts*, seat *numbers* have no single-document precondition
 * to hang an atomic update on — the claim lives across many booking
 * documents. So this is check-then-verify: look before writing, then look
 * again afterwards and roll back if someone slipped in between.
 *
 * The consequence of the residual race is also much milder than overselling:
 * two passengers assigned 12A is a check-in desk problem, not a financial
 * one, and the verify step closes all but a millisecond of the window.
 */
const findSeatConflicts = async (flightId, requestedSeats, excludeBookingId = null) => {
  if (!requestedSeats.length) return [];

  const match = {
    flight: flightId,
    status: { $in: ['pending', 'confirmed', 'completed'] },
    'passengers.seatNumber': { $in: requestedSeats },
  };
  if (excludeBookingId) match._id = { $ne: excludeBookingId };

  const rows = await Booking.aggregate([
    { $match: match },
    { $unwind: '$passengers' },
    { $match: { 'passengers.seatNumber': { $in: requestedSeats } } },
    { $group: { _id: null, seats: { $addToSet: '$passengers.seatNumber' } } },
  ]);

  return rows[0]?.seats || [];
};

module.exports = {
  reserveSeats,
  releaseSeats,
  explainReservationFailure,
  getOccupiedSeats,
  findSeatConflicts,
};
