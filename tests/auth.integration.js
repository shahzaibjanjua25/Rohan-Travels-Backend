/**
 * Auth integration tests. Requires a running MongoDB.
 *
 *   cd backend
 *   node tests/auth.integration.js
 *
 * Uses a throwaway database that is dropped on exit.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/rohan_travels_test';
process.env.JWT_SECRET = 'test'.repeat(16);
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
process.env.CSRF_ENABLED = 'true';
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
  const { User } = require('../src/models');

  /** supertest agent that persists cookies, plus automatic CSRF header. */
  const client = () => {
    const agent = request.agent(app);
    return {
      agent,
      async post(path, body) {
        await agent.get('/api/auth/csrf');
        const jar = agent.jar.getCookie('rt_csrf', { path: '/', domain: '127.0.0.1', secure: false, script: false });
        const token = jar ? jar.value : '';
        return agent.post(path).set('X-CSRF-Token', token).send(body);
      },
      async patch(path, body) {
        await agent.get('/api/auth/csrf');
        const jar = agent.jar.getCookie('rt_csrf', { path: '/', domain: '127.0.0.1', secure: false, script: false });
        const token = jar ? jar.value : '';
        return agent.patch(path).set('X-CSRF-Token', token).send(body);
      },
      get: (path) => agent.get(path),
    };
  };

  const GOOD_PASSWORD = 'correct-horse-battery';

  console.log('\n== registration ==');
  const c = client();
  let r = await c.post('/api/auth/register', {
    name: 'Ada Lovelace',
    email: 'ada@test.local',
    password: GOOD_PASSWORD,
  });
  P('register -> 201', r.status === 201, r.status);
  P('role forced to "user"', r.body.data?.role === 'user', r.body.data?.role);
  P('password absent from response', JSON.stringify(r.body).includes('password') === false);
  P('auth cookie is httpOnly', (r.headers['set-cookie'] || []).some((x) => x.startsWith('rt_token=') && /HttpOnly/i.test(x)));
  P('csrf cookie is NOT httpOnly', (r.headers['set-cookie'] || []).some((x) => x.startsWith('rt_csrf=') && !/HttpOnly/i.test(x)));

  r = await c.post('/api/auth/register', { name: 'Ada', email: 'ada@test.local', password: GOOD_PASSWORD });
  P('duplicate email -> 409', r.status === 409, r.status);

  console.log('\n== session ==');
  r = await c.get('/api/auth/me');
  P('GET /me with cookie -> 200', r.status === 200, r.status);
  P('/me returns the right user', r.body.data?.email === 'ada@test.local');

  r = await c.post('/api/auth/logout', {});
  P('logout -> 200', r.status === 200, r.status);
  r = await c.get('/api/auth/me');
  P('/me after logout -> 401', r.status === 401, r.status);

  console.log('\n== login and enumeration resistance ==');
  const c2 = client();
  r = await c2.post('/api/auth/login', { email: 'ada@test.local', password: 'wrong-password-here' });
  const wrongPwMsg = r.body.message;
  P('wrong password -> 401', r.status === 401, r.status);

  r = await c2.post('/api/auth/login', { email: 'nobody@test.local', password: 'wrong-password-here' });
  P('unknown account -> 401', r.status === 401, r.status);
  P('identical message for both failures', r.body.message === wrongPwMsg, `"${r.body.message}"`);

  r = await c2.post('/api/auth/login', { email: 'ada@test.local', password: GOOD_PASSWORD });
  P('correct credentials -> 200', r.status === 200, r.status);
  const fresh = await User.findOne({ email: 'ada@test.local' }).select('+loginAttempts');
  P('successful login resets attempt counter', fresh.loginAttempts === 0, fresh.loginAttempts);

  console.log('\n== account lockout ==');
  await User.create({ name: 'Target', email: 'target@test.local', password: GOOD_PASSWORD });
  const c3 = client();
  let lockedAt = null;
  for (let i = 1; i <= 9; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await c3.post('/api/auth/login', { email: 'target@test.local', password: `bad-guess-${i}` });
    if (res.status === 403 && lockedAt === null) lockedAt = i;
  }
  P('account locks after repeated failures', lockedAt !== null, `locked on attempt ${lockedAt}`);
  r = await c3.post('/api/auth/login', { email: 'target@test.local', password: GOOD_PASSWORD });
  P('correct password still refused while locked', r.status === 403, r.status);

  console.log('\n== password change invalidates old sessions ==');
  const c4 = client();
  await c4.post('/api/auth/login', { email: 'ada@test.local', password: GOOD_PASSWORD });
  const stale = request.agent(app);
  await stale.get('/api/auth/csrf');
  const staleCookie = (await c4.get('/api/auth/me')).request.cookies;

  r = await c4.patch('/api/auth/password', { currentPassword: GOOD_PASSWORD, newPassword: 'a-brand-new-passphrase' });
  P('password change -> 200', r.status === 200, r.body.message);
  r = await c4.get('/api/auth/me');
  P('current device stays logged in', r.status === 200, r.status);

  r = await request(app).get('/api/auth/me').set('Cookie', staleCookie);
  P('token issued before the change is rejected', r.status === 401, r.status);

  r = await c4.post('/api/auth/login', { email: 'ada@test.local', password: GOOD_PASSWORD });
  P('old password no longer works', r.status === 401, r.status);

  console.log('\n== forgot / reset password ==');
  const c5 = client();
  r = await c5.post('/api/auth/forgot-password', { email: 'ada@test.local' });
  const knownMsg = r.body.message;
  P('forgot-password for real account -> 200', r.status === 200, r.status);
  r = await c5.post('/api/auth/forgot-password', { email: 'ghost@test.local' });
  P('identical response for unknown account', r.status === 200 && r.body.message === knownMsg);

  const withToken = await User.findOne({ email: 'ada@test.local' }).select('+passwordResetToken +passwordResetExpires');
  P('reset token stored hashed, not raw', /^[a-f0-9]{64}$/.test(withToken.passwordResetToken || ''), (withToken.passwordResetToken || '').slice(0, 16) + '...');

  r = await c5.post('/api/auth/reset-password', { token: 'f'.repeat(64), password: 'another-good-passphrase' });
  P('bogus reset token -> 400', r.status === 400, r.status);

  console.log('\n== field tampering ==');
  const c6 = client();
  await c6.post('/api/auth/login', { email: 'ada@test.local', password: 'a-brand-new-passphrase' });
  r = await c6.patch('/api/auth/me', { name: 'New Name', role: 'admin' });
  P('role in profile update -> 400', r.status === 400, JSON.stringify(r.body.details));
  r = await c6.patch('/api/auth/me', { name: 'New Name' });
  P('legitimate profile update -> 200', r.status === 200, r.status);
  const after = await User.findOne({ email: 'ada@test.local' });
  P('role unchanged', after.role === 'user', after.role);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('\nSUITE ERROR:', err.message);
  if (err.message.includes('ECONNREFUSED')) console.error('Is MongoDB running?');
  process.exit(1);
});
