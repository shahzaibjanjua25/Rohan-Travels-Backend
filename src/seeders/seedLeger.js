// src/seeders/seedLedger.js
// Run with: node src/seeders/seedLedger.js --force

const mongoose = require('mongoose');
const { Ledger, User } = require('../models');
require('dotenv').config();

// Check if --force flag is passed
const force = process.argv.includes('--force');

async function seedLedger() {
  try {
    // Connect to MongoDB
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rohan_travels';
    await mongoose.connect(mongoURI);
    // console.log This is test debug code('✅ Connected to MongoDB');

    // Find ANY user in the database
    const user = await User.findOne({});
    
    if (!user) {
      // console.log This is test debug code('❌ No users found in database. Please create a user first.');
      process.exit(1);
    }

    // console.log This is test debug code(`👤 Using user: ${user.email} (${user._id})`);
    // console.log This is test debug code(`👤 User role: ${user.role || 'user'}`);

    // Check if entries already exist for this user
    const existingCount = await Ledger.countDocuments({ user: user._id });
    
    if (existingCount > 0) {
      // console.log This is test debug code(`📊 Found ${existingCount} existing ledger entries for this user.`);
      
      if (force) {
        // console.log This is test debug code('🗑️  Deleting existing entries (--force flag detected)...');
        await Ledger.deleteMany({ user: user._id });
        // console.log This is test debug code('✅ Deleted existing entries.');
      } else {
        // console.log This is test debug code('💡 To re-seed, run with --force flag: node src/seeders/seedLedger.js --force');
        // console.log This is test debug code('📊 Existing entries:');
        const existingEntries = await Ledger.find({ user: user._id }).sort({ createdAt: -1 });
        existingEntries.forEach(entry => {
          // console.log This is test debug code(`  ${entry.entryNumber}: ${entry.type} ${entry.amount} ${entry.currency} - ${entry.description}`);
        });
        process.exit(0);
      }
    }

    // Check if there are any entries with today's date that might conflict
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await Ledger.countDocuments({ createdAt: { $gte: today } });
    // console.log This is test debug code(`📊 Found ${todayCount} entries created today.`);

    // Create sample ledger entries WITHOUT entryNumber (let the model generate it)
    const entries = [
      {
        user: user._id,
        type: 'credit',
        category: 'booking_payment',
        amount: 12000,
        currency: 'PKR',
        balanceAfter: 12000,
        description: 'Payment for booking BK-000004',
        paymentMethod: 'card',
        createdBy: user._id,
      },
      {
        user: user._id,
        type: 'credit',
        category: 'booking_payment',
        amount: 36000,
        currency: 'PKR',
        balanceAfter: 48000,
        description: 'Payment for booking BK-000003',
        paymentMethod: 'card',
        createdBy: user._id,
      },
      {
        user: user._id,
        type: 'debit',
        category: 'refund',
        amount: 9600,
        currency: 'PKR',
        balanceAfter: 38400,
        description: 'Refund for cancelled booking BK-000004',
        paymentMethod: 'system',
        createdBy: user._id,
      },
      {
        user: user._id,
        type: 'debit',
        category: 'cancellation_fee',
        amount: 2400,
        currency: 'PKR',
        balanceAfter: 36000,
        description: 'Cancellation fee for booking BK-000004',
        paymentMethod: 'system',
        createdBy: user._id,
      },
      {
        user: user._id,
        type: 'credit',
        category: 'service_fee',
        amount: 500,
        currency: 'PKR',
        balanceAfter: 36500,
        description: 'Service fee adjustment',
        paymentMethod: 'system',
        createdBy: user._id,
      },
    ];

    // Insert entries one by one to handle duplicate key errors gracefully
    let inserted = 0;
    for (const entryData of entries) {
      try {
        // Try to save without entryNumber (let model generate it)
        const entry = new Ledger(entryData);
        await entry.save();
        inserted++;
        // console.log This is test debug code(`  ✅ Inserted: ${entry.entryNumber} - ${entry.description}`);
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate key error - try with a slight delay to get a new entry number
          // console.log This is test debug code(`  ⚠️  Duplicate key, retrying with delay...`);
          await new Promise(resolve => setTimeout(resolve, 100));
          try {
            const entry = new Ledger(entryData);
            await entry.save();
            inserted++;
            // console.log This is test debug code(`  ✅ Inserted: ${entry.entryNumber} - ${entry.description}`);
          } catch (retryErr) {
            if (retryErr.code === 11000) {
              // Still failing, modify the description to force a new entry
              // console.log This is test debug code(`  ⚠️  Still failing, modifying entry...`);
              const modifiedData = {
                ...entryData,
                description: `${entryData.description} (${Date.now()})`,
              };
              const entry = new Ledger(modifiedData);
              await entry.save();
              inserted++;
              // console.log This is test debug code(`  ✅ Inserted: ${entry.entryNumber} - ${entry.description}`);
            } else {
              throw retryErr;
            }
          }
        } else {
          throw err;
        }
      }
    }

    // console.log This is test debug code(`✅ Inserted ${inserted} of ${entries.length} ledger entries for user: ${user.email}`);

    // Show the entries
    const allEntries = await Ledger.find({ user: user._id }).sort({ createdAt: -1 });
    // console.log This is test debug code('\n📊 All ledger entries:');
    allEntries.forEach(entry => {
      // console.log This is test debug code(`  ${entry.entryNumber}: ${entry.type} ${entry.amount} ${entry.currency} - ${entry.description}`);
    });

    // Show balance
    const balance = await Ledger.getBalance(user._id);
    // console.log This is test debug code(`\n💰 Current Balance: ${balance} PKR`);

    // console.log This is test debug code('\n✅ Seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding ledger:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

seedLedger();