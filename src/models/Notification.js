// models/Notification.js

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },

    type: {
      type: String,
      enum: ['booking', 'payment', 'flight_update', 'system', 'promotion'],
      default: 'system',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high'],
      default: 'normal',
    },

    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,

    // ✅ NEW: Soft delete field
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,

    // Where the frontend should navigate when the notification is clicked.
    link: { type: String, trim: true },

    relatedBooking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    relatedFlight: { type: mongoose.Schema.Types.ObjectId, ref: 'Flight' },

    // MongoDB deletes the document once this date passes, so the collection
    // does not grow without bound. Defaults to 90 days out.
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true }
);

// The unread badge query.
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, deleted: 1 });

// TTL index — the background reaper runs about once a minute.
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

notificationSchema.methods.markRead = function markRead() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

notificationSchema.statics.unreadCount = function unreadCount(userId) {
  return this.countDocuments({ user: userId, isRead: false, deleted: false });
};

// Static method to create notification for multiple users
notificationSchema.statics.createForUsers = async function(userIds, data) {
  const notifications = userIds.map(userId => ({
    user: userId,
    ...data,
  }));
  return this.insertMany(notifications);
};

module.exports = mongoose.model('Notification', notificationSchema);