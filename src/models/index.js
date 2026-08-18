// backend/src/models/index.js
const User = require('./User');
const Booking = require('./Booking');
const Flight = require('./Flight');
const Notification = require('./Notification');
const Ledger = require('./Ledger');
const Settings = require('./Settings');
const OTP = require('./OTP');

module.exports = {
  User,
  Flight,
  Booking,
  Ledger,
  Notification,
  Settings,
  OTP,
};