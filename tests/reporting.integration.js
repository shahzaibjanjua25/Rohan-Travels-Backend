/**
 * Ledger, notification and dashboard integration tests. Requires MongoDB.
 *
 *   cd backend
 *   node tests/reporting.integration.js
 *
 * The assertions that matter most are the isolation ones: a customer must
 * never see another customer's ledger, balance or notifications, and the
 * customer dashboard must never carry company-wide revenue.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/rohan_travels_test';
process.env.JWT_SECRET = 'test'.repeat(16);
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
process.env.CSRF_ENABLED = 'false';
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
  const { User, Flight, Booking, Ledger, Notification, Settings } = require('../src/models');
  const { signAccessToken } = require('../src/utils/token');
  const cfg = require('../src/config/env');

  const admin = await User.create({ name: 'Admin', email: 'admin@t.local', password: 'correct-horse-battery', role: 'admin' });
  const alice = await User.create({ name: 'Alice', email: 'alice@t.local', password: 'correct-horse-battery' });
  const bob = await User.create({ name: 'Bob', email: 'bob@t.local', password: 'correct-horse-battery' });
  const as = (u) => [`${cfg.cookie.name}=${signAccessToken(u)}`];
  await Settings.getSettings();

  const flight = await Flight.create({
    flightNumber: 'TA900',
    airline: 'Test Air',
    origin: { airportCode: 'JFK', city: 'New York', country: 'USA' },
    destination: { airportCode: 'LHR', city: 'London', country: 'UK' },
    departureTime: new Date(Date.now() + 30 * 864e5),
    arrivalTime: new Date(Date.now() + 30 * 864e5 + 8 * 36e5),
    cabins: { economy: { totalSeats: 100, availableSeats: 100, price: 100 } },
  });

  const mkBooking = (user) =>
    Booking.create({
      user: user._id, flight: flight._id, cabinClass: 'economy', contactEmail: 'c@t.local',
      passengers: [{ firstName: 'A', lastName: 'B', dateOfBirth: new Date('1990-01-01') }],
      pricing: { pricePerSeat: 100, seatCount: 1, subtotal: 0, totalAmount: 0 },
      status: 'confirmed', paymentStatus: 'paid',
    });

  const aliceBooking = await mkBooking(alice);
  const bobBooking = await mkBooking(bob);

  await Ledger.create({ user: alice._id, booking: aliceBooking._id, type: 'debit', category: 'booking_payment', amount: 500, description: 'Alice payment', balanceAfter: -500 });
  await Ledger.create({ user: bob._id, booking: bobBooking._id, type: 'debit', category: 'booking_payment', amount: 900, description: 'Bob payment', balanceAfter: -900 });
  await Ledger.create({ user: alice._id, type: 'credit', category: 'refund', amount: 100, description: 'Alice partial refund', balanceAfter: -400 });

  console.log('\n== ledger isolation ==');
  let r = await request(app).get('/api/ledger').set('Cookie', as(alice));
  P('Alice sees only her entries', r.body.data.every((e) => String(e.user._id || e.user) === String(alice._id)), `${r.body.data.length} entries`);
  P('Alice sees exactly 2 entries', r.body.count === 2, r.body.count);

  r = await request(app).get(`/api/ledger?user=${bob._id}`).set('Cookie', as(alice));
  P("?user= cannot widen a customer's scope", r.body.data.every((e) => String(e.user._id || e.user) === String(alice._id)), `${r.body.count} entries`);

  const bobEntry = await Ledger.findOne({ user: bob._id });
  r = await request(app).get(`/api/ledger/${bobEntry._id}`).set('Cookie', as(alice));
  P("Alice cannot read Bob's entry by id -> 404", r.status === 404, r.status);

  r = await request(app).get(`/api/ledger/${bobEntry._id}`).set('Cookie', as(admin));
  P('admin can read any entry -> 200', r.status === 200, r.status);

  r = await request(app).get('/api/ledger').set('Cookie', as(admin));
  P('admin sees all entries', r.body.count === 3, r.body.count);

  console.log('\n== balance ==');
  r = await request(app).get('/api/ledger/balance').set('Cookie', as(alice));
  P('balance derived from entries (-500 +100)', r.body.data.balance === -400, r.body.data.balance);
  P('totals split by direction', r.body.data.totalPaid === 500 && r.body.data.totalRefunded === 100, JSON.stringify(r.body.data));

  r = await request(app).get(`/api/ledger/balance?user=${bob._id}`).set('Cookie', as(alice));
  P("Alice cannot query Bob's balance", r.body.data.balance === -400, r.body.data.balance);
  r = await request(app).get(`/api/ledger/balance?user=${bob._id}`).set('Cookie', as(admin));
  P("admin can query Bob's balance", r.body.data.balance === -900, r.body.data.balance);

  console.log('\n== adjustments are append-only ==');
  r = await request(app).post('/api/ledger/adjustments').set('Cookie', as(alice))
    .send({ user: String(alice._id), type: 'credit', amount: 9999, description: 'Free money please' });
  P('customer cannot post adjustments -> 403', r.status === 403, r.status);

  r = await request(app).post('/api/ledger/adjustments').set('Cookie', as(admin))
    .send({ user: String(alice._id), type: 'credit', amount: 50, description: 'Goodwill credit for delay' });
  P('admin adjustment -> 201', r.status === 201, r.status);
  P('balanceAfter derived, not supplied', r.body.data.balanceAfter === -350, r.body.data.balanceAfter);
  const adjustment = r.body.data;

  r = await request(app).post('/api/ledger/adjustments').set('Cookie', as(admin))
    .send({ user: String(bob._id), type: 'debit', amount: 10, description: 'Reversing wrong user', reverses: adjustment._id });
  P('cannot reverse another user entry -> 400', r.status === 400, r.body.message);

  r = await request(app).post('/api/ledger/adjustments').set('Cookie', as(admin))
    .send({ user: String(alice._id), type: 'debit', amount: 50, description: 'Reverse goodwill credit', reverses: adjustment._id });
  P('valid reversal -> 201', r.status === 201, r.status);
  r = await request(app).post('/api/ledger/adjustments').set('Cookie', as(admin))
    .send({ user: String(alice._id), type: 'debit', amount: 50, description: 'Reverse it twice', reverses: adjustment._id });
  P('double reversal -> 409', r.status === 409, r.body.message);

  console.log('\n== notifications ==');
  await Notification.create({ user: alice._id, title: 'Alice only', message: 'private', type: 'system' });
  await Notification.create({ user: bob._id, title: 'Bob only', message: 'private', type: 'system' });

  r = await request(app).get('/api/notifications').set('Cookie', as(alice));
  P('Alice sees only her notifications', r.body.data.every((n) => n.title === 'Alice only'), r.body.data.map((n) => n.title).join(','));

  r = await request(app).get('/api/notifications').set('Cookie', as(admin));
  P('admin inbox is personal, not global', r.body.count === 0, r.body.count);

  const bobNotif = await Notification.findOne({ user: bob._id });
  r = await request(app).patch(`/api/notifications/${bobNotif._id}/read`).set('Cookie', as(alice));
  P("Alice cannot mark Bob's notification read -> 404", r.status === 404, r.status);
  const stillUnread = await Notification.findById(bobNotif._id);
  P("Bob's notification untouched", stillUnread.isRead === false);

  r = await request(app).delete(`/api/notifications/${bobNotif._id}`).set('Cookie', as(alice));
  P("Alice cannot delete Bob's notification -> 404", r.status === 404, r.status);

  r = await request(app).get('/api/notifications/unread-count').set('Cookie', as(alice));
  const before = r.body.data.unreadCount;
  await request(app).patch('/api/notifications/read-all').set('Cookie', as(alice));
  r = await request(app).get('/api/notifications/unread-count').set('Cookie', as(alice));
  P('read-all clears own unread only', before > 0 && r.body.data.unreadCount === 0, `${before} -> ${r.body.data.unreadCount}`);
  P("Bob's count unaffected", (await Notification.unreadCount(bob._id)) === 1);

  console.log('\n== broadcast ==');
  r = await request(app).post('/api/notifications').set('Cookie', as(alice))
    .send({ title: 'Spam', message: 'Buy things', audience: 'all' });
  P('customer cannot broadcast -> 403', r.status === 403, r.status);

  r = await request(app).post('/api/notifications').set('Cookie', as(admin))
    .send({ title: 'Scheduled maintenance', message: 'Sunday 02:00 UTC', audience: 'customers', link: '/notices/1' });
  P('admin broadcast to customers -> 201', r.status === 201, r.status);
  P('reached both customers, not admin', r.body.data.sent === 2, r.body.data.sent);
  P('admin did not receive it', (await Notification.countDocuments({ user: admin._id })) === 0);

  r = await request(app).post('/api/notifications').set('Cookie', as(admin))
    .send({ title: 'Bad link', message: 'x', userIds: [String(alice._id)], link: 'javascript:alert(1)' });
  P('javascript: link rejected -> 400', r.status === 400, r.body.details?.[0]?.message);

  r = await request(app).post('/api/notifications').set('Cookie', as(admin))
    .send({ title: 'Ghost', message: 'x', userIds: ['507f1f77bcf86cd799439099'] });
  P('unknown recipient -> 400', r.status === 400, r.body.message);

  console.log('\n== dashboard scoping ==');
  r = await request(app).get('/api/dashboard').set('Cookie', as(alice));
  P('customer dashboard -> 200', r.status === 200, r.status);
  P('scope reported as customer', r.body.scope === 'customer', r.body.scope);
  P('no company revenue in customer payload', r.body.data.revenue === undefined);
  P('no user counts in customer payload', r.body.data.users === undefined);
  P('own booking counted', r.body.data.bookings.total === 1, r.body.data.bookings.total);

  r = await request(app).get('/api/dashboard').set('Cookie', as(admin));
  P('admin dashboard -> 200', r.status === 200, r.status);
  P('scope reported as admin', r.body.scope === 'admin', r.body.scope);
  P('revenue net of refunds', r.body.data.revenue.net === 1300, JSON.stringify(r.body.data.revenue));
  P('user counts present', r.body.data.users.customers === 2 && r.body.data.users.admins === 1, JSON.stringify(r.body.data.users));
  P('top routes computed', r.body.data.topRoutes[0]?.route === 'JFK → LHR', JSON.stringify(r.body.data.topRoutes[0]));
  P('daily series has one point per day', Array.isArray(r.body.data.dailyBookings) && r.body.data.dailyBookings.length === 30, r.body.data.dailyBookings?.length);

  r = await request(app).get('/api/dashboard/revenue').set('Cookie', as(alice));
  P('customer cannot read revenue series -> 403', r.status === 403, r.status);
  r = await request(app).get('/api/dashboard/revenue?period=7d').set('Cookie', as(admin));
  P('admin revenue series -> 200', r.status === 200, r.status);
  P('series length matches period', r.body.data.length === 7, r.body.data.length);

  r = await request(app).get('/api/dashboard?from=2026-12-01&to=2026-01-01').set('Cookie', as(admin));
  P('reversed custom range -> 400', r.status === 400, r.status);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nSUITE ERROR:', err.message);
  if (err.message.includes('ECONNREFUSED')) console.error('Is MongoDB running?');
  process.exit(1);
});
