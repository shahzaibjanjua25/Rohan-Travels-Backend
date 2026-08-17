// src/services/flights.js
import api from './api';

export const flightService = {
  // Get all flights with pagination and filters
  search: (params) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/flights?${query}`);
  },

  // Get single flight
  get: (id) => api.get(`/flights/${id}`),
  getFilters: () => api.get('/flights/filters'),

  // Create new flight
  create: (data) => api.post('/flights', data),

  // Update flight
  update: (id, data) => api.put(`/flights/${id}`, data),

  // Update flight status
  setStatus: (id, status) => api.patch(`/flights/${id}/status`, { status }),

  // Soft delete (withdraw)
  remove: (id) => api.delete(`/flights/${id}`),
};

export default flightService;