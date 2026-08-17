/**
 * User administration and seeder integration tests. Requires MongoDB.
 *
 *   cd backend
 *   node tests/users.integration.js
 *
 * The lockout assertions matter most: an admin must not be able to strand the
 * system with no way back in, because there is no API path to recover from it.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/rohan_travels_test';
process.env.JWT_SECRET = 'test'.repeat(16);
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
process.env.CSRF_ENABLED = 'false';
process.env.EMAIL_ENABLED = 'false';
process.env.SEED_ADMIN_EMAIL = 'seeded-admin@test.local';
process.env.SEED_ADMIN_PASSWORD = 'seeded-passphrase-9931';

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
  const { User, Flight, Booking, Ledger } = require('../src/models');
  const { signAccessToken } = require('../src/utils/token');
  const cfg = require('../src/config/env');
  const seedAdmin = require('../src/seeders/adminSeeder');
  const seedFlights = require('../src/seeders/flightSeeder');

  console.log('\n== admin seeder ==');
  const seeded = await seedAdmin({ silent: true });
  P('creates an admin from env credentials', seeded.role === 'admin' && seeded.email === 'seeded-admin@test.local');

  const before = await User.findOne({ email: 'seeded-admin@test.local' }).select('+password');
  await seedAdmin({ silent: true });
  const after = await User.findOne({ email: 'seeded-admin@test.local' }).select('+password');
  P('re-running does not duplicate', (await User.countDocuments({ email: 'seeded-admin@test.local' })) === 1);
  P('re-running does not reset the password hash', before.password === after.password);

  const savedPassword = process.env.SEED_ADMIN_PASSWORD;
  delete process.env.SEED_ADMIN_PASSWORD;
  delete require.cache[require.resolve('../src/config/env')];
  let refused = false;
  try {
    const freshConfig = require('../src/config/env');
    freshConfig.seed.adminPassword = undefined;
    await seedAdmin({ silent: true });
  } catch (err) {
    refused = /must be set/.test(err.message);
  }
  P('refuses to run without SEED_ADMIN_PASSWORD', refused);
  process.env.SEED_ADMIN_PASSWORD = savedPassword;

  console.log('\n== flight seeder ==');
  const created = await seedFlights({ days: 3, silent: true });
  P('creates flights', created > 0, `${created} flights`);

  const past = await Flight.countDocuments({ departureTime: { $lt: new Date() } });
  P('no seeded flight departs in the past', past === 0, `${past} past flights`);

  const soonest = await Flight.findOne().sort({ departureTime: 1 });
  const hoursOut = (soonest.departureTime - Date.now()) / 3600000;
  P('soonest departure is comfortably ahead', hoursOut > 2, `${hoursOut.toFixed(1)}h`);

  const againCreated = await seedFlights({ days: 3, silent: true });
  P('re-running is idempotent (no duplicates)', againCreated === 0, `${againCreated} new`);

  console.log('\n== user administration ==');
  const admin = await User.findOne({ email: 'seeded-admin@test.local' });
  const admin2 = await User.create({ name: 'Second Admin', email: 'admin2@test.local', password: 'correct-horse-battery', role: 'admin' });
  const alice = await User.create({ name: 'Alice', email: 'alice@test.local', password: 'correct-horse-battery' });
  const bob = await User.create({ name: 'Bob', email: 'bob@test.local', password: 'correct-horse-battery' });
  const as = (u) => [`${cfg.cookie.name}=${signAccessToken(u)}`];

  let r = await request(app).get('/api/users').set('Cookie', as(alice));
  P('customer cannot list users -> 403', r.status === 403, r.status);

  r = await request(app).get('/api/users').set('Cookie', as(admin));
  P('admin lists users -> 200', r.status === 200, r.status);
  P('no password hashes in the payload', JSON.stringify(r.body).includes('$2a$') === false && JSON.stringify(r.body).includes('$2b$') === false);
  P('no lockout internals leaked', JSON.stringify(r.body).includes('loginAttempts') === false);

  r = await request(app).get('/api/users?search=' + encodeURIComponent('.*')).set('Cookie', as(admin));
  P('regex metacharacters in search are escaped', r.body.count === 0, r.body.count);

  r = await request(app).get('/api/users?search=alice').set('Cookie', as(admin));
  P('search finds by name', r.body.count === 1, r.body.count);

  console.log('\n== self-lockout guards ==');
  r = await request(app).patch(`/api/users/${admin._id}`).set('Cookie', as(admin)).send({ role: 'user' });
  P('admin cannot demote themselves -> 403', r.status === 403, r.body.message);

  r = await request(app).patch(`/api/users/${admin._id}`).set('Cookie', as(admin)).send({ isActive: false });
  P('admin cannot deactivate themselves -> 403', r.status === 403, r.body.message);

  r = await request(app).delete(`/api/users/${admin._id}`).set('Cookie', as(admin));
  P('admin cannot delete themselves -> 403', r.status === 403, r.body.message);

  console.log('\n== last-admin protection ==');
  r = await request(app).patch(`/api/users/${admin2._id}`).set('Cookie', as(admin)).send({ role: 'user' });
  P('can demote a second admin while another remains', r.status === 200, r.status);

  // admin is now the only active admin left.
  r = await request(app).patch(`/api/users/${admin._id}`).set('Cookie', as(admin2)).send({ role: 'user' });
  P('demoted user loses admin access -> 403', r.status === 403, r.status);

  const lonelyAdmin = await User.findById(admin._id);
  const otherAdmins = await User.countDocuments({ role: 'admin', isActive: true, _id: { $ne: admin._id } });
  P('exactly one active admin remains', otherAdmins === 0 && lonelyAdmin.role === 'admin');

  const tempAdmin = await User.create({ name: 'Temp', email: 'temp@test.local', password: 'correct-horse-battery', role: 'admin' });
  r = await request(app).patch(`/api/users/${admin._id}`).set('Cookie', as(tempAdmin)).send({ isActive: false });
  P('another admin can deactivate a peer when a spare exists', r.status === 200, r.status);
  await User.updateOne({ _id: admin._id }, { $set: { isActive: true } });
  await User.deleteOne({ _id: tempAdmin._id });

  console.log('\n== deletion preserves records ==');
  const flight = await Flight.findOne();
  await Booking.create({
    user: bob._id, flight: flight._id, cabinClass: 'economy', contactEmail: 'b@t.local',
    passengers: [{ firstName: 'B', lastName: 'C', dateOfBirth: new Date('1990-01-01') }],
    pricing: { pricePerSeat: 100, seatCount: 1, subtotal: 0, totalAmount: 0 },
  });
  await Ledger.create({ user: bob._id, type: 'debit', category: 'booking_payment', amount: 100, description: 'Bob payment', balanceAfter: -100 });

  r = await request(app).delete(`/api/users/${bob._id}`).set('Cookie', as(admin));
  P('user with records is soft-deleted', r.body.softDeleted === true, r.body.message);
  P('account deactivated, not removed', (await User.findById(bob._id))?.isActive === false);
  P('bookings survive', (await Booking.countDocuments({ user: bob._id })) === 1);
  P('ledger entries survive', (await Ledger.countDocuments({ user: bob._id })) === 1);

  const clean = await User.create({ name: 'Clean', email: 'clean@test.local', password: 'correct-horse-battery' });
  r = await request(app).delete(`/api/users/${clean._id}`).set('Cookie', as(admin));
  P('user with no records is hard-deleted', r.body.softDeleted === false, r.body.softDeleted);
  P('record actually gone', (await User.findById(clean._id)) === null);

  console.log('\n== deactivated users cannot act ==');
  r = await request(app).get('/api/auth/me').set('Cookie', as(bob));
  P('deactivated session rejected -> 403', r.status === 403, r.status);

  console.log('\n== admin cannot set passwords ==');
  r = await request(app).patch(`/api/users/${alice._id}`).set('Cookie', as(admin)).send({ password: 'takeover-password' });
  P('password field rejected -> 400', r.status === 400, r.body.details?.[0]?.message);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nSUITE ERROR:', err.message);
  if (err.message.includes('ECONNREFUSED')) console.error('Is MongoDB running?');
  process.exit(1);
});
