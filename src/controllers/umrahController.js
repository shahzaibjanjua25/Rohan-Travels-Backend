// backend/src/controllers/umrahController.js
const { UmrahPackage, UmrahBooking, Hotel, User, Notification } = require('../models');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { sendEmail } = require('../config/email');
const config = require('../config/env');

// ============================================
// PACKAGE CONTROLLERS
// ============================================

/**
 * GET /api/umrah/packages
 * List all Umrah packages with filters
 */
// backend/src/controllers/umrahController.js - Update getPackages function

/**
 * GET /api/umrah/packages
 * List all Umrah packages with filters
 */
exports.getPackages = catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { isActive: true };

    // Apply filters from query params
    if (req.query.airline) {
        filter.airline = { $regex: req.query.airline, $options: 'i' };
    }
    if (req.query.origin) {
        filter['origin.city'] = { $regex: req.query.origin, $options: 'i' };
    }
    if (req.query.destination) {
        filter['destination.city'] = { $regex: req.query.destination, $options: 'i' };
    }
    if (req.query.departureDate) {
        const start = new Date(req.query.departureDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        filter.departureDate = { $gte: start, $lt: end };
    }
    if (req.query.minPrice) {
        filter.perPersonPrice = { ...filter.perPersonPrice, $gte: parseInt(req.query.minPrice) };
    }
    if (req.query.maxPrice) {
        filter.perPersonPrice = { ...filter.perPersonPrice, $lte: parseInt(req.query.maxPrice) };
    }
    if (req.query.isFeatured === 'true') {
        filter.isFeatured = true;
    }

    // Also filter by sharing prices if min/max are provided
    if (req.query.minPrice || req.query.maxPrice) {
        // Add sharing prices to the filter
        const priceFilter = {};
        if (req.query.minPrice) {
            const min = parseInt(req.query.minPrice);
            priceFilter.$gte = min;
        }
        if (req.query.maxPrice) {
            const max = parseInt(req.query.maxPrice);
            priceFilter.$lte = max;
        }
        if (Object.keys(priceFilter).length > 0) {
            filter.$or = [
                { perPersonPrice: priceFilter },
                { 'sharingPrices.quad': priceFilter },
                { 'sharingPrices.triple': priceFilter },
                { 'sharingPrices.double': priceFilter },
            ];
        }
    }

    const sort = req.query.sort || 'departureDate';
    const sortOrder = req.query.order === 'desc' ? -1 : 1;

    console.log('Filter:', JSON.stringify(filter, null, 2));

    const [packages, total] = await Promise.all([
        UmrahPackage.find(filter)
            .sort({ [sort]: sortOrder })
            .skip(skip)
            .limit(limit)
            .populate('createdBy', 'name email'),
        UmrahPackage.countDocuments(filter)
    ]);

    res.status(200).json({
        success: true,
        count: packages.length,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1
        },
        data: packages
    });
});

/**
 * GET /api/umrah/packages/:id
 * Get single Umrah package
 */
exports.getPackage = catchAsync(async (req, res) => {
    const pkg = await UmrahPackage.findById(req.params.id)
        .populate('createdBy', 'name email');

    if (!pkg) throw AppError.notFound('Package not found');

    res.status(200).json({ success: true, data: pkg });
});

/**
 * POST /api/umrah/packages
 * Create a new Umrah package (admin only)
 */
exports.createPackage = catchAsync(async (req, res) => {
    const data = req.body;

    // Validate hotels - preserve ALL fields including nights
    if (data.makkahHotel && data.makkahHotel.name) {
        // Check if hotel exists in the Hotel collection
        let hotel = await Hotel.findOne({
            name: data.makkahHotel.name,
            city: 'makkah'
        });
        if (!hotel) {
            hotel = await Hotel.create({
                name: data.makkahHotel.name,
                city: 'makkah',
                distance: data.makkahHotel.distance || '',
                rating: data.makkahHotel.rating || 0
            });
        }
        // Store the hotel reference AND keep the nights from the request
        data.makkahHotel = {
            ...hotel.toObject(),
            nights: data.makkahHotel.nights || 0  // ← CRITICAL: preserve nights
        };
    }

    if (data.madinahHotel && data.madinahHotel.name) {
        let hotel = await Hotel.findOne({
            name: data.madinahHotel.name,
            city: 'madinah'
        });
        if (!hotel) {
            hotel = await Hotel.create({
                name: data.madinahHotel.name,
                city: 'madinah',
                distance: data.madinahHotel.distance || '',
                rating: data.madinahHotel.rating || 0
            });
        }
        data.madinahHotel = {
            ...hotel.toObject(),
            nights: data.madinahHotel.nights || 0  // ← CRITICAL: preserve nights
        };
    }

    data.createdBy = req.user._id;

    const pkg = await UmrahPackage.create(data);

    res.status(201).json({ success: true, data: pkg });
});
/**
 * PUT /api/umrah/packages/:id
 * Update an Umrah package (admin only)
 */
exports.updatePackage = catchAsync(async (req, res) => {
    const pkg = await UmrahPackage.findById(req.params.id);
    if (!pkg) throw AppError.notFound('Package not found');

    const data = req.body;

    if (data.makkahHotel && data.makkahHotel.name) {
        let hotel = await Hotel.findOne({
            name: data.makkahHotel.name,
            city: 'makkah'
        });
        if (!hotel) {
            hotel = await Hotel.create({
                name: data.makkahHotel.name,
                city: 'makkah',
                distance: data.makkahHotel.distance || '',
                rating: data.makkahHotel.rating || 0
            });
        }
        data.makkahHotel = {
            ...hotel.toObject(),
            nights: data.makkahHotel.nights || 0  // ← CRITICAL: preserve nights
        };
    }

    if (data.madinahHotel && data.madinahHotel.name) {
        let hotel = await Hotel.findOne({
            name: data.madinahHotel.name,
            city: 'madinah'
        });
        if (!hotel) {
            hotel = await Hotel.create({
                name: data.madinahHotel.name,
                city: 'madinah',
                distance: data.madinahHotel.distance || '',
                rating: data.madinahHotel.rating || 0
            });
        }
        data.madinahHotel = {
            ...hotel.toObject(),
            nights: data.madinahHotel.nights || 0  // ← CRITICAL: preserve nights
        };
    }

    Object.assign(pkg, data);
    await pkg.save();

    res.status(200).json({ success: true, data: pkg });
});

/**
 * DELETE /api/umrah/packages/:id
 * Delete/Deactivate an Umrah package (admin only)
 */
exports.deletePackage = catchAsync(async (req, res) => {
    const pkg = await UmrahPackage.findById(req.params.id);
    if (!pkg) throw AppError.notFound('Package not found');

    const activeBookings = await UmrahBooking.countDocuments({
        package: pkg._id,
        status: { $in: ['pending', 'confirmed'] }
    });

    if (activeBookings > 0) {
        pkg.isActive = false;
        await pkg.save();
        return res.status(200).json({
            success: true,
            softDeleted: true,
            message: `Package has ${activeBookings} active booking(s), so it was deactivated instead of deleted`,
            data: pkg
        });
    }

    await pkg.deleteOne();
    res.status(200).json({ success: true, softDeleted: false, data: {} });
});

/**
 * PATCH /api/umrah/packages/:id/status
 * Update package status (admin only)
 */
exports.updatePackageStatus = catchAsync(async (req, res) => {
    const pkg = await UmrahPackage.findById(req.params.id);
    if (!pkg) throw AppError.notFound('Package not found');

    pkg.isActive = req.body.isActive !== undefined ? req.body.isActive : pkg.isActive;
    pkg.isFeatured = req.body.isFeatured !== undefined ? req.body.isFeatured : pkg.isFeatured;
    await pkg.save();

    res.status(200).json({ success: true, data: pkg });
});

// ============================================
// BOOKING CONTROLLERS
// ============================================

/**
 * POST /api/umrah/bookings
 * Create an Umrah booking
 */
exports.createBooking = catchAsync(async (req, res) => {
    const {
        packageId,
        passengers,
        roomType,
        customerDetails,
        specialRequests
    } = req.body;

    if (!packageId) throw AppError.badRequest('Package ID is required');
    if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
        throw AppError.badRequest('At least one passenger is required');
    }

    const pkg = await UmrahPackage.findById(packageId);
    if (!pkg) throw AppError.notFound('Package not found');
    if (!pkg.isActive) throw AppError.conflict('This package is no longer available');

    // Calculate pricing
    const sharingPrice = pkg.sharingPrices?.[roomType] || pkg.perPersonPrice;
    const adultCount = passengers.filter(p => p.type === 'adult').length;
    const childCount = passengers.filter(p => p.type === 'child').length;
    const infantCount = passengers.filter(p => p.type === 'infant').length;

    const adultTotal = adultCount * sharingPrice;
    const childTotal = childCount * (pkg.childWithoutBedPrice || 0);
    const infantTotal = infantCount * (pkg.infantPrice || 0);
    const totalAmount = adultTotal + childTotal + infantTotal;

    // Create booking
    const booking = await UmrahBooking.create({
        package: packageId,
        user: req.user._id,
        passengers: passengers.map(p => ({
            ...p,
            dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : undefined
        })),
        roomType: roomType || 'quad',
        pricing: {
            basePrice: pkg.perPersonPrice,
            sharingPrice: sharingPrice,
            totalAmount: totalAmount,
            currency: pkg.currency || 'PKR'
        },
        customerDetails: {
            name: customerDetails?.name || req.user.name,
            email: customerDetails?.email || req.user.email,
            phone: customerDetails?.phone || req.user.phone || '',
            address: customerDetails?.address || '',
            cnic: customerDetails?.cnic || '',
            passportNumber: customerDetails?.passportNumber || ''
        },
        specialRequests: specialRequests || '',
        status: 'pending',
        paymentStatus: 'unpaid'
    });

    // Notify admins
    const admins = await User.find({ role: 'admin' }).select('_id');
    if (admins.length > 0) {
        await Notification.insertMany(admins.map(admin => ({
            user: admin._id,
            title: 'New Umrah Booking',
            message: `New Umrah booking ${booking.bookingReference} created by ${customerDetails?.name || req.user.name}`,
            type: 'booking',
            priority: 'high',
            relatedBooking: booking._id,
            link: `/admin/umrah/bookings/${booking._id}`
        })));
    }

    res.status(201).json({ success: true, data: booking });
});

/**
 * GET /api/umrah/bookings
 * Get user's Umrah bookings (or all for admin)
 */
exports.getBookings = catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.user.role !== 'admin') {
        filter.user = req.user._id;
    }
    if (req.query.status) filter.status = req.query.status;
    if (req.query.packageId) filter.package = req.query.packageId;

    const [bookings, total] = await Promise.all([
        UmrahBooking.find(filter)
            .populate('package', 'packageName airline flightNumber origin destination departureDate')
            .populate('user', 'name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),
        UmrahBooking.countDocuments(filter)
    ]);

    res.status(200).json({
        success: true,
        count: bookings.length,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1
        },
        data: bookings
    });
});

/**
 * GET /api/umrah/bookings/:id
 * Get single Umrah booking
 */
exports.getBooking = catchAsync(async (req, res) => {
    const booking = await UmrahBooking.findById(req.params.id)
        .populate('package', 'packageName airline flightNumber origin destination departureDate returnDate')
        .populate('user', 'name email phone');

    if (!booking) throw AppError.notFound('Booking not found');

    // Check authorization
    const isOwner = String(booking.user._id) === String(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
        throw AppError.forbidden('You do not have permission to view this booking');
    }

    res.status(200).json({ success: true, data: booking });
});

/**
 * PATCH /api/umrah/bookings/:id/cancel
 * Cancel an Umrah booking
 */
exports.cancelBooking = catchAsync(async (req, res) => {
    const booking = await UmrahBooking.findById(req.params.id).populate('package');
    if (!booking) throw AppError.notFound('Booking not found');

    const isOwner = String(booking.user) === String(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
        throw AppError.forbidden('You do not have permission to cancel this booking');
    }

    if (booking.status === 'cancelled') {
        throw AppError.conflict('This booking is already cancelled');
    }

    booking.status = 'cancelled';
    booking.paymentStatus = 'refunded';
    booking.cancellation = {
        cancelledAt: new Date(),
        cancelledBy: req.user._id,
        reason: req.body.reason || 'Cancelled by user',
        refundAmount: booking.pricing.totalAmount
    };
    await booking.save();

    res.status(200).json({ success: true, data: booking });
});

/**
 * PATCH /api/umrah/bookings/:id/status
 * Update booking status (admin only)
 */
exports.updateBookingStatus = catchAsync(async (req, res) => {
    const { status } = req.body;
    const booking = await UmrahBooking.findById(req.params.id);
    if (!booking) throw AppError.notFound('Booking not found');

    const allowedStatuses = ['pending', 'confirmed', 'completed'];
    if (!allowedStatuses.includes(status)) {
        throw AppError.badRequest(`Status must be one of: ${allowedStatuses.join(', ')}`);
    }

    booking.status = status;
    if (status === 'confirmed') {
        booking.paymentStatus = 'paid';
    }
    booking.statusHistory = booking.statusHistory || [];
    booking.statusHistory.push({
        status,
        date: new Date(),
        note: `Status changed to ${status} by admin`,
        updatedBy: req.user._id
    });
    await booking.save();

    res.status(200).json({ success: true, data: booking });
});

// ============================================
// HOTEL CONTROLLERS
// ============================================

/**
 * GET /api/umrah/hotels
 * Get hotels by city
 */
exports.getHotels = catchAsync(async (req, res) => {
    const filter = { isActive: true };
    if (req.query.city) filter.city = req.query.city;

    const hotels = await Hotel.find(filter)
        .sort({ rating: -1, name: 1 });

    res.status(200).json({ success: true, data: hotels });
});

/**
 * POST /api/umrah/hotels
 * Create a hotel (admin only)
 */
exports.createHotel = catchAsync(async (req, res) => {
    const hotel = await Hotel.create({
        ...req.body,
        createdBy: req.user._id
    });
    res.status(201).json({ success: true, data: hotel });
});

/**
 * PUT /api/umrah/hotels/:id
 * Update a hotel (admin only)
 */
exports.updateHotel = catchAsync(async (req, res) => {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) throw AppError.notFound('Hotel not found');

    Object.assign(hotel, req.body);
    await hotel.save();

    res.status(200).json({ success: true, data: hotel });
});

/**
 * DELETE /api/umrah/hotels/:id
 * Delete a hotel (admin only)
 */
exports.deleteHotel = catchAsync(async (req, res) => {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) throw AppError.notFound('Hotel not found');

    await hotel.deleteOne();
    res.status(200).json({ success: true, softDeleted: false, data: {} });
});