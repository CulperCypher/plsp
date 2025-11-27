import axios from 'axios';
import { config } from '../config/config.js';

class ZcashRPC {
  constructor() {
    this.rpcUrl = config.zcash.rpcUrl;
    this.auth = {
      username: config.zcash.rpcUser,
      password: config.zcash.rpcPassword,
    };
  }

  async call(method, params = []) {
    try {
      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '1.0',
          id: 'zcash-bridge',
          method: method,
          params: params,
        },
        {
          auth: this.auth,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return response.data.result;
    } catch (error) {
      console.error(`Error calling RPC method ${method}:`, error.message);
      throw error;
    }
  }

  // Get blockchain info
  async getBlockchainInfo() {
    return await this.call('getblockchaininfo');
  }

  // List received transactions by address
  async listReceivedByAddress(address, minConfirmations = 1) {
    return await this.call('z_listreceivedbyaddress', [address, minConfirmations]);
  }

  // Get transaction details
  async getTransaction(txid) {
    return await this.call('gettransaction', [txid]);
  }
}

export const zcashRpc = new ZcashRPC();