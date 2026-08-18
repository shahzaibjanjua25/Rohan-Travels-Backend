// backend/src/app.js
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize'); // ✅ ADD THIS LINE
const rateLimit = require('express-rate-limit');

const { ensureCsrfToken, verifyCsrf } = require('./middleware/csrf');
const config = require('./config/env');
const AppError = require('./utils/AppError');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

// Behind a proxy (Render, Railway, nginx) so rate limiting sees real client IPs.
app.set('trust proxy', 1);

// --- CORS Configuration - MUST BE FIRST ---
// ✅ Allow both production and local development
const allowedOrigins = [
  'https://rohantravels-frontend.vercel.app',
  'https://rohan-travels-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      // Check if the origin is allowed
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.warn('❌ CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true, // ✅ REQUIRED for cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Accept'],
    exposedHeaders: ['Set-Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

// --- Security --------------------------------------------------------------
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// --- Body parsing ----------------------------------------------------------
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Auth token lives in an httpOnly cookie, so it must be parsed before any
// route that calls `protect`.
app.use(cookieParser());

// Strip `$` and `.` from user input
app.use(mongoSanitize());

// Reject duplicated query params
app.use(hpp({ whitelist: ['status', 'airline', 'origin', 'destination'] }));

// CSRF must sit after cookieParser and before any route that mutates state.
app.use(ensureCsrfToken);
app.use(verifyCsrf);

app.use(compression());

if (!config.isProd) app.use(morgan('dev'));

// --- Health check ----------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', environment: config.env });
});

// --- Debug endpoint (temporarily) ---
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
// IMPORT ROUTES
// ============================================
const authRoutes = require('./routes/authRoutes');
const flightRoutes = require('./routes/flightRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const userRoutes = require('./routes/userRoutes');
const settingsRoutes = require('./routes/settingsRoutes');

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