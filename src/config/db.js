const mongoose = require('mongoose');
const config = require('./env');

/**
 * Mongoose 8 no longer needs useNewUrlParser / useUnifiedTopology — passing
 * them logs a deprecation warning, so they are deliberately absent here.
 */
mongoose.set('strictQuery', true);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });

    // Log the host, never the full URI — an Atlas URI contains the password.
    console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error(`[db] Connection failed: ${err.message}`);
    if (err.message.includes('ECONNREFUSED')) {
      console.error('[db] Is MongoDB running? Try:');
      console.error('       macOS   brew services start mongodb-community');
      console.error('       Linux   sudo systemctl start mongod');
      console.error('       Windows net start MongoDB');
    }
    throw err;
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('[db] MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('[db] MongoDB reconnected');
});

module.exports = connectDB;
