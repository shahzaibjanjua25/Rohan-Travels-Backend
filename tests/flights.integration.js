/**
 * Flight endpoint integration tests.
 *
 * Requires a running MongoDB. Uses a throwaway database that is dropped on
 * exit, so it will not touch your development data.
 *
 *   cd backend
 *   node tests/flights.integration.js
 *
 * Covers the paths that cannot be tested without a database: role gating,
 * capacity guards, soft delete, and passport encryption at rest.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/rohan_travels_test';
process.env.JWT_SECRET = 'test'.repeat(16);
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');

const mongoose = require('mongoose');
const request = require('supertest');

let pass = 0;
let fail = 0;
const P = (label, ok, extra = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  -> ${extra}` : ''}`);
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const app = require('../src/app');
  const { User, Flight, Booking } = require('../src/models');
  const { signAccessToken } = require('../src/utils/token');
  const cfg = require('../src/config/env');

  const admin = await User.create({ name: 'Admin', email: 'admin@test.local', password: 'Passw0rd!23', role: 'admin' });
  const cust = await User.create({ name: 'Customer', email: 'cust@test.local', password: 'Passw0rd!23' });
  const cookie = (u) => [`${cfg.cookie.name}=${signAccessToken(u)}`];

  const mk = (num, from, to, day, price, seats) => ({
    flightNumber: num,
    airline: num.startsWith('AA') ? 'American Airlines' : 'British Airways',
    origin: { airportCode: from, city: 'Origin City', country: 'Origin Country' },
    destination: { airportCode: to, city: 'Dest City', country: 'Dest Country' },
    departureTime: `2027-09-${day}T10:00:00.000Z`,
    arrivalTime: `2027-09-${day}T18:00:00.000Z`,
    cabins: { economy: { totalSeats: seats, price }, business: { totalSeats: 10, price: price * 3 } },
  });

  console.log('\n== authorisation ==');
  let r = await request(app).post('/api/flights').send(mk('AA100', 'JFK', 'LHR', '01', 500, 100));
  P('POST unauthenticated -> 401', r.status === 401, r.status);

  r = await request(app).post('/api/flights').set('Cookie', cookie(cust)).send(mk('AA100', 'JFK', 'LHR', '01', 500, 100));
  P('POST as customer -> 403', r.status === 403, r.status);

  r = await request(app).post('/api/flights').set('Cookie', cookie(admin)).send(mk('AA100', 'JFK', 'LHR', '01', 500, 100));
  P('POST as admin -> 201', r.status === 201, r.status);
  P('availableSeats seeded from totalSeats', r.body.data?.cabins?.economy?.availableSeats === 100, r.body.data?.cabins?.economy?.availableSeats);

  r = await request(app).post('/api/flights').set('Cookie', cookie(admin)).send(mk('AA100', 'JFK', 'LHR', '01', 500, 100));
  P('duplicate flightNumber -> 409', r.status === 409, r.status);

  await request(app).post('/api/flights').set('Cookie', cookie(admin)).send(mk('AA200', 'JFK', 'LHR', '01', 300, 2));
  await request(app).post('/api/flights').set('Cookie', cookie(admin)).send(mk('BA300', 'LHR', 'CDG', '02', 150, 50));

  console.log('\n== search ==');
  r = await request(app).get('/api/flights?origin=JFK&destination=LHR&departureDate=2027-09-01');
  P('route + date search returns 2', r.body.count === 2, r.body.count);
  P('lean virtuals present (lowestPrice)', r.body.data?.[0]?.lowestPrice != null, r.body.data?.[0]?.lowestPrice);
  P('lean virtuals present (durationMinutes)', r.body.data?.[0]?.durationMinutes === 480, r.body.data?.[0]?.durationMinutes);

  r = await request(app).get('/api/flights?sort=price');
  P('sort=price ascending', r.body.data[0].cabins.economy.price <= r.body.data[1].cabins.economy.price, r.body.data.map((f) => f.cabins.economy.price).join(','));

  r = await request(app).get('/api/flights?passengers=5&origin=JFK');
  P('passengers=5 excludes the 2-seat flight', r.body.count === 1, r.body.count);

  r = await request(app).get('/api/flights?maxPrice=200');
  P('maxPrice=200 returns only BA300', r.body.count === 1 && r.body.data[0].flightNumber === 'BA300', r.body.count);

  r = await request(app).get(`/api/flights?airline=${encodeURIComponent('.*')}`);
  P('regex metacharacters do not match everything', r.body.count === 0, r.body.count);

  r = await request(app).get('/api/flights?limit=2&page=2');
  P('pagination metadata correct', r.body.pagination.page === 2 && r.body.pagination.totalPages === 2, JSON.stringify(r.body.pagination));

  console.log('\n== capacity and delete ==');
  const aa200 = await Flight.findOne({ flightNumber: 'AA200' });
  await Booking.create({
    user: cust._id,
    flight: aa200._id,
    cabinClass: 'economy',
    contactEmail: 'cust@test.local',
    passengers: [{ firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: new Date('1990-01-01'), passportNumber: 'MW1234567' }],
    pricing: { pricePerSeat: 300, seatCount: 1, subtotal: 0, totalAmount: 0 },
  });
  aa200.cabins.economy.availableSeats = 1;
  await aa200.save();

  r = await request(app).put(`/api/flights/${aa200._id}`).set('Cookie', cookie(admin)).send({ cabins: { economy: { totalSeats: 0 } } });
  P('cannot shrink capacity below seats sold', r.status === 400, r.body.message);

  r = await request(app).delete(`/api/flights/${aa200._id}`).set('Cookie', cookie(admin));
  P('delete with bookings -> soft delete', r.body.softDeleted === true, r.body.message);

  r = await request(app).get('/api/flights?origin=JFK');
  P('soft-deleted flight hidden from customers', !r.body.data.some((f) => f.flightNumber === 'AA200'));

  r = await request(app).get('/api/flights?origin=JFK&includeInactive=true').set('Cookie', cookie(admin));
  P('admin can see inactive flights', r.body.data.some((f) => f.flightNumber === 'AA200'));

  console.log('\n== PII at rest ==');
  const raw = await mongoose.connection.db.collection('bookings').findOne({});
  const stored = raw.passengers[0].passportNumber;
  P('passport stored as ciphertext', stored.startsWith('enc:v1:') && !stored.includes('MW1234567'), `${stored.slice(0, 22)}...`);

  const withDocs = await Booking.findOne({}).select('+passengers.passportNumber');
  P('decrypts to original', withDocs.revealPassengerDocuments()[0].passportNumber === 'MW1234567');
  P('masked view hides digits', withDocs.maskedPassengerDocuments()[0].passportNumber === '••••••567', withDocs.maskedPassengerDocuments()[0].passportNumber);

  const plain = await Booking.findOne({});
  P('absent unless explicitly selected', plain.passengers[0].passportNumber === undefined);
  P('absent from JSON serialisation', JSON.stringify(plain).includes('passportNumber') === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nSUITE ERROR:', err.message);
  if (err.message.includes('ECONNREFUSED')) console.error('Is MongoDB running?');
  process.exit(1);
});
