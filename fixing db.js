/**
 * Drop the unique index on flightNumber
 * Run with: node src/scripts/dropFlightNumberIndex.js
 */
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, './.env') });

async function dropFlightNumberIndex() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get the flights collection
    const collection = mongoose.connection.collection('flights');
    
    // Get all indexes
    const indexes = await collection.indexes();
    console.log('📋 Current indexes:', indexes.map(i => i.name));

    // Find the flightNumber index
    const flightNumberIndex = indexes.find(i => i.key && i.key.flightNumber !== undefined);
    
    if (flightNumberIndex) {
      console.log(`🗑️ Dropping index: ${flightNumberIndex.name}`);
      await collection.dropIndex(flightNumberIndex.name);
      console.log('✅ Index dropped successfully!');
    } else {
      console.log('ℹ️ No flightNumber index found. Nothing to drop.');
    }

    // Verify the index is gone
    const updatedIndexes = await collection.indexes();
    const stillExists = updatedIndexes.find(i => i.key && i.key.flightNumber !== undefined);
    
    if (stillExists) {
      console.log('⚠️ Index still exists!');
    } else {
      console.log('✅ Confirmed: flightNumber index is removed.');
    }

    await mongoose.disconnect();
    console.log('👋 Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

dropFlightNumberIndex();