import dotenv from 'dotenv';
dotenv.config();

export const config = {
  zcash: {
    rpcUrl: process.env.ZCASH_RPC_URL,
    rpcUser: process.env.ZCASH_RPC_USER,
    rpcPassword: process.env.ZCASH_RPC_PASSWORD,
    bridgeVaultAddress: process.env.BRIDGE_VAULT_ADDRESS,
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/zcash-bridge',
  },
  polling: {
    intervalMs: parseInt(process.env.POLL_INTERVAL_MS) || 30000,
    requiredConfirmations: parseInt(process.env.REQUIRED_CONFIRMATIONS) || 6,
  },
  server: {
    port: parseInt(process.env.PORT) || 3000,
  },
};