import express from 'express';
import dotenv from 'dotenv';
dotenv.config(); 
import mongoose from 'mongoose';
import { config } from './config/config.js';
import { transactionMonitor } from './services/transactionMonitor.js';
import { zcashRpc } from './services/zcashRpc.js';
import { Transaction } from './models/Transaction.js';

const app = express();
app.use(express.json());

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoose.connect(config.mongodb.uri);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// Test Zcash connection
async function testZcashConnection() {
  try {
    const info = await zcashRpc.getBlockchainInfo();
    console.log('✅ Connected to Zcash node');
    console.log(`   Chain: ${info.chain}`);
    console.log(`   Blocks: ${info.blocks}`);
    console.log(`   Sync: ${(info.verificationprogress * 100).toFixed(2)}%`);
  } catch (error) {
    console.error('❌ Zcash connection error:', error.message);
    process.exit(1);
  }
}

// API Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Zcash Bridge Relayer is running' });
});

app.get('/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, count: transactions.length, transactions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/transactions/:txid', async (req, res) => {
  try {
    const transaction = await Transaction.findOne({ txid: req.params.txid });
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }
    res.json({ success: true, transaction });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const total = await Transaction.countDocuments();
    const pending = await Transaction.countDocuments({ status: 'pending' });
    const confirmed = await Transaction.countDocuments({ status: 'confirmed' });
    const minted = await Transaction.countDocuments({ status: 'minted' });
    
    res.json({
      success: true,
      stats: { total, pending, confirmed, minted }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
async function start() {
  console.log('\n🌉 Zcash Bridge Relayer Starting...\n');
  
  // Connect to MongoDB
  await connectDB();
  
  // Test Zcash connection
  await testZcashConnection();
  
  // Start transaction monitor
  await transactionMonitor.start();
  
  // Start Express server
  app.listen(config.server.port, () => {
    console.log(`\n🚀 Server running on http://localhost:${config.server.port}`);
    console.log(`   Health: http://localhost:${config.server.port}/health`);
    console.log(`   Transactions: http://localhost:${config.server.port}/transactions`);
    console.log(`   Stats: http://localhost:${config.server.port}/stats\n`);
  });
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  transactionMonitor.stop();
  mongoose.connection.close();
  process.exit(0);
});

start();