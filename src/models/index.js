// backend/src/models/index.js
const User = require('./User');
const Booking = require('./Booking');
const Flight = require('./Flight');
const Notification = require('./Notification');
const Ledger = require('./Ledger');
const Settings = require('./Settings');
const OTP = require('./OTP');
const UmrahPackage = require('./UmrahPackage');
const UmrahBooking = require('./UmrahBooking');
const Hotel = require('./Hotel');

module.exports = {
  User,
  Flight,
  Booking,
  Ledger,
  Notification,
  Settings,
  OTP,
  UmrahPackage,
  UmrahBooking,
  Hotel,
};