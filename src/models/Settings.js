const mongoose = require('mongoose');

/**
 * Singleton. The `key` field is pinned to 'global' with a unique index, so the
 * collection can only ever hold one document no matter how many times
 * `create` is called.
 */
const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'global',
      unique: true,
      immutable: true,
      enum: ['global'],
    },

    siteName: { type: String, default: 'Rohan Travels', trim: true },
    supportEmail: { type: String, default: '', lowercase: true, trim: true },
    supportPhone: { type: String, default: '', trim: true },

    defaultCurrency: { type: String, default: 'PKR', uppercase: true, maxlength: 3 },

    booking: {
      // How far ahead a customer may book.
      maxAdvanceDays: { type: Number, default: 365, min: 1 },
      // Cut-off before departure, in hours.
      cutoffHours: { type: Number, default: 2, min: 0 },
      maxPassengersPerBooking: { type: Number, default: 9, min: 1, max: 9 },
      taxRatePercent: { type: Number, default: 0, min: 0, max: 100 },
      serviceFee: { type: Number, default: 0, min: 0 },
    },

    cancellation: {
      enabled: { type: Boolean, default: true },
      // Cancellation is refused inside this window before departure.
      allowedUntilHours: { type: Number, default: 24, min: 0 },
      refundPercent: { type: Number, default: 80, min: 0, max: 100 },
      flatFee: { type: Number, default: 0, min: 0 },
    },

    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: '', trim: true, maxlength: 500 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/** Fetch the settings document, creating it with defaults on first call. */
settingsSchema.statics.getSettings = async function getSettings() {
  const existing = await this.findOne({ key: 'global' });
  if (existing) return existing;
  return this.create({ key: 'global' });
};

module.exports = mongoose.model('Settings', settingsSchema);
