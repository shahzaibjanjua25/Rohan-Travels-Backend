/**
 * Runs every seeder in order.
 *
 *   npm run seed
 *   npm run seed -- --reset     (clear sample flights first)
 *   npm run seed -- --force     (required to run against NODE_ENV=production)
 */
const mongoose = require('mongoose');
const config = require('../config/env');
const connectDB = require('../config/db');
const { Settings } = require('../models');
const seedAdmin = require('./adminSeeder');
const seedFlights = require('./flightSeeder');

const run = async () => {
  const reset = process.argv.includes('--reset');
  const force = process.argv.includes('--force');

  // Seeding a live database is occasionally legitimate and usually a
  // mistake, so it requires saying so explicitly.
  if (config.isProd && !force) {
    throw new Error(
      'Refusing to seed with NODE_ENV=production. Re-run with --force if this is intentional.'
    );
  }

  if (config.isProd && reset) {
    throw new Error('--reset deletes flight records and is not permitted in production.');
  }

  await connectDB();

  console.log('\n[seed] Starting\n');

  await Settings.getSettings();
  console.log('[seed] Settings document ready');

  await seedAdmin();
  await seedFlights({ reset });

  console.log('\n[seed] Done\n');
};

if (require.main === module) {
  run()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(`\n[seed] ${err.message}\n`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = run;
