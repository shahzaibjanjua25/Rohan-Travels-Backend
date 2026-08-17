// scripts/updateFlights.js
// Run with: node scripts/updateFlights.js

const mongoose = require('mongoose');
const connectDB = require('../config/db');

// ✅ Import the Flight model directly
const Flight = require('../models/Flight');

const updateFlights = async () => {
  try {
    await connectDB();
    console.log('🔄 Connected to MongoDB');

    console.log('📊 Updating flights...');

    // Update all flights to add flightType if missing
    // Domestic flights: origin and destination are both in Pakistan
    const domesticResult = await Flight.updateMany(
      { 
        flightType: { $exists: false },
        'origin.country': 'Pakistan',
        'destination.country': 'Pakistan'
      },
      { 
        $set: { 
          flightType: 'domestic',
          travelTypes: ['tour', 'family', 'medical', 'business', 'other']
        } 
      }
    );
    console.log(`✅ Updated ${domesticResult.modifiedCount} flights as DOMESTIC`);

    // International flights: origin OR destination is NOT in Pakistan
    const internationalResult = await Flight.updateMany(
      { 
        flightType: { $exists: false },
        $or: [
          { 'origin.country': { $ne: 'Pakistan' } },
          { 'destination.country': { $ne: 'Pakistan' } }
        ]
      },
      { 
        $set: { 
          flightType: 'international',
          travelTypes: ['tour', 'work_visa', 'study_visa', 'umrah', 'hajj', 'business', 'family', 'medical', 'other']
        } 
      }
    );
    console.log(`✅ Updated ${internationalResult.modifiedCount} flights as INTERNATIONAL`);

    // Update any remaining flights without flightType (fallback)
    const remainingResult = await Flight.updateMany(
      { flightType: { $exists: false } },
      { 
        $set: { 
          flightType: 'domestic',
          travelTypes: ['tour', 'family', 'business', 'other']
        } 
      }
    );
    console.log(`✅ Updated ${remainingResult.modifiedCount} remaining flights`);

    // Update flights that have flightType but no travelTypes
    const travelTypesResult = await Flight.updateMany(
      { 
        flightType: { $exists: true },
        travelTypes: { $exists: false }
      },
      { 
        $set: { 
          travelTypes: ['tour', 'family', 'business', 'other']
        } 
      }
    );
    console.log(`✅ Added travelTypes to ${travelTypesResult.modifiedCount} flights`);

    // Verify the updates
    const totalCount = await Flight.countDocuments();
    const withFlightType = await Flight.countDocuments({ flightType: { $exists: true } });
    const withTravelTypes = await Flight.countDocuments({ travelTypes: { $exists: true, $ne: [] } });
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total flights: ${totalCount}`);
    console.log(`   With flightType: ${withFlightType}`);
    console.log(`   With travelTypes: ${withTravelTypes}`);

    // Show sample flights
    const sample = await Flight.find()
      .limit(3)
      .select('flightNumber airline flightType travelTypes origin.country destination.country');
    console.log('\n📋 Sample flights:');
    sample.forEach((flight, index) => {
      console.log(`   ${index + 1}. ${flight.flightNumber} - ${flight.airline}`);
      console.log(`      Type: ${flight.flightType || 'Not set'}`);
      console.log(`      Travel Types: ${flight.travelTypes ? flight.travelTypes.join(', ') : 'None'}`);
      console.log(`      Origin: ${flight.origin?.country || 'N/A'} → Destination: ${flight.destination?.country || 'N/A'}`);
    });

    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

updateFlights();