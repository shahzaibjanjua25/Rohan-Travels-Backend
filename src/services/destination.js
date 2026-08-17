import api from './api';

export const destinationService = {
  // Get unique destinations from flights
  async getPopularDestinations(limit = 6) {
    const response = await api.get('/destinations/popular', {
      params: { limit }
    });
    return response.data;
  }
};