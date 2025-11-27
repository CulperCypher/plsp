import { exec } from 'child_process';
import { promisify } from 'util';
import { starknetConfig } from '../config/starknetConfig.js';

const execAsync = promisify(exec);

class StarknetMinter {
  async mint(destinationAddress, amountZat) {
    try {
      console.log(`\n🎨 Minting wTAZ on Starknet...`);
      console.log(`   To: ${destinationAddress}`);
      console.log(`   Amount (zatoshis): ${amountZat}`);

      const command = `sncast \
        --account backend_relayer \
        invoke \
        --network sepolia \
        --contract-address ${starknetConfig.contractAddress} \
        --function mint \
        --calldata ${destinationAddress} ${amountZat} 0`;

      console.log(`   🔧 Executing via sncast...`);

      const { stdout } = await execAsync(command);

      // Parse transaction hash
      let txHash;
      const patterns = [
        /Transaction Hash:\s*(0x[a-fA-F0-9]+)/i,
        /transaction_hash:\s*(0x[a-fA-F0-9]+)/i,
        /tx\/([a-fA-F0-9]+)/,
      ];

      for (const pattern of patterns) {
        const match = stdout.match(pattern);
        if (match) {
          txHash = match[1].startsWith('0x') ? match[1] : '0x' + match[1];
          break;
        }
      }

      if (!txHash) {
        throw new Error('Could not parse transaction hash from sncast output');
      }

      console.log(`   ✅ Mint transaction sent!`);
      console.log(`   TX Hash: ${txHash}`);
      console.log(`   Explorer: https://sepolia.starkscan.co/tx/${txHash}`);
      console.log(`   💡 Transaction will be confirmed in 1-2 minutes`);

      return txHash;
    } catch (error) {
      console.error(`   ❌ Error minting on Starknet:`, error.message);
      throw error;
    }
  }

  async getBalance(address) {
    try {
      const command = `sncast \
        call \
        --network sepolia \
        --contract-address ${starknetConfig.contractAddress} \
        --function balance_of \
        --calldata ${address}`;

      const { stdout } = await execAsync(command);
      return stdout;
    } catch (error) {
      console.error('Error getting balance:', error.message);
      throw error;
    }
  }
}

export const starknetMinter = new StarknetMinter();