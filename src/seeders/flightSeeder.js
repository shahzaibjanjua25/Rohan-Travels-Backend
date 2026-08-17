/**
 * Seeds sample flights.
 *
 *   npm run seed:flights
 *   npm run seed:flights -- --reset    (delete existing sample flights first)
 *
 * Departure times are computed relative to the moment the seeder runs, never
 * hardcoded. Fixed sample dates quietly expire: a month after they are
 * written every seeded flight is in the past, the booking cutoff rejects all
 * of them, and search returns nothing — which looks like a broken search
 * rather than stale data.
 */
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { Flight } = require('../models');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const AIRPORTS = {
  JFK: { airportCode: 'JFK', airportName: 'John F. Kennedy International', city: 'New York', country: 'United States', terminal: '4' },
  LHR: { airportCode: 'LHR', airportName: 'Heathrow', city: 'London', country: 'United Kingdom', terminal: '5' },
  CDG: { airportCode: 'CDG', airportName: 'Charles de Gaulle', city: 'Paris', country: 'France', terminal: '2E' },
  DXB: { airportCode: 'DXB', airportName: 'Dubai International', city: 'Dubai', country: 'United Arab Emirates', terminal: '3' },
  BOM: { airportCode: 'BOM', airportName: 'Chhatrapati Shivaji Maharaj International', city: 'Mumbai', country: 'India', terminal: '2' },
  DEL: { airportCode: 'DEL', airportName: 'Indira Gandhi International', city: 'Delhi', country: 'India', terminal: '3' },
  SIN: { airportCode: 'SIN', airportName: 'Changi', city: 'Singapore', country: 'Singapore', terminal: '3' },
  SFO: { airportCode: 'SFO', airportName: 'San Francisco International', city: 'San Francisco', country: 'United States', terminal: 'I' },
};

/** Route definitions. Times in hours; prices are per seat. */
const ROUTES = [
  { num: 'AA100', airline: 'American Airlines', aircraft: 'Boeing 777-300ER', from: 'JFK', to: 'LHR', duration: 7, eco: 520, biz: 1850, first: 3900 },
  { num: 'BA212', airline: 'British Airways', aircraft: 'Airbus A350-1000', from: 'LHR', to: 'JFK', duration: 8, eco: 545, biz: 1920, first: 4100 },
  { num: 'AF1381', airline: 'Air France', aircraft: 'Airbus A320neo', from: 'LHR', to: 'CDG', duration: 1.5, eco: 130, biz: 410, first: null },
  { num: 'EK502', airline: 'Emirates', aircraft: 'Boeing 777-300ER', from: 'DXB', to: 'BOM', duration: 3, eco: 240, biz: 780, first: 1900 },
  { num: 'AI131', airline: 'Air India', aircraft: 'Boeing 787-8', from: 'BOM', to: 'LHR', duration: 9.5, eco: 610, biz: 1740, first: null },
  { num: 'SQ423', airline: 'Singapore Airlines', aircraft: 'Airbus A350-900', from: 'SIN', to: 'BOM', duration: 5.5, eco: 330, biz: 1050, first: null },
  { num: 'UA857', airline: 'United Airlines', aircraft: 'Boeing 787-9', from: 'SFO', to: 'SIN', duration: 16, eco: 890, biz: 2600, first: null },
  { num: '6E2134', airline: 'IndiGo', aircraft: 'Airbus A320neo', from: 'DEL', to: 'BOM', duration: 2, eco: 75, biz: 210, first: null },
];

const buildCabins = ({ eco, biz, first }) => {
  const cabins = {};
  const seatCount = (base) => base + Math.floor(Math.random() * 20);

  cabins.economy = { totalSeats: seatCount(150), price: eco };
  cabins.economy.availableSeats = cabins.economy.totalSeats;

  if (biz) {
    cabins.business = { totalSeats: seatCount(24), price: biz };
    cabins.business.availableSeats = cabins.business.totalSeats;
  }
  if (first) {
    cabins.first = { totalSeats: 8, price: first };
    cabins.first.availableSeats = 8;
  }
  return cabins;
};

/**
 * Build one flight per route per day, spread across the next `days` days.
 * Departure hour rotates so search results are not all at the same time.
 */
const buildFlights = (days = 14, now = new Date()) => {
  const flights = [];
  const base = new Date(now);
  base.setUTCHours(0, 0, 0, 0);

  ROUTES.forEach((route, routeIndex) => {
    for (let d = 1; d <= days; d += 1) {
      const departureHour = 6 + ((routeIndex * 3 + d * 2) % 14); // 06:00-19:00
      const departureTime = new Date(base.getTime() + d * DAY + departureHour * HOUR);
      const arrivalTime = new Date(departureTime.getTime() + route.duration * HOUR);

      flights.push({
        // Suffix keeps flightNumber unique across days without colliding with
        // the AA100-style format the validator enforces on admin input.
        flightNumber: `${route.num}${String(d).padStart(2, '0')}`,
        airline: route.airline,
        aircraft: route.aircraft,
        origin: AIRPORTS[route.from],
        destination: AIRPORTS[route.to],
        departureTime,
        arrivalTime,
        cabins: buildCabins(route),
        status: 'scheduled',
        baggageAllowance: { cabinKg: 7, checkedKg: route.duration > 5 ? 30 : 23 },
        isActive: true,
      });
    }
  });

  return flights;
};

const seedFlights = async ({ days = 14, reset = false, silent = false } = {}) => {
  const log = (...args) => {
    if (!silent) console.log(...args);
  };

  if (reset) {
    const { deletedCount } = await Flight.deleteMany({});
    log(`[seed] Removed ${deletedCount} existing flight(s)`);
  }

  const candidates = buildFlights(days);

  // Upsert rather than insert so re-running does not fail on duplicates.
  const operations = candidates.map((flight) => ({
    updateOne: {
      filter: { flightNumber: flight.flightNumber },
      update: { $setOnInsert: flight },
      upsert: true,
    },
  }));

  const result = await Flight.bulkWrite(operations, { ordered: false });
  const created = result.upsertedCount || 0;

  log(`[seed] Flights: ${created} created, ${candidates.length - created} already present`);
  log(`[seed] Departures span the next ${days} days from today`);
  return created;
};

module.exports = seedFlights;

if (require.main === module) {
  (async () => {
    try {
      const reset = process.argv.includes('--reset');
      await connectDB();
      await seedFlights({ reset });
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error(`\n[seed] ${err.message}\n`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    }
  })();
}
