/**
 * Booking integration tests. Requires a running MongoDB.
 *
 *   cd backend
 *   node tests/bookings.integration.js
 *
 * The headline test is `concurrent booking`: it fires many simultaneous
 * requests at the last few seats and asserts that exactly the right number
 * succeed. If the atomic reservation in utils/seatInventory.js is ever
 * replaced with a read-then-write, that test is what will catch it.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/rohan_travels_test';
process.env.JWT_SECRET = 'test'.repeat(16);
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
process.env.CSRF_ENABLED = 'false'; // exercised separately in auth.integration.js
process.env.EMAIL_ENABLED = 'false';

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
  const { User, Flight, Booking, Ledger, Settings } = require('../src/models');
  const { signAccessToken } = require('../src/utils/token');
  const cfg = require('../src/config/env');

  const admin = await User.create({ name: 'Admin', email: 'admin@test.local', password: 'correct-horse-battery', role: 'admin' });
  const alice = await User.create({ name: 'Alice', email: 'alice@test.local', password: 'correct-horse-battery' });
  const bob = await User.create({ name: 'Bob', email: 'bob@test.local', password: 'correct-horse-battery' });
  const as = (u) => [`${cfg.cookie.name}=${signAccessToken(u)}`];

  await Settings.getSettings();
  await Settings.updateOne({ key: 'global' }, {
    $set: {
      'booking.taxRatePercent': 10,
      'booking.serviceFee': 15,
      'cancellation.refundPercent': 80,
      'cancellation.flatFee': 25,
      'cancellation.allowedUntilHours': 24,
    },
  });

  const daysOut = (d) => new Date(Date.now() + d * 24 * 3600 * 1000);
  const makeFlight = async (num, seats) =>
    Flight.create({
      flightNumber: num,
      airline: 'Test Air',
      origin: { airportCode: 'JFK', city: 'New York', country: 'USA' },
      destination: { airportCode: 'LHR', city: 'London', country: 'UK' },
      departureTime: daysOut(30),
      arrivalTime: new Date(daysOut(30).getTime() + 8 * 3600 * 1000),
      cabins: { economy: { totalSeats: seats, availableSeats: seats, price: 100 } },
    });

  const pax = (n, seatNumbers = []) =>
    Array.from({ length: n }, (_, i) => ({
      firstName: `Pass${i}`,
      lastName: 'Enger',
      dateOfBirth: '1990-01-01',
      ...(seatNumbers[i] ? { seatNumber: seatNumbers[i] } : {}),
    }));

  const book = (user, flightId, count, seats) =>
    request(app).post('/api/bookings').set('Cookie', as(user)).send({
      flightId: String(flightId),
      cabinClass: 'economy',
      passengers: pax(count, seats),
      contactEmail: 'contact@test.local',
    });

  console.log('\n== creation and pricing ==');
  const f1 = await makeFlight('TA100', 50);
  let r = await book(alice, f1._id, 2);
  P('create booking -> 201', r.status === 201, r.status);
  P('total priced server-side (2x100 +10% +15)', r.body.data?.pricing?.totalAmount === 235, r.body.data?.pricing?.totalAmount);
  P('starts pending/unpaid', r.body.data?.status === 'pending' && r.body.data?.paymentStatus === 'unpaid');
  P('reference issued', /^RT[A-Z2-9]{6}$/.test(r.body.data?.bookingReference || ''), r.body.data?.bookingReference);

  let f1after = await Flight.findById(f1._id);
  P('seats decremented by passenger count', f1after.cabins.economy.availableSeats === 48, f1after.cabins.economy.availableSeats);

  r = await request(app).post('/api/bookings').set('Cookie', as(alice)).send({
    flightId: String(f1._id), cabinClass: 'economy', passengers: pax(1),
    contactEmail: 'c@test.local', pricing: { totalAmount: 0.01 },
  });
  P('client-supplied pricing rejected -> 400', r.status === 400, JSON.stringify(r.body.details));

  console.log('\n== CONCURRENCY: the last seats ==');
  const f2 = await makeFlight('TA200', 5);
  const attempts = 20;
  const results = await Promise.all(Array.from({ length: attempts }, () => book(alice, f2._id, 1)));
  const created = results.filter((x) => x.status === 201).length;
  const conflicted = results.filter((x) => x.status === 409).length;

  const f2after = await Flight.findById(f2._id);
  const bookedCount = await Booking.countDocuments({ flight: f2._id });

  P(`exactly 5 of ${attempts} concurrent bookings succeeded`, created === 5, `created=${created} conflict=${conflicted}`);
  P('availableSeats landed on 0', f2after.cabins.economy.availableSeats === 0, f2after.cabins.economy.availableSeats);
  P('never went negative (no overselling)', f2after.cabins.economy.availableSeats >= 0);
  P('booking rows match seats sold', bookedCount === 5, bookedCount);
  P('losers got 409, not 500', conflicted === attempts - 5, conflicted);

  console.log('\n== multi-seat contention ==');
  const f3 = await makeFlight('TA300', 4);
  const multi = await Promise.all([book(alice, f3._id, 3), book(bob, f3._id, 3)]);
  const multiOk = multi.filter((x) => x.status === 201).length;
  const f3after = await Flight.findById(f3._id);
  P('only one 3-seat booking fits in 4 seats', multiOk === 1, `succeeded=${multiOk}`);
  P('remaining seats correct', f3after.cabins.economy.availableSeats === 1, f3after.cabins.economy.availableSeats);

  console.log('\n== seat numbers ==');
  const f4 = await makeFlight('TA400', 20);
  r = await book(alice, f4._id, 1, ['12A']);
  P('seat 12A booked -> 201', r.status === 201, r.status);
  r = await book(bob, f4._id, 1, ['12A']);
  P('same seat again -> 409', r.status === 409, r.body.message);
  r = await book(bob, f4._id, 2, ['14C', '14C']);
  P('duplicate seat within one booking -> 400', r.status === 400, r.body.message);
  r = await request(app).get(`/api/bookings/flights/${f4._id}/seats`).set('Cookie', as(bob));
  P('seat map lists occupied seats', r.body.data?.occupiedSeats?.includes('12A'), JSON.stringify(r.body.data?.occupiedSeats));

  console.log('\n== ownership isolation ==');
  const aliceBooking = await Booking.findOne({ user: alice._id });
  r = await request(app).get(`/api/bookings/${aliceBooking._id}`).set('Cookie', as(bob));
  P("another user cannot read Alice's booking -> 404", r.status === 404, r.status);
  r = await request(app).get(`/api/bookings/${aliceBooking._id}`).set('Cookie', as(admin));
  P('admin can read any booking -> 200', r.status === 200, r.status);
  r = await request(app).get('/api/bookings').set('Cookie', as(bob));
  P('list scoped to own bookings', r.body.data.every((b) => String(b.user._id || b.user) === String(bob._id)));

  console.log('\n== payment ==');
  r = await request(app).patch(`/api/bookings/${aliceBooking._id}/pay`).set('Cookie', as(alice)).send({});
  P('customer cannot mark paid -> 403', r.status === 403, r.status);
  r = await request(app).patch(`/api/bookings/${aliceBooking._id}/pay`).set('Cookie', as(admin)).send({ paymentMethod: 'card' });
  P('admin marks paid -> 200', r.status === 200, r.status);
  P('status becomes confirmed', r.body.data?.status === 'confirmed' && r.body.data?.paymentStatus === 'paid');
  r = await request(app).patch(`/api/bookings/${aliceBooking._id}/pay`).set('Cookie', as(admin)).send({});
  P('replayed payment -> 409 (no double ledger entry)', r.status === 409, r.status);
  const payEntries = await Ledger.countDocuments({ booking: aliceBooking._id, category: 'booking_payment' });
  P('exactly one payment ledger entry', payEntries === 1, payEntries);

  console.log('\n== cancellation ==');
  const seatsBefore = (await Flight.findById(f1._id)).cabins.economy.availableSeats;
  r = await request(app).patch(`/api/bookings/${aliceBooking._id}/cancel`).set('Cookie', as(alice)).send({ reason: 'Change of plans' });
  P('owner can cancel -> 200', r.status === 200, r.status);
  P('refund = 80% of 235 less 25 = 163', r.body.refund?.refundAmount === 163, r.body.refund?.refundAmount);
  const seatsAfter = (await Flight.findById(f1._id)).cabins.economy.availableSeats;
  P('seats returned to inventory', seatsAfter === seatsBefore + 2, `${seatsBefore} -> ${seatsAfter}`);

  const cancels = await Promise.all([
    request(app).patch(`/api/bookings/${aliceBooking._id}/cancel`).set('Cookie', as(alice)).send({}),
    request(app).patch(`/api/bookings/${aliceBooking._id}/cancel`).set('Cookie', as(alice)).send({}),
  ]);
  P('repeat cancel refused', cancels.every((x) => x.status === 409), cancels.map((x) => x.status).join(','));
  const refunds = await Ledger.countDocuments({ booking: aliceBooking._id, category: 'refund' });
  P('exactly one refund entry', refunds === 1, refunds);
  const finalSeats = (await Flight.findById(f1._id)).cabins.economy.availableSeats;
  P('seats not double-released', finalSeats === seatsAfter, finalSeats);

  console.log('\n== ledger integrity ==');
  const entry = await Ledger.findOne({ booking: aliceBooking._id });
  let immutable = false;
  try {
    entry.amount = 1;
    await entry.save();
  } catch {
    immutable = true;
  }
  P('ledger entries reject edits', immutable);

  console.log('\n== travel documents ==');
  const f5 = await makeFlight('TA500', 10);
  r = await request(app).post('/api/bookings').set('Cookie', as(alice)).send({
    flightId: String(f5._id), cabinClass: 'economy', contactEmail: 'c@test.local',
    passengers: [{ firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01', passportNumber: 'MW1234567' }],
  });
  const docBooking = r.body.data._id;
  P('booking with passport -> 201', r.status === 201, r.status);
  P('passport absent from create response', JSON.stringify(r.body).includes('MW1234567') === false);

  const rawDoc = await mongoose.connection.db.collection('bookings').findOne({ _id: new mongoose.Types.ObjectId(docBooking) });
  P('passport encrypted at rest', String(rawDoc.passengers[0].passportNumber).startsWith('enc:v1:'));

  r = await request(app).get(`/api/bookings/${docBooking}/documents`).set('Cookie', as(alice));
  P('customer cannot read documents -> 403', r.status === 403, r.status);
  r = await request(app).get(`/api/bookings/${docBooking}/documents`).set('Cookie', as(admin));
  P('admin reads decrypted documents -> 200', r.status === 200 && r.body.data?.[0]?.passportNumber === 'MW1234567', r.body.data?.[0]?.passportNumber);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nSUITE ERROR:', err.message);
  if (err.message.includes('ECONNREFUSED')) console.error('Is MongoDB running?');
  process.exit(1);
});
