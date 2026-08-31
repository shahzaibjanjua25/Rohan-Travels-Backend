// controllers/flightController.js

const { Flight, Booking } = require('../models');
const { buildFilter, buildSort, buildPagination, CABINS } = require('../utils/flightQuery');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

/**
 * GET /api/flights
 * Search and list. Uses optionalAuth, so admins get extra visibility.
 */
exports.getFlights = catchAsync(async (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const cabin = req.query.cabinClass || 'economy';

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  // console.log('========================================');
  // console.log('🔍 GET /api/flights');This is test debug code
  // console.log('🔍 isAdmin:', isAdmin);
  // console.log('🔍 User:', req.user?.email || 'Not authenticated');
  // console.log('🔍 Query params:', JSON.stringify(req.query, null, 2));

  // Build the filter using the utility
  const filter = buildFilter(req.query, isAdmin);

  // console.log('📊 Final filter being applied:', JSON.stringify(filter, null, 2));This is test debug code

  // Get total count first for debugging
  const totalCount = await Flight.countDocuments(filter);
  // console.log('📊 Total count from DB with filter:', totalCount);This is test debug code

  // If no results, check if there are any flights at all
  if (totalCount === 0) {
    const allFlights = await Flight.find({}).limit(5);
    // console.log('📊 Sample of all flights in DB:', allFlights.length);This is test debug code
    if (allFlights.length > 0) {
      // console.log('📊 First flight:', JSON.stringify(allFlights[0], null, 2));This is test debug code
    }
  }

  // Get paginated flights
  const [flights, total] = await Promise.all([
    Flight.find(filter)
      .sort(buildSort(req.query.sort, cabin))
      .skip((page - 1) * limit)
      .limit(limit)
      .lean({ virtuals: true }),
    Flight.countDocuments(filter),
  ]);

  // console.log(`📊 Returning ${flights.length} flights out of ${total} total`);This is test debug code
  // console.log('========================================');

  res.status(200).json({
    success: true,
    count: flights.length,
    pagination: buildPagination(page, limit, total),
    data: flights,
  });
});

// ... rest of your controller functions
/** GET /api/flights/:id */
exports.getFlight = catchAsync(async (req, res) => {
  const flight = await Flight.findById(req.params.id);
  if (!flight) throw AppError.notFound('Flight not found');

  // A deactivated flight is visible to admins only.
  if (!flight.isActive && req.user?.role !== 'admin') {
    throw AppError.notFound('Flight not found');
  }

  res.status(200).json({ success: true, data: flight });
});

/** POST /api/flights — admin */
exports.createFlight = catchAsync(async (req, res) => {
  // const existing = await Flight.findOne({ flightNumber: req.body.flightNumber });
  // if (existing) throw AppError.conflict(`Flight ${req.body.flightNumber} already exists`);

  // Seed availability from capacity when the caller omits it.
  const payload = { ...req.body };
  for (const cabin of CABINS) {
    const c = payload.cabins?.[cabin];
    if (c && c.totalSeats != null && c.availableSeats == null) {
      c.availableSeats = c.totalSeats;
    }
  }

  const flight = await Flight.create(payload);
  res.status(201).json({ success: true, data: flight });
});

/** PUT /api/flights/:id — admin */
exports.updateFlight = catchAsync(async (req, res) => {
  const flight = await Flight.findById(req.params.id);
  if (!flight) throw AppError.notFound('Flight not found');

  // Reducing capacity below what is already sold would corrupt inventory.
  for (const cabin of CABINS) {
    const nextTotal = req.body.cabins?.[cabin]?.totalSeats;
    if (nextTotal == null) continue;

    const current = flight.cabins[cabin];
    const sold = (current.totalSeats || 0) - (current.availableSeats || 0);
    if (nextTotal < sold) {
      throw AppError.badRequest(
        `Cannot reduce ${cabin} capacity to ${nextTotal}: ${sold} seat(s) are already booked`
      );
    }
  }

  flight.set(req.body);
  await flight.save();
  res.status(200).json({ success: true, data: flight });
});

/** PATCH /api/flights/:id/status — admin */
exports.updateFlightStatus = catchAsync(async (req, res) => {
  const flight = await Flight.findById(req.params.id);
  if (!flight) throw AppError.notFound('Flight not found');

  flight.status = req.body.status;
  await flight.save();

  res.status(200).json({ success: true, data: flight });
});

/** GET /api/flights/filters — Get filter options */
exports.getFlightFilters = catchAsync(async (req, res) => {
  // Get unique origins and destinations from flights
  const origins = await Flight.distinct('origin');
  const destinations = await Flight.distinct('destination');
  const airlines = await Flight.distinct('airline');

  res.status(200).json({
    success: true,
    data: {
      origins,
      destinations,
      airlines,
    }
  });
});

/** GET /api/flights/popular-destinations */
exports.getPopularDestinations = catchAsync(async (req, res) => {
  // Get flights that are active and have destination data
  const flights = await Flight.find({
    isActive: true,
    'destination.city': { $exists: true }
  })
    .select('airline flightNumber destination departureTime arrivalTime cabins images')
    .limit(6)
    .sort({ departureTime: 1 });

  // Transform data to remove duplicates and get unique destinations
  const destinations = [];
  const seenCities = new Set();

  for (const flight of flights) {
    const city = flight.destination?.city;
    if (city && !seenCities.has(city)) {
      seenCities.add(city);

      // Get the cheapest cabin price
      let price = 0;
      if (flight.cabins) {
        const cabinKeys = Object.keys(flight.cabins);
        if (cabinKeys.length > 0) {
          const prices = cabinKeys.map(key => flight.cabins[key]?.price || 0);
          price = Math.min(...prices);
        }
      }

      destinations.push({
        id: flight._id,
        city: city,
        country: flight.destination?.country || '',
        price: price > 0 ? `$${price}` : 'Contact for price',
        image: flight.images?.[0] || '/api/placeholder/400/300',
        airline: flight.airline,
        flightNumber: flight.flightNumber,
        departureTime: flight.departureTime
      });
    }
  }

  res.status(200).json({
    success: true,
    data: destinations
  });
});

/**
 * DELETE /api/flights/:id — admin
 *
 * Soft-deletes when bookings exist. Hard-deleting a flight that customers
 * hold tickets for would orphan those bookings and break their history.
 */
exports.deleteFlight = catchAsync(async (req, res) => {
  const flight = await Flight.findById(req.params.id);
  if (!flight) throw AppError.notFound('Flight not found');

  const activeBookings = await Booking.countDocuments({
    flight: flight._id,
    status: { $in: ['pending', 'confirmed'] },
  });

  if (activeBookings > 0) {
    flight.isActive = false;
    await flight.save();
    return res.status(200).json({
      success: true,
      softDeleted: true,
      message: `Flight has ${activeBookings} active booking(s), so it was deactivated instead of deleted`,
      data: flight,
    });
  }

  const anyBookings = await Booking.countDocuments({ flight: flight._id });
  if (anyBookings > 0) {
    flight.isActive = false;
    await flight.save();
    return res.status(200).json({
      success: true,
      softDeleted: true,
      message: 'Flight deactivated to preserve historical booking records',
      data: flight,
    });
  }

  await flight.deleteOne();
  return res.status(200).json({ success: true, softDeleted: false, data: {} });
});