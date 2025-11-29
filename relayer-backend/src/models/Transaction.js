import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  txid: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  amountZat: {
    type: Number,
    required: true,
  },
  destinationAddress: {
    type: String,
    required: true,
  },
  action: {                         
    type: String,
    enum: ['00', '01'],
    default: '00',
  },
  memo: {
    type: String,
    required: true,
  },
  confirmations: {
    type: Number,
    default: 0,
  },
  blockHeight: {
    type: Number,
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'minted', 'staked', 'failed'],
    default: 'pending',
  },
  mintTxHash: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
transactionSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

export const Transaction = mongoose.model('Transaction', transactionSchema);