const mongoose = require('mongoose');

/**
 * Ledger entries are append-only.
 *
 * Financial records that can be edited in place cannot be audited: you lose
 * the ability to answer "what did we think the balance was on Tuesday". A
 * mistake is corrected by posting a reversing entry, never by editing the
 * original. The pre-hooks below enforce that at the model layer.
 */
const ledgerSchema = new mongoose.Schema(
  {
    entryNumber: { type: String, unique: true, uppercase: true, trim: true },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      index: true,
    },

    type: {
      type: String,
      enum: ['debit', 'credit'],
      required: true,
    },
    category: {
      type: String,
      enum: ['booking_payment', 'refund', 'cancellation_fee', 'service_fee', 'adjustment'],
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Amount must be greater than zero'],
    },
    currency: { type: String, default: 'PKR', uppercase: true, maxlength: 3 },

    // Running balance for this user immediately after the entry was posted.
    balanceAfter: { type: Number, required: true },

    description: { type: String, required: true, trim: true, maxlength: 300 },

    paymentMethod: {
      type: String,
      enum: ['card', 'bank_transfer', 'wallet', 'cash', 'system'],
      default: 'system',
    },
    // Reference from the payment processor. Never store raw card data here.
    transactionId: { type: String, trim: true, index: true, sparse: true },

    // Set on a correcting entry to point at the entry it reverses.
    reverses: { type: mongoose.Schema.Types.ObjectId, ref: 'Ledger' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

ledgerSchema.index({ user: 1, createdAt: -1 });

/** Sequential, human-readable entry number: LG-20260811-0001 */
ledgerSchema.pre('validate', async function assignEntryNumber(next) {
  if (this.entryNumber) return next();

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const countToday = await this.constructor.countDocuments({ createdAt: { $gte: startOfDay } });
  this.entryNumber = `LG-${stamp}-${String(countToday + 1).padStart(4, '0')}`;
  return next();
});

const blockMutation = function blockMutation(next) {
  next(new Error('Ledger entries are immutable. Post a reversing entry instead.'));
};

ledgerSchema.pre('save', function preventEdit(next) {
  if (!this.isNew) return blockMutation(next);
  return next();
});

ledgerSchema.pre('findOneAndUpdate', blockMutation);
ledgerSchema.pre('updateOne', blockMutation);
ledgerSchema.pre('updateMany', blockMutation);
ledgerSchema.pre('deleteOne', blockMutation);
ledgerSchema.pre('findOneAndDelete', blockMutation);

/** Current balance for a user, derived from entries rather than stored. */
ledgerSchema.statics.getBalance = async function getBalance(userId) {
  const [result] = await this.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)) } },
    {
      $group: {
        _id: null,
        balance: {
          $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }] },
        },
      },
    },
  ]);
  return result?.balance ?? 0;
};

module.exports = mongoose.model('Ledger', ledgerSchema);
