const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/notificationController');

// All notification routes require authentication
router.use(protect);

// ============================================
// USER ROUTES (for regular users)
// ============================================

// Get user's own notifications
router.get('/', ctrl.getNotifications);

// Get unread count for user
router.get('/unread-count', ctrl.getUnreadCount);

// Mark user notification as read
router.patch('/:id/read', ctrl.markRead);

// Mark all user notifications as read
router.patch('/read-all', ctrl.markAllRead);

// Delete user notification
router.delete('/:id', ctrl.deleteNotification);

// Delete all read user notifications
router.delete('/read', ctrl.clearRead);

// ============================================
// ADMIN ROUTES (for admin panel)
// ⚠️ IMPORTANT: Specific routes MUST come before parameterized routes
// ============================================

// ✅ SPECIFIC ROUTES (no :id parameter) - put these FIRST
router.get('/admin', authorize('admin'), ctrl.getAdminNotifications);
router.get('/admin/unread-count', authorize('admin'), ctrl.getAdminUnreadCount);
router.delete('/admin/delete-all', authorize('admin'), ctrl.deleteAllNotifications);
router.patch('/admin/read-all', authorize('admin'), ctrl.markAllAdminNotificationsRead);

// ✅ PARAMETERIZED ROUTES (with :id) - put these LAST
router.patch('/admin/:id/read', authorize('admin'), ctrl.markAdminNotificationRead);
router.delete('/admin/:id', authorize('admin'), ctrl.deleteAdminNotification);

// Send notification to users (admin only)
router.post('/', authorize('admin'), ctrl.sendNotification);

module.exports = router;