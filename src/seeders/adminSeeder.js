/**
 * Creates the first administrator.
 *
 *   npm run seed:admin
 *
 * Credentials come from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD. There is no
 * fallback and no default: a well-known seeded password like `admin123` is a
 * live vulnerability on every deployment that ever forgot to change it, and
 * it will be found by anyone reading the repository.
 */
const mongoose = require('mongoose');
const config = require('../config/env');
const connectDB = require('../config/db');
const { User } = require('../models');

const MIN_PASSWORD_LENGTH = 10;

const seedAdmin = async ({ silent = false } = {}) => {
  const log = (...args) => {
    if (!silent) console.log(...args);
  };

  const { adminEmail, adminPassword, adminName } = config.seed;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env before seeding an administrator.\n' +
        'Generate a password with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(18).toString(\'base64url\'))"'
    );
  }

  if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const existing = await User.findOne({ email: adminEmail.toLowerCase() });

  if (existing) {
    // Never silently reset the password of an account that already exists —
    // re-running a seeder should not be able to change live credentials.
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
      log(`[seed] Promoted existing user ${existing.email} to admin`);
    } else {
      log(`[seed] Admin ${existing.email} already exists, left unchanged`);
    }
    return existing;
  }

  const admin = await User.create({
    name: adminName,
    email: adminEmail.toLowerCase(),
    password: adminPassword,
    role: 'admin',
  });

  log(`[seed] Created admin: ${admin.email}`);
  log('[seed] Sign in with the password from SEED_ADMIN_PASSWORD, then change it.');
  return admin;
};

module.exports = seedAdmin;

// Allow `node src/seeders/adminSeeder.js` as well as programmatic use.
if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await seedAdmin();
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error(`\n[seed] ${err.message}\n`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    }
  })();
}
