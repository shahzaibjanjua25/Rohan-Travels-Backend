// utils/flightQuery.js

const CABINS = ['economy', 'business', 'first'];

/** Neutralise regex metacharacters so a search term cannot become a pattern. */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a Mongo filter from validated query params.
 */
const buildFilter = (q = {}, isAdmin = false, now = new Date()) => {
  const filter = {};

  console.log('🔍 Building filter with params:', JSON.stringify(q, null, 2));
  console.log('🔍 isAdmin:', isAdmin);

  // ============================================
  // 1. ALWAYS show active flights (unless admin wants inactive)
  // ============================================
  // IMPORTANT: Only show active flights for non-admin users
  if (isAdmin && q.includeInactive === 'true') {
    // Admin wants to see all flights including inactive
    // Don't add isActive filter
  } else {
    // For users and admin by default, only show active flights
    filter.isActive = true;
  }

  // ============================================
  // 2. Origin filter
  // ============================================
  if (q.origin && q.origin.trim()) {
    filter['origin.airportCode'] = q.origin.toUpperCase().trim();
  }

  // ============================================
  // 3. Destination filter
  // ============================================
  if (q.destination && q.destination.trim()) {
    filter['destination.airportCode'] = q.destination.toUpperCase().trim();
  }

  // ============================================
  // 4. Airline filter
  // ============================================
  if (q.airline && q.airline.trim()) {
    filter.airline = { $regex: escapeRegex(q.airline), $options: 'i' };
  }

  // ============================================
  // 5. Status filter
  // ============================================
  if (q.status && q.status.trim()) {
    filter.status = q.status;
  }

  // ============================================
  // 6. Flight type filter (domestic/international)
  // ============================================
  if (q.flightType && q.flightType.trim()) {
    filter.flightType = q.flightType;
  }

  // ============================================
  // 7. Travel type filter
  // ============================================
  if (q.travelType && q.travelType.trim()) {
    filter.travelTypes = { $in: [q.travelType] };
  }

  // ============================================
  // 8. Search filter
  // ============================================
  if (q.search && q.search.trim()) {
    const searchRegex = new RegExp(escapeRegex(q.search.trim()), 'i');
    filter.$or = [
      { airline: searchRegex },
      { flightNumber: searchRegex },
      { 'origin.city': searchRegex },
      { 'destination.city': searchRegex },
      { 'origin.airportCode': searchRegex },
      { 'destination.airportCode': searchRegex },
      { aircraft: searchRegex },
    ];
  }

  // ============================================
  // 9. Departure date filter - SIMPLIFIED
  // ============================================
  // ONLY apply date filter if the user specifically selected a date
  if (q.departureDate && q.departureDate.trim()) {
    const start = new Date(`${q.departureDate.trim().slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    filter.departureTime = { $gte: start, $lt: end };
    console.log('🔍 Filtering by specific date:', start.toISOString());
  }
  // IMPORTANT: For non-admin users, we DO NOT add any date filter by default
  // This allows all active flights to be shown regardless of departure time

  // ============================================
  // 10. Cabin class and passenger count
  // ============================================
  const cabin = CABINS.includes(q.cabinClass) ? q.cabinClass : 'economy';

  if (q.passengers) {
    filter[`cabins.${cabin}.availableSeats`] = { $gte: parseInt(q.passengers) };
  }

  // ============================================
  // 11. Price range filter
  // ============================================
  if (q.minPrice != null || q.maxPrice != null) {
    const price = {};
    if (q.minPrice != null && q.minPrice !== '') {
      price.$gte = parseFloat(q.minPrice);
    }
    if (q.maxPrice != null && q.maxPrice !== '') {
      price.$lte = parseFloat(q.maxPrice);
    }
    if (Object.keys(price).length > 0) {
      filter[`cabins.${cabin}.price`] = price;
    }
  }

  // Log the final filter
  console.log('🔍 Final filter:', JSON.stringify(filter, null, 2));

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
  };

  if (!paths[key]) {
    return { departureTime: 1 };
  }

  return { [paths[key]]: desc ? -1 : 1 };
};

/**
 * Build pagination object for the response.
 */
const buildPagination = (page = 1, limit = 20, total = 0) => {
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  
  return {
    page: pageNum,
    limit: limitNum,
    total: total,
    totalPages: Math.ceil(total / limitNum) || 1,
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
};