// src/services/bookings.js
import api from './api';

export const bookingService = {
  // Get all bookings (with filters)
  list: (params) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/bookings?${query}`);
  },
  
  // Get single booking
  get: (id) => api.get(`/bookings/${id}`),
  
  // Create new booking
  create: (data) => api.post('/bookings', data),
  
  // Update booking status (admin only)
  updateStatus: (id, status) => {
    console.log(`📌 Sending status update: ${id} -> ${status}`);
    return api.patch(`/bookings/${id}/status`, { status });
  },
  
  // Mark as paid (admin only) - this sets status to 'confirmed'
  markPaid: (id, data) => {
    console.log(`📌 Marking as paid: ${id}`);
    return api.patch(`/bookings/${id}/pay`, data);
  },
  
  // Cancel booking
  cancel: (id, reason) => {
    console.log(`📌 Cancelling booking: ${id}`);
    return api.patch(`/bookings/${id}/cancel`, { reason: reason || '' });
  },
  
  // Get travel documents (admin only)
  documents: (id) => {
    return api.get(`/bookings/${id}/documents`);
  },
  
  // Get booking statistics
  getStats: () => api.get('/bookings/stats'),
  
  // ✅ ADD THIS - Alias for list method
  getAll: (params) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/bookings?${query}`);
  },
};

export default bookingService;