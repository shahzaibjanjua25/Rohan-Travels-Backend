// middleware/maintenance.js

const { Settings } = require('../models');

/**
 * Maintenance mode middleware
 * Blocks all requests when maintenance mode is enabled,
 * except for admin users and the settings API
 */
const maintenanceMode = async (req, res, next) => {
  try {
    // Skip maintenance check for:
    // - Settings API (so admin can disable it)
    // - Login/register (so users can't access but admins can login)
    // - Health check
    const skipPaths = [
      '/api/settings',
      '/api/auth/login',
      '/api/auth/register',
      '/api/health'
    ];
    
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Get settings
    const settings = await Settings.getSettings();
    
    // If maintenance mode is not enabled, continue
    if (!settings.maintenanceMode) {
      return next();
    }

    // Check if user is admin
    if (req.user && req.user.role === 'admin') {
      return next();
    }

    // Block the request
    const message = settings.maintenanceMessage || 'We are currently undergoing maintenance. Please check back later.';
    
    res.status(503).json({
      success: false,
      error: 'maintenance',
      message: message,
      maintenance: true
    });
  } catch (error) {
    console.error('❌ Maintenance middleware error:', error);
    next();
  }
};

module.exports = maintenanceMode;