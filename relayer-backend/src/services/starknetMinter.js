import { exec } from 'child_process';
import { promisify } from 'util';
import { starknetConfig } from '../config/starknetConfig.js';
import { config } from '../config/config.js';
import { priceOracle } from './priceOracle.js';

const execAsync = promisify(exec);

const ensureHexPrefix = (hash) => (hash.startsWith('0x') ? hash : `0x${hash}`);

const parseTxHashFromOutput = (stdout = '', stderr = '') => {
  const combined = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
  if (!combined) return null;

  const jsonMatch = combined.match(/"transaction_hash"\s*:\s*"?(0x[a-fA-F0-9]+)/i);
  if (jsonMatch) {
    return ensureHexPrefix(jsonMatch[1]);
  }

  const patterns = [
    /transaction_hash\s*[:=]\s*(0x[a-fA-F0-9]+)/i,
    /Transaction Hash:\s*(0x[a-fA-F0-9]+)/i,
    /tx\/([a-fA-F0-9]{64})/,
    /(0x[a-fA-F0-9]{64})/, // fallback to first 0x hash-looking string
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) {
      const hash = match[1].startsWith('0x') ? match[1] : `0x${match[1]}`;
      return hash;
    }
  }

  return null;
};

class StarknetMinter {
  /**
   * Stake STRK and send spSTRK to user
   * @param {string} userAddress - User's Starknet address from memo
   * @param {number} zatoshis - Amount of TAZ locked in zatoshis
   */
  async stakeForUser(userAddress, zatoshis) {
  try {
    console.log(`\n🥩 Staking flow for user...`);
    console.log(`   User: ${userAddress}`);
    console.log(`   TAZ Locked: ${zatoshis / 1e8} TAZ`);

    // Step 1: Convert TAZ to STRK using real exchange rates
    const strkWei = await priceOracle.convertZatoshisToSTRK(zatoshis);
    const strkWeiBigInt = BigInt(strkWei);
    
    const gasReserve = strkWeiBigInt / 10n;
    const amountToStake = strkWeiBigInt - gasReserve;
    
    console.log(`   💰 Total STRK: ${Number(strkWeiBigInt) / 1e18} STRK`);
    console.log(`   💰 Staking: ${Number(amountToStake) / 1e18} STRK`);
    console.log(`   💰 Gas reserve: ${Number(gasReserve) / 1e18} STRK`);
    
    const strkLow = amountToStake % (2n ** 128n);
    const strkHigh = amountToStake / (2n ** 128n);

    const backendAddress = starknetConfig.backendAccountAddress;
    const spSTRKAddress = starknetConfig.spSTRKContractAddress;
    const strkTokenAddress = starknetConfig.strkTokenAddress;

    console.log(`\n   📍 Step 1/3: Approve STRK to spSTRK contract...`);
    
    // Approve STRK to spSTRK contract
    const approveCmd = `sncast \
      --account backend_relayer \
      invoke \
      --network sepolia \
      --contract-address ${strkTokenAddress} \
      --function approve \
      --calldata ${spSTRKAddress} ${strkLow} ${strkHigh}`;

    await execAsync(approveCmd);
    console.log(`   ✅ STRK approved`);

    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log(`\n   📍 Step 2/3: Stake STRK (backend receives spSTRK)...`);
    
    // Call stake() - spSTRK goes to backend wallet
    const stakeCmd = `sncast \
      --account backend_relayer \
      invoke \
      --network sepolia \
      --contract-address ${spSTRKAddress} \
      --function stake \
      --calldata ${strkLow} ${strkHigh} 0 0`;

    const { stdout: stakeStdout, stderr: stakeStderr } = await execAsync(stakeCmd);
    console.log(`   ✅ Staked! Backend received spSTRK`);

    const stakeTxHash = parseTxHashFromOutput(stakeStdout, stakeStderr);

    console.log(`   Stake TX: https://sepolia.starkscan.co/tx/${stakeTxHash}`);

    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log(`\n   📍 Step 3/3: Transfer spSTRK to user...`);

    // Transfer spSTRK from backend to user
    const transferCmd = `sncast \
      --account backend_relayer \
      invoke \
      --network sepolia \
      --contract-address ${spSTRKAddress} \
      --function transfer \
      --calldata ${userAddress} ${strkLow} ${strkHigh}`;

    const { stdout: transferStdout, stderr: transferStderr } = await execAsync(transferCmd);
    console.log(`   ✅ spSTRK transferred to user!`);

    const transferTxHash = parseTxHashFromOutput(transferStdout, transferStderr);

    console.log(`\n✅ COMPLETE! User received spSTRK`);
    console.log(`   User got: ${Number(amountToStake) / 1e18} spSTRK`);
    console.log(`   Stake TX: https://sepolia.starkscan.co/tx/${stakeTxHash}`);
    console.log(`   Transfer TX: https://sepolia.starkscan.co/tx/${transferTxHash}`);

    return transferTxHash;
  } catch (error) {
    console.error(`   ❌ Error in stake flow:`, error.message);
    throw error;
  }
}

  /**
   * Get current exchange rate from spSTRK contract via RPC
   * Returns STRK wei needed for 1 spSTRK
   */
  async getExchangeRate() {
    try {
      const spSTRKAddress = starknetConfig.spSTRKContractAddress;
      const rpcUrl = starknetConfig.rpcUrl || 'https://starknet-sepolia.public.blastapi.io';
      
      // Call get_exchange_rate via Starknet RPC
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'starknet_call',
          params: {
            request: {
              contract_address: spSTRKAddress,
              entry_point_selector: '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e', // get_exchange_rate
              calldata: []
            },
            block_id: 'latest'
          },
          id: 1
        })
      });
      
      const data = await response.json();
      
      if (data.result && data.result.length >= 2) {
        const low = BigInt(data.result[0]);
        const high = BigInt(data.result[1]);
        return low + (high << 128n);
      }
      
      // Fallback to approximate current rate
      console.warn('   ⚠️ Could not parse exchange rate from RPC, using fallback 1.17');
      return BigInt('1170000000000000000'); // 1.17e18
    } catch (error) {
      console.warn('   ⚠️ Error fetching exchange rate:', error.message);
      return BigInt('1170000000000000000'); // 1.17e18 fallback
    }
  }

  async stakePrivateCommitment(transaction) {
    try {
      console.log(`\n🕶️ Running private bridge stake (FIXED DENOMINATION: 10 spSTRK)...`);

      if (!transaction.commitment) {
        throw new Error('Missing commitment for private stake');
      }

      // FIXED DENOMINATION: Always 10 spSTRK
      const PRIVACY_DENOMINATION = BigInt('10000000000000000000'); // 10 * 10^18
      const MAX_OVERPAY_BPS = 500n; // 5% max overpay

      // Get current exchange rate from contract
      const exchangeRate = await this.getExchangeRate();
      console.log(`   📊 Exchange rate: ${Number(exchangeRate) / 1e18} STRK per spSTRK`);

      // Calculate exact STRK needed for 10 spSTRK (with 2% buffer)
      const strkNeeded = (PRIVACY_DENOMINATION * exchangeRate * 102n) / (BigInt('1000000000000000000') * 100n);
      console.log(`   💰 STRK needed for 10 spSTRK: ${Number(strkNeeded) / 1e18} STRK`);

      // Convert ZEC to STRK
      const strkFromZec = await priceOracle.convertZatoshisToSTRK(transaction.amountZat);
      const convertedAmount = BigInt(strkFromZec);
      console.log(`   💰 STRK from ZEC: ${Number(convertedAmount) / 1e18} STRK`);

      // Verify user sent enough ZEC
      if (convertedAmount < strkNeeded) {
        throw new Error(`Insufficient ZEC: got ${Number(convertedAmount) / 1e18} STRK, need ${Number(strkNeeded) / 1e18} STRK for 10 spSTRK`);
      }

      // Check not overpaying too much (max 5% over)
      const maxAllowed = strkNeeded + (strkNeeded * MAX_OVERPAY_BPS / 10000n);
      if (convertedAmount > maxAllowed) {
        console.warn(`   ⚠️ User overpaid: got ${Number(convertedAmount) / 1e18} STRK, only need ${Number(strkNeeded) / 1e18} STRK`);
        // Still proceed but warn - extra goes to pool
      }

      // Use calculated STRK amount (not declared amount from memo)
      const amount = strkNeeded;
      const commitment = BigInt(transaction.commitment);

      const strkLow = amount % (2n ** 128n);
      const strkHigh = amount / (2n ** 128n);

      const commitmentLow = commitment % (2n ** 128n);
      const commitmentHigh = commitment / (2n ** 128n);

      const spSTRKAddress = starknetConfig.spSTRKContractAddress;

      const command = `sncast \
        --account backend_relayer \
        invoke \
        --network sepolia \
        --contract-address ${spSTRKAddress} \
        --function stake_from_bridge_private \
        --calldata ${strkLow} ${strkHigh} ${commitmentLow} ${commitmentHigh}`;

      console.log(`   🔧 Sending private stake invoke (${Number(amount) / 1e18} STRK → 10 spSTRK)...`);
      const { stdout, stderr } = await execAsync(command);

      const txHash = parseTxHashFromOutput(stdout, stderr);

      if (!txHash) {
        console.error('Raw sncast output:', stdout, stderr);
        throw new Error('Could not parse private stake transaction hash');
      }

      console.log(`   ✅ Bridge commitment submitted (10 spSTRK note created)`);
      console.log(`   Stake TX: https://sepolia.starkscan.co/tx/${txHash}`);

      return txHash;
    } catch (error) {
      console.error('   ❌ Error staking private commitment:', error.message);
      throw error;
    }
  }

  /**
   * Mint wTAZ (existing function for action '00')
   */
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
}

export const starknetMinter = new StarknetMinter();