// backend/src/utils/flightQuery.js

const CABINS = ['economy', 'business', 'first'];
const TRIP_TYPES = ['one_way', 'round_trip', 'multi_city'];

/** Neutralise regex metacharacters so a search term cannot become a pattern. */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const trimmed = (value) => (typeof value === 'string' ? value.trim() : value);

/**
 * Build a Mongo filter from validated query params.
 */
const buildFilter = (q = {}, isAdmin = false) => {
  const filter = {};

  // ============================================
  // 1. Active flights only, unless an admin opts in
  // ============================================
  if (!(isAdmin && String(q.includeInactive) === 'true')) {
    filter.isActive = true;
  }

  // ============================================
  // 2-3. Route
  // ============================================
  // For a multi-city itinerary these are derived from the first and last
  // segment by the model, so KHI -> JED -> MAK -> ISB matches a KHI -> ISB
  // search. Intermediate stops deliberately do NOT match: selling someone a
  // JED -> ISB seat on that chain would be selling half an itinerary.
  if (trimmed(q.origin)) {
    filter['origin.airportCode'] = q.origin.trim().toUpperCase();
  }
  if (trimmed(q.destination)) {
    filter['destination.airportCode'] = q.destination.trim().toUpperCase();
  }

  // ============================================
  // 4-5. Airline and status
  // ============================================
  if (trimmed(q.airline)) {
    filter.airline = { $regex: escapeRegex(q.airline.trim()), $options: 'i' };
  }
  if (trimmed(q.status)) {
    filter.status = q.status.trim();
  }

  // ============================================
  // 6. Domestic / international
  // ============================================
  if (trimmed(q.flightType)) {
    filter.flightType = q.flightType.trim();
  }

  // ============================================
  // 7. Trip type (one-way / round trip / multi-city)
  // ============================================
  if (trimmed(q.tripType) && TRIP_TYPES.includes(q.tripType.trim())) {
    filter.tripType = q.tripType.trim();
  }

  // ============================================
  // 8. Travel purpose, with `generic` falling through every filter
  // ============================================
  //
  // A flight tagged `generic` is sellable for any purpose, so it joins every
  // purpose-filtered result set. Filtering by `umrah` against an inventory of
  // 1 umrah + 2 hajj + 1 generic returns the umrah one and the generic one;
  // filtering by `hajj` returns both hajj ones and the same generic one.
  //
  // $in rather than $or on purpose: `search` below already owns filter.$or,
  // and two writers on the same key would silently clobber each other.
  if (trimmed(q.travelType)) {
    const wanted = q.travelType.trim();
    filter.travelTypes =
      wanted === 'generic' ? { $in: ['generic'] } : { $in: [wanted, 'generic'] };
  }

  // ============================================
  // 9. Free-text search
  // ============================================
  if (trimmed(q.search)) {
    const rx = new RegExp(escapeRegex(q.search.trim()), 'i');
    filter.$or = [
      { airline: rx },
      { flightNumber: rx },
      { 'origin.city': rx },
      { 'destination.city': rx },
      { 'origin.airportCode': rx },
      { 'destination.airportCode': rx },
      { 'segments.origin.city': rx },
      { 'segments.destination.city': rx },
      { 'segments.origin.airportCode': rx },
      { 'segments.destination.airportCode': rx },
      { aircraft: rx },
    ];
  }

  // ============================================
  // 10. Departure date
  // ============================================
  // Resolved as a UTC calendar day. Correct for a single-region deployment;
  // a multi-region product should resolve the boundary in the origin
  // airport's timezone.
  if (trimmed(q.departureDate)) {
    const start = new Date(`${q.departureDate.trim().slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) {
      filter.departureTime = { $gte: start, $lt: new Date(start.getTime() + 86400000) };
    }
  }

  // Round trips only: filter on when the passenger comes back.
  if (trimmed(q.returnDate)) {
    const start = new Date(`${q.returnDate.trim().slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) {
      filter['returnSegment.departureTime'] = {
        $gte: start,
        $lt: new Date(start.getTime() + 86400000),
      };
    }
  }

  // ============================================
  // 11. Cabin availability
  // ============================================
  const cabin = CABINS.includes(q.cabinClass) ? q.cabinClass : 'economy';

  if (q.passengers) {
    const seats = parseInt(q.passengers, 10);
    if (Number.isFinite(seats) && seats > 0) {
      filter[`cabins.${cabin}.availableSeats`] = { $gte: seats };
    }
  }

  // ============================================
  // 12. Price range
  // ============================================
  const price = {};
  if (q.minPrice !== undefined && q.minPrice !== null && q.minPrice !== '') {
    const min = parseFloat(q.minPrice);
    if (Number.isFinite(min)) price.$gte = min;
  }
  if (q.maxPrice !== undefined && q.maxPrice !== null && q.maxPrice !== '') {
    const max = parseFloat(q.maxPrice);
    if (Number.isFinite(max)) price.$lte = max;
  }
  if (Object.keys(price).length) {
    filter[`cabins.${cabin}.price`] = price;
  }

  return filter;
};

/**
 * Map the public `sort` value onto real schema paths.
 */
const buildSort = (sortParam, cabinClass) => {
  const cabin = CABINS.includes(cabinClass) ? cabinClass : 'economy';
  if (!sortParam) return { departureTime: 1 };

  const desc = String(sortParam).startsWith('-');
  const key = desc ? String(sortParam).slice(1) : String(sortParam);

  const paths = {
    price: `cabins.${cabin}.price`,
    duration: 'arrivalTime',
    departureTime: 'departureTime',
    // Groups the result set by route, so the flights list receives a page
    // whose routes are already contiguous rather than interleaved.
    route: 'origin.airportCode',
  };

  if (!paths[key]) return { departureTime: 1 };
  return { [paths[key]]: desc ? -1 : 1 };
};

const buildPagination = (page = 1, limit = 20, total = 0) => {
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 20;

  return {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: Math.ceil(total / limitNum) || 1,
    pages: Math.ceil(total / limitNum) || 1, // alias the frontend reads
    hasNextPage: pageNum * limitNum < total,
    hasPrevPage: pageNum > 1,
  };
};

module.exports = {
  buildFilter,
  buildSort,
  buildPagination,
  escapeRegex,
  CABINS,
  TRIP_TYPES,
};