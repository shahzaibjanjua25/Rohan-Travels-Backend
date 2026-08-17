// services/misc.js

import api from './api';

export const notificationService = {
  // Get all notifications (for admin)
  getAll: async () => {
    try {
      // Try admin-specific endpoint first
      const response = await api.get('/notifications/admin');
      return response;
    } catch (error) {
      // If that fails, try alternative endpoints
      try {
        const response = await api.get('/admin/notifications');
        return response;
      } catch (err) {
        // Try the generic all endpoint
        try {
          const response = await api.get('/notifications/all');
          return response;
        } catch (e) {
          // If all fail, throw the original error
          throw error;
        }
      }
    }
  },

  // Get user notifications
  getUserNotifications: async () => {
    const response = await api.get('/notifications');
    return response;
  },

  // Get unread count
  unreadCount: async () => {
    try {
      const response = await api.get('/notifications/unread-count');
      return response;
    } catch (error) {
      // If admin endpoint fails, try user endpoint
      try {
        const response = await api.get('/notifications/count');
        return response;
      } catch (err) {
        throw error;
      }
    }
  },

  // Mark as read
  markAsRead: async (id) => {
    const response = await api.put(`/notifications/${id}/read`);
    return response;
  },

  // Mark all as read
  markAllRead: async () => {
    try {
      const response = await api.put('/notifications/read-all');
      return response;
    } catch (error) {
      try {
        const response = await api.put('/admin/notifications/read-all');
        return response;
      } catch (err) {
        throw error;
      }
    }
  },

  // Delete single notification
  delete: async (id) => {
    try {
      const response = await api.delete(`/notifications/${id}`);
      return response;
    } catch (error) {
      try {
        const response = await api.delete(`/admin/notifications/${id}`);
        return response;
      } catch (err) {
        throw error;
      }
    }
  },

  // Delete all notifications
  deleteAll: async () => {
    try {
      const response = await api.delete('/notifications/all');
      return response;
    } catch (error) {
      try {
        const response = await api.delete('/admin/notifications/all');
        return response;
      } catch (err) {
        throw error;
      }
    }
  },
  deleteAllAdmin: async () => {
    const response = await api.delete('/notifications/admin/all');
    return response;
  },
};