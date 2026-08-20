// backend/src/app.js
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

// --- CORS Configuration - MUST BE FIRST ---
const allowedOrigins = config.corsOrigins;

const originAllowed = (origin) =>
  allowedOrigins.some((pattern) => {
    if (pattern === origin) return true;
    if (!pattern.includes('*')) return false;
    const rx = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+');
    return new RegExp(`^${rx}$`).test(origin);
  });

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (originAllowed(origin)) return callback(null, true);
      console.warn('[cors] blocked origin:', origin);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Accept'],
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

// Auth token lives in an httpOnly cookie
app.use(cookieParser());

// Strip `$` and `.` from user input
app.use(mongoSanitize());

// Reject duplicated query params
app.use(hpp({ whitelist: ['status', 'airline', 'origin', 'destination'] }));

// CSRF
app.use(verifyCsrf);

app.use(compression());

if (!config.isProd) app.use(morgan('dev'));

// --- Health check ----------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', environment: config.env });
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
const umrahRoutes = require('./routes/umrahRoutes'); // ✅ ADD THIS LINE

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
app.use('/api/umrah', umrahRoutes); // ✅ ADD THIS LINE

// --- Error handling (must be last) -----------------------------------------
app.use(notFound);
app.use(errorHandler);

module.exports = app;