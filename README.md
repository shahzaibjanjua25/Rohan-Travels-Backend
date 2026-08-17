# Rohan Travels — Backend

Node/Express REST API with MongoDB. This document supersedes the setup steps
in the original project brief; several of those steps describe values that are
no longer used (notably the hardcoded `admin@example.com` / `admin123` seed
credentials, which have been removed).

---

## 1. Prerequisites

- Node.js 18+
- npm 9+
- MongoDB 6+ running locally, or a MongoDB Atlas connection string

```bash
# macOS
brew services start mongodb-community
# Linux
sudo systemctl start mongod
# Windows
net start MongoDB
```

---

## 2. Install

```bash
cd backend
npm install
```

---

## 3. Configure

```bash
cp .env.example .env
```

Three secrets must be generated. Do not invent them by hand:

```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# ENCRYPTION_KEY — must be exactly 64 hex characters
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# SEED_ADMIN_PASSWORD
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

Then set `SEED_ADMIN_EMAIL` to the address you want to sign in with.

The server validates configuration at boot and exits with a clear message
rather than starting in a broken state. It refuses to run if `JWT_SECRET` is
missing or shorter than 32 characters, if `ENCRYPTION_KEY` is not 64 hex
characters, or if `COOKIE_SAMESITE=none` is set without `COOKIE_SECURE=true`.

### Back up `ENCRYPTION_KEY`

This key encrypts passenger passport numbers. **Losing it makes existing
passport data permanently unrecoverable.** Store it somewhere other than the
database it protects.

---

## 4. Seed

```bash
npm run seed
```

Creates the settings document, an administrator from `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`, and 14 days of sample flights across 8 routes.

Both seeders are idempotent — re-running will not duplicate records, and the
admin seeder will never reset the password of an account that already exists.

```bash
npm run seed -- --reset    # delete sample flights first
npm run seed:admin         # admin only
npm run seed:flights       # flights only
```

Sample departures are generated relative to the moment the seeder runs, so
they never go stale and become unbookable.

---

## 5. Run

```bash
npm run dev     # nodemon, hot reload
npm start       # production
```

Health check: `http://localhost:5000/api/health`

---

## 6. Test

Integration suites need MongoDB running. They use a throwaway database
(`rohan_travels_test`) which is dropped on exit, so development data is safe.

```bash
npm run test:integration    # everything
npm run test:auth           # sessions, lockout, password reset
npm run test:flights        # search, CRUD, capacity guards
npm run test:bookings       # includes the concurrency race test
npm run test:reporting      # ledger isolation, dashboard scoping
npm run test:users          # admin lockout protection, seeders
```

`test:bookings` fires 20 simultaneous requests at a 5-seat flight and asserts
exactly 5 succeed. If seat reservation is ever refactored from an atomic
update back into a read-then-write, that test is what will catch it.

---

## 7. API reference

All routes are under `/api`. Cookie-based auth: send `credentials: 'include'`
and an `X-CSRF-Token` header (read from the `rt_csrf` cookie) on every
POST/PUT/PATCH/DELETE.

### Auth
| Method | Path | Access |
|---|---|---|
| GET | `/auth/csrf` | public |
| POST | `/auth/register` | public |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public |
| POST | `/auth/forgot-password` | public |
| POST | `/auth/reset-password` | public |
| GET | `/auth/me` | authenticated |
| PATCH | `/auth/me` | authenticated |
| PATCH | `/auth/password` | authenticated |

### Flights
| Method | Path | Access |
|---|---|---|
| GET | `/flights` | public (search, filters, pagination) |
| GET | `/flights/:id` | public |
| POST | `/flights` | admin |
| PUT | `/flights/:id` | admin |
| PATCH | `/flights/:id/status` | admin |
| DELETE | `/flights/:id` | admin (soft-deletes if booked) |

### Bookings
| Method | Path | Access |
|---|---|---|
| POST | `/bookings` | authenticated |
| GET | `/bookings` | own; all for admin |
| GET | `/bookings/:id` | owner or admin |
| PATCH | `/bookings/:id/cancel` | owner or admin |
| GET | `/bookings/flights/:flightId/seats` | authenticated |
| GET | `/bookings/:id/documents` | admin (decrypts passports, audited) |
| PATCH | `/bookings/:id/pay` | admin |
| PATCH | `/bookings/:id/status` | admin |

### Ledger
| Method | Path | Access |
|---|---|---|
| GET | `/ledger` | own; all for admin |
| GET | `/ledger/balance` | own; any user for admin |
| GET | `/ledger/:id` | owner or admin |
| GET | `/ledger/summary` | admin |
| POST | `/ledger/adjustments` | admin (append-only) |

### Notifications
| Method | Path | Access |
|---|---|---|
| GET | `/notifications` | own only |
| GET | `/notifications/unread-count` | own only |
| PATCH | `/notifications/:id/read` | own only |
| PATCH | `/notifications/read-all` | own only |
| DELETE | `/notifications/:id` | own only |
| DELETE | `/notifications/read` | own only |
| POST | `/notifications` | admin (targeted or broadcast) |

### Dashboard
| Method | Path | Access |
|---|---|---|
| GET | `/dashboard` | customer or admin view by role |
| GET | `/dashboard/revenue` | admin |

### Users
| Method | Path | Access |
|---|---|---|
| GET | `/users` | admin |
| GET | `/users/:id` | admin |
| GET | `/users/:id/bookings` | admin |
| PATCH | `/users/:id` | admin |
| DELETE | `/users/:id` | admin (soft-deletes if records exist) |

---

## 8. Security notes

Decisions worth knowing about before changing anything:

- **Auth is an httpOnly cookie**, so JavaScript cannot read the token and an
  XSS bug cannot exfiltrate a session. The cost is CSRF exposure, which is why
  double-submit CSRF protection is mandatory rather than optional.
- **Passport numbers are encrypted at rest** with AES-256-GCM and marked
  `select: false`. Plaintext access happens only through
  `revealPassengerDocuments()`, which is a method rather than a virtual
  precisely so every call site can be found by grep.
- **Login cannot be used to enumerate accounts.** Wrong password, unknown
  address and deactivated account return an identical message, and unknown
  addresses still run a bcrypt comparison so response timing does not leak.
- **Accounts lock after 8 failed attempts** for 15 minutes, tracked per
  account with an atomic `$inc`.
- **Ledger entries are immutable.** Corrections are posted as reversing
  entries; balances are derived by aggregation rather than stored.
- **Seat inventory uses atomic conditional updates**, not read-then-write.
  See the comment block in `src/utils/seatInventory.js`.
- **Notification links must be relative paths.** `javascript:` URLs and
  protocol-relative `//host` values are rejected — both are stored XSS in an
  `href`.
- **Admins cannot set passwords**, change their own role, deactivate
  themselves, or remove the last active administrator.

---

## 9. Known gaps

Deliberately unfinished, listed so they are not mistaken for oversights:

1. **Pending bookings hold seats indefinitely.** There is no expiry job, so
   abandoned checkouts slowly consume a flight's availability. Production
   systems release these after 15–30 minutes.
2. **No refresh-token endpoint.** `JWT_EXPIRE` defaults to `1d`, so sessions
   end abruptly after 24 hours. The config supports refresh tokens; the
   rotation endpoint is not built.
3. **Payment is simulated.** `PATCH /bookings/:id/pay` stands in for a Stripe
   or PayPal webhook. It is admin-only and guarded against replay, but no real
   payment provider is integrated.
4. **`departureDate` search resolves as a UTC calendar day.** Correct for a
   single-region deployment; a multi-region product should resolve the day
   boundary in the origin airport's timezone.
5. **Seat-number assignment has a residual race** (seat *counts* do not). The
   window is milliseconds and the failure mode is a duplicate seat assignment
   rather than an oversold flight.
