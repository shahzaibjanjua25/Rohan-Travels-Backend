// backend/src/controllers/settingsController.js
const { Settings } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

/**
 * GET /api/settings - Get settings
 */
exports.getSettings = catchAsync(async (req, res) => {
  const settings = await Settings.getSettings();
  res.status(200).json({ success: true, data: settings });
});

/**
 * PUT /api/settings - Update settings (admin only)
 */
exports.updateSettings = catchAsync(async (req, res) => {
  const settings = await Settings.findOne({ key: 'global' });
  
  if (!settings) {
    throw AppError.notFound('Settings not found');
  }

  // Allowed fields to update
  const allowedFields = [
    'siteName',
    'supportEmail',
    'supportPhone',
    'defaultCurrency',
    'booking',
    'cancellation',
    'maintenanceMode',
    'maintenanceMessage',
  ];

  // Only update allowed fields
  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      settings[field] = req.body[field];
    }
  });

  settings.updatedBy = req.user._id;
  await settings.save();

  res.status(200).json({
    success: true,
    data: settings,
    message: 'Settings updated successfully'
  });
});

/**
 * POST /api/settings/reset - Reset settings to defaults (admin only)
 */
exports.resetSettings = catchAsync(async (req, res) => {
  await Settings.deleteOne({ key: 'global' });
  const settings = await Settings.getSettings();
  
  res.status(200).json({
    success: true,
    data: settings,
    message: 'Settings reset to defaults'
  });
});