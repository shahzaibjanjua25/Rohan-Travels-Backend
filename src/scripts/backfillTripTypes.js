/**
 * backend/src/scripts/backfillTripTypes.js
 *
 * One-off backfill for the trip-type / generic-travel-type change.
 *
 *   node src/scripts/backfillTripTypes.js            # dry run, reports only
 *   node src/scripts/backfillTripTypes.js --apply    # writes
 *
 * Why this is needed: a Mongoose `default` only applies when a document is
 * created. Every flight already in the database has no `tripType` field at
 * all, so `filter.tripType = 'one_way'` matches none of them and the new trip
 * filter silently returns an empty list for your entire existing inventory.
 *
 * Runs as updateMany rather than a save() loop on purpose. save() would fire
 * the model's pre('validate') hook on rows that predate these rules, and a
 * legacy row failing validation would abort a migration that is otherwise
 * safe. This only sets fields that are absent, so re-running is a no-op.
 */
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { Flight } = require('../models');

const APPLY = process.argv.includes('--apply');

const run = async () => {
  await connectDB();

  const [missingTripType, missingTravelTypes, total] = await Promise.all([
    Flight.countDocuments({ tripType: { $exists: false } }),
    Flight.countDocuments({
      $or: [{ travelTypes: { $exists: false } }, { travelTypes: { $size: 0 } }],
    }),
    Flight.countDocuments({}),
  ]);

  console.log('\n[backfill] Flight collection');
  console.log(`  total flights ................. ${total}`);
  console.log(`  missing tripType .............. ${missingTripType}`);
  console.log(`  missing/empty travelTypes ..... ${missingTravelTypes}`);

  if (!APPLY) {
    console.log('\n[backfill] Dry run. Re-run with --apply to write these changes.\n');
    return;
  }

  // Everything that exists today is a single hop.
  const tripResult = await Flight.updateMany(
    { tripType: { $exists: false } },
    { $set: { tripType: 'one_way' } }
  );

  // An untagged flight was previously visible under every purpose filter,
  // because no travel-type filter was being applied to it. `generic` is the
  // tag that preserves exactly that behaviour under the new rules — anything
  // narrower would quietly hide inventory that used to sell.
  const travelResult = await Flight.updateMany(
    { $or: [{ travelTypes: { $exists: false } }, { travelTypes: { $size: 0 } }] },
    { $set: { travelTypes: ['generic'] } }
  );

  console.log('\n[backfill] Applied');
  console.log(`  tripType set on ............... ${tripResult.modifiedCount}`);
  console.log(`  travelTypes set on ............ ${travelResult.modifiedCount}`);

  const remaining = await Flight.countDocuments({ tripType: { $exists: false } });
  if (remaining > 0) {
    console.warn(`\n[backfill] WARNING: ${remaining} flight(s) still have no tripType.`);
  } else {
    console.log('\n[backfill] Done. Every flight now has a tripType.\n');
  }
};

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n[backfill] ${err.message}\n`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });