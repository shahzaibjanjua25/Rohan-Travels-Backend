const { Ledger } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');

/**
 * GET /api/ledger/balance - Get user's balance
 */
exports.getBalance = catchAsync(async (req, res) => {
  try {
    const userId = req.user._id;
    console.log('🔍 Getting balance for user:', userId);
    
    const balance = await Ledger.getBalance(userId);
    console.log('💰 Balance:', balance);
    
    res.status(200).json({
      success: true,
      balance: balance || 0,
    });
  } catch (error) {
    console.error('❌ Error in getBalance:', error);
    // Return 0 balance on error instead of failing
    res.status(200).json({
      success: true,
      balance: 0,
    });
  }
});

/**
 * GET /api/ledger/entries - Get user's ledger entries
 */
exports.getEntries = catchAsync(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Get user ID as string
    const userId = req.user._id.toString();
    console.log('📊 Fetching ledger entries for user:', userId);

    // Build filter - use string comparison for reliability
    const filter = { user: userId };
    
    // Optional filters
    if (req.query.type) filter.type = req.query.type;
    if (req.query.category) filter.category = req.query.category;

    console.log('📊 Filter:', JSON.stringify(filter));

    // Try to find entries - use string comparison
    const entries = await Ledger.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email')
      .populate('booking', 'bookingReference')
      .populate('createdBy', 'name email')
      .lean();

    const total = await Ledger.countDocuments(filter);

    console.log('📊 Found entries:', entries.length);

    res.status(200).json({
      success: true,
      count: entries.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
      data: entries,
    });
  } catch (error) {
    console.error('❌ Error in getEntries:', error);
    // Return empty array on error
    res.status(200).json({
      success: true,
      count: 0,
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
      data: [],
    });
  }
});

/**
 * GET /api/ledger/entries/:id - Get a specific entry
 */
exports.getEntry = catchAsync(async (req, res) => {
  const entry = await Ledger.findOne({
    _id: req.params.id,
    user: req.user._id,
  })
    .populate('booking', 'bookingReference')
    .populate('createdBy', 'name email');

  if (!entry) throw AppError.notFound('Ledger entry not found');
  res.status(200).json({ success: true, data: entry });
});

/**
 * GET /api/ledger/summary - Get account summary
 */
exports.getSummary = catchAsync(async (req, res) => {
  try {
    const userId = req.user._id.toString();

    const [credits, debits] = await Promise.all([
      Ledger.aggregate([
        { $match: { user: userId, type: 'credit' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Ledger.aggregate([
        { $match: { user: userId, type: 'debit' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
    ]);

    const balance = await Ledger.getBalance(req.user._id);

    res.status(200).json({
      success: true,
      data: {
        balance: balance || 0,
        totalCredits: credits[0]?.total || 0,
        totalDebits: debits[0]?.total || 0,
      }
    });
  } catch (error) {
    console.error('❌ Error in getSummary:', error);
    res.status(200).json({
      success: true,
      data: {
        balance: 0,
        totalCredits: 0,
        totalDebits: 0,
      }
    });
  }
});

/**
 * POST /api/ledger/entries - Create a new ledger entry (admin only)
 */
exports.createEntry = catchAsync(async (req, res) => {
  const { userId, type, category, amount, description, bookingId, paymentMethod } = req.body;

  // Validate required fields
  if (!userId || !type || !category || !amount || !description) {
    throw AppError.badRequest('Missing required fields: userId, type, category, amount, description');
  }

  // Get current balance
  const currentBalance = await Ledger.getBalance(userId);

  // Calculate new balance
  const balanceAfter = type === 'credit' 
    ? currentBalance + amount 
    : currentBalance - amount;

  // Create entry
  const entry = await Ledger.create({
    user: userId,
    type,
    category,
    amount,
    currency: req.body.currency || 'PKR',
    balanceAfter,
    description,
    booking: bookingId || null,
    paymentMethod: paymentMethod || 'system',
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    data: entry,
  });
});