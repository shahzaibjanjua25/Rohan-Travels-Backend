const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const { ensureCsrfToken, verifyCsrf } = require('./middleware/csrf');

const config = require('./config/env');
const AppError = require('./utils/AppError');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

// Behind a proxy (Render, Railway, nginx) so rate limiting sees real client IPs.
app.set('trust proxy', 1);

// --- Security --------------------------------------------------------------
app.use(helmet());
// backend/src/app.js
app.use(
  cors({
    origin: ['https://rohantravels-frontend.vercel.app', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })
);

app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later' },
  })
);

// --- Body parsing ----------------------------------------------------------
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Auth token lives in an httpOnly cookie, so it must be parsed before any
// route that calls `protect`.
app.use(cookieParser());

// Strip `$` and `.` from user input so a body like { "email": { "$gt": "" } }
// cannot be used as a NoSQL injection to bypass a login query.
app.use(mongoSanitize());

// Reject duplicated query params (?sort=a&sort=b) that turn strings into arrays.
app.use(hpp({ whitelist: ['status', 'airline', 'origin', 'destination'] }));

// CSRF must sit after cookieParser and before any route that mutates state.
app.use(ensureCsrfToken);
app.use(verifyCsrf);

app.use(compression());

if (!config.isProd) app.use(morgan('dev'));

// --- Health check ----------------------------------------------------------
// Add this temporarily to debug cookie config
app.get('/api/debug-cookie-config', (req, res) => {
  res.json({
    cookie: config.cookie,
    csrfEnabled: config.csrfEnabled,
    env: {
      COOKIE_SECURE: process.env.COOKIE_SECURE,
      COOKIE_SAMESITE: process.env.COOKIE_SAMESITE,
      CSRF_ENABLED: process.env.CSRF_ENABLED,
    }
  });
});

// ============================================
// IMPORT ROUTES (ONLY ONCE EACH)
// ============================================
const authRoutes = require('./routes/authRoutes');
const flightRoutes = require('./routes/flightRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const userRoutes = require('./routes/userRoutes');
const settingsRoutes = require('./routes/settingsRoutes'); // ✅ ONLY ONCE

// ============================================
// USE ROUTES
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/flights', flightRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);

// --- Error handling (must be last) -----------------------------------------
app.use(notFound);
app.use(errorHandler);

module.exports = app;