
// models/index.js

const User = require('./User');
const Booking = require('./Booking');
const Flight = require('./Flight');
const Notification = require('./Notification');
const Ledger = require('./Ledger');  // ✅ Make sure this is here

module.exports = {
  User: require('./User'),
  Flight: require('./Flight'),
  Booking: require('./Booking'),
  Ledger: require('./Ledger'),
  Notification: require('./Notification'),
  Settings: require('./Settings'),
};