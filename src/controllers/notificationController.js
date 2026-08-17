const { Notification, User } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const BROADCAST_BATCH = 500;

// ============================================
// USER ROUTES (for regular users)
// ============================================

/**
 * GET /api/notifications — always scoped to the caller.
 * Users only see notifications where deleted: false
 */
exports.getNotifications = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const filter = { 
    user: req.user._id,
    deleted: false  // ✅ Only show non-deleted notifications
  };
  if (req.query.isRead !== undefined) filter.isRead = req.query.isRead === 'true';
  if (req.query.type) filter.type = req.query.type;

  const [notifications, total, unread] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('relatedBooking', 'bookingReference status')
      .populate('relatedFlight', 'flightNumber'),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, isRead: false, deleted: false }),
  ]);

  res.status(200).json({
    success: true,
    count: notifications.length,
    unreadCount: unread,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
    data: notifications,
  });
});

/**
 * GET /api/notifications/unread-count — for the badge.
 */
exports.getUnreadCount = catchAsync(async (req, res) => {
  const unreadCount = await Notification.countDocuments({
    user: req.user._id,
    isRead: false,
    deleted: false,  // ✅ Only count non-deleted
  });
  res.status(200).json({ success: true, data: { unreadCount } });
});

/**
 * PATCH /api/notifications/:id/read — Mark a single notification as read (USER)
 */
exports.markRead = catchAsync(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, deleted: false },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );

  if (!notification) throw AppError.notFound('Notification not found');
  res.status(200).json({ success: true, data: notification });
});

/**
 * PATCH /api/notifications/read-all — Mark all user notifications as read (USER)
 */
exports.markAllRead = catchAsync(async (req, res) => {
  const result = await Notification.updateMany(
    { user: req.user._id, isRead: false, deleted: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  res.status(200).json({ success: true, data: { updated: result.modifiedCount } });
});

/**
 * DELETE /api/notifications/:id — Soft delete a notification (USER)
 * ✅ Users can only soft-delete their own notifications
 * ✅ Admin can still see it
 */
exports.deleteNotification = catchAsync(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, deleted: false },
    { $set: { deleted: true, deletedAt: new Date() } },
    { new: true }
  );

  if (!notification) throw AppError.notFound('Notification not found');
  res.status(200).json({ success: true, data: {} });
});

/**
 * DELETE /api/notifications/read — Soft delete all read notifications (USER)
 * ✅ Users can only soft-delete their own read notifications
 * ✅ Admin can still see them
 */
exports.clearRead = catchAsync(async (req, res) => {
  const result = await Notification.updateMany(
    { user: req.user._id, isRead: true, deleted: false },
    { $set: { deleted: true, deletedAt: new Date() } }
  );
  res.status(200).json({
    success: true,
    data: { deleted: result.modifiedCount }
  });
});

// ============================================
// ADMIN ROUTES (for admin panel)
// ============================================

/**
 * GET /api/notifications/admin — Get ALL notifications (ADMIN)
 * ✅ Admin sees ALL notifications including soft-deleted ones
 */
exports.getAdminNotifications = catchAsync(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Admin access required');
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.isRead !== undefined) filter.isRead = req.query.isRead === 'true';
  if (req.query.userId) filter.user = req.query.userId;
  if (req.query.deleted !== undefined) filter.deleted = req.query.deleted === 'true';

  const [notifications, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email role')
      .populate('relatedBooking', 'bookingReference status')
      .populate('relatedFlight', 'flightNumber origin destination'),
    Notification.countDocuments(filter),
  ]);

  const unreadCount = await Notification.countDocuments({ isRead: false });

  res.status(200).json({
    success: true,
    count: notifications.length,
    unreadCount: unreadCount,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
    data: notifications,
  });
});

/**
 * GET /api/notifications/admin/unread-count — Get total unread count (ADMIN)
 */
exports.getAdminUnreadCount = catchAsync(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Admin access required');
  }

  const unreadCount = await Notification.countDocuments({ isRead: false });
  res.status(200).json({ success: true, data: { unreadCount } });
});

/**
 * PATCH /api/notifications/admin/:id/read — Mark any notification as read (ADMIN)
 */
exports.markAdminNotificationRead = catchAsync(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Admin access required');
  }

  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );

  if (!notification) throw AppError.notFound('Notification not found');
  res.status(200).json({ success: true, data: notification });
});

/**
 * PATCH /api/notifications/admin/read-all — Mark ALL notifications as read (ADMIN)
 */
exports.markAllAdminNotificationsRead = catchAsync(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Admin access required');
  }

  const result = await Notification.updateMany(
    { isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );

  res.status(200).json({
    success: true,
    data: { updated: result.modifiedCount }
  });
});

/**
 * DELETE /api/notifications/admin/:id — Hard delete any notification (ADMIN)
 * ✅ Admin can permanently delete any notification
 */
exports.deleteAdminNotification = catchAsync(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Admin access required');
  }

  const deleted = await Notification.findByIdAndDelete(req.params.id);
  if (!deleted) throw AppError.notFound('Notification not found');
  res.status(200).json({ success: true, data: {} });
});

/**
 * DELETE /api/notifications/admin/delete-all — Hard delete ALL notifications (ADMIN)
 * ✅ Admin can permanently delete all notifications
 */
exports.deleteAllNotifications = catchAsync(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw AppError.forbidden('Admin access required');
  }

  const result = await Notification.deleteMany({});

  res.status(200).json({
    success: true,
    data: { deleted: result.deletedCount }
  });
});

/**
 * POST /api/notifications — Send notification to users (ADMIN)
 */
exports.sendNotification = catchAsync(async (req, res) => {
  const { title, message, type, priority, link, userIds, audience } = req.body;

  let recipients;

  if (audience) {
    const filter = { isActive: true };
    if (audience === 'admins') filter.role = 'admin';
    if (audience === 'customers') filter.role = 'user';
    recipients = await User.find(filter).select('_id').lean();
    recipients = recipients.map((u) => u._id);
  } else {
    const found = await User.find({ _id: { $in: userIds }, isActive: true }).select('_id').lean();
    if (found.length !== userIds.length) {
      const foundIds = new Set(found.map((u) => String(u._id)));
      const missing = userIds.filter((id) => !foundIds.has(String(id)));
      throw AppError.badRequest(`Unknown or inactive user(s): ${missing.join(', ')}`);
    }
    recipients = found.map((u) => u._id);
  }

  if (!recipients.length) throw AppError.badRequest('No recipients matched');

  const base = {
    title,
    message,
    type: type || 'system',
    priority: priority || 'normal',
    link,
    isRead: false,
  };

  let created = 0;

  for (let i = 0; i < recipients.length; i += BROADCAST_BATCH) {
    const batch = recipients.slice(i, i + BROADCAST_BATCH).map((user) => ({ ...base, user }));
    const inserted = await Notification.insertMany(batch, { ordered: false });
    created += inserted.length;
  }

  console.log(`[audit] admin ${req.user._id} sent "${title}" to ${created} recipient(s)`);

  res.status(201).json({ success: true, data: { sent: created } });
});