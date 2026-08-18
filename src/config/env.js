const path = require('path');
const dotenv = require('dotenv');

// Load .env from the current working directory (backend folder)
dotenv.config({ path: path.join(process.cwd(), '.env') });

/**
 * Fail fast on missing configuration.
 *
 * The alternative is discovering a blank JWT_SECRET at the moment a user tries
 * to log in, which is Issue 4 in the setup doc. Crashing at boot with a clear
 * message is cheaper than debugging it later.
 */
const REQUIRED = ['MONGODB_URI', 'JWT_SECRET'];

const missing = REQUIRED.filter((key) => !process.env[key] || !process.env[key].trim());
if (missing.length) {
  console.error(
    `\n[config] Missing required environment variable(s): ${missing.join(', ')}\n` +
      `[config] Copy backend/.env to backend/.env and fill them in.\n`
  );
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('\n[config] JWT_SECRET must be at least 32 characters. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
  process.exit(1);
}

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
};

// Browsers reject `SameSite=None` unless `Secure` is also set. Without this
// check the cookie is dropped silently and login appears to succeed while
// every subsequent request comes back 401.
if (
  (process.env.COOKIE_SAMESITE || 'lax').toLowerCase() === 'none' &&
  String(process.env.COOKIE_SECURE).toLowerCase() !== 'true'
) {
  console.error('\n[config] COOKIE_SAMESITE=none requires COOKIE_SECURE=true (HTTPS).\n');
  process.exit(1);
}

// A wrong-length key fails at the moment someone submits a passport number,
// which is the worst possible time to find out.
if (process.env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
  console.error('\n[config] ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).\n');
  process.exit(1);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: toInt(process.env.PORT, 5000),

  mongoUri: process.env.MONGODB_URI,

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRE || '1d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRE || '30d',
  },

  bcryptRounds: toInt(process.env.BCRYPT_SALT_ROUNDS, 12),

  encryptionKey: process.env.ENCRYPTION_KEY,

  // Used to build password reset links.
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''),

  // Env-driven only. Deliberately *not* auto-disabled under NODE_ENV=test:
  // a security control that switches itself off in the test environment is a
  // control nothing ever verifies.
  csrfEnabled: toBool(process.env.CSRF_ENABLED, true),

  cookie: {
    name: process.env.COOKIE_NAME || 'rt_token',
    secure: toBool(process.env.COOKIE_SECURE, false),
    sameSite: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(),
    domain: process.env.COOKIE_DOMAIN || undefined,
  },

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 15) * 60 * 1000,
    max: toInt(process.env.RATE_LIMIT_MAX, 300),
    authMax: toInt(process.env.AUTH_RATE_LIMIT_MAX, 10),
  },

  email: {
    enabled: toBool(process.env.EMAIL_ENABLED, false),
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: toInt(process.env.EMAIL_PORT, 587),
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    from: process.env.EMAIL_FROM || 'Rohan Travels <noreply@example.com>',
  },

  cloudinary: {
    enabled: toBool(process.env.CLOUDINARY_ENABLED, false),
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL,
    adminPassword: process.env.SEED_ADMIN_PASSWORD,
    adminName: process.env.SEED_ADMIN_NAME || 'System Administrator',
  },
};

module.exports = config;
