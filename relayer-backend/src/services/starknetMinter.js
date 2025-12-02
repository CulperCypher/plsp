import { exec } from 'child_process';
import { promisify } from 'util';
import { RpcProvider, Contract } from 'starknet';
import { starknetConfig } from '../config/starknetConfig.js';
import { config } from '../config/config.js';
import { priceOracle } from './priceOracle.js';

const execAsync = promisify(exec);

// Minimal ABI matching frontend usage (get_stats includes exchange rate)
const SPSTRK_ABI = [
  {
    name: 'get_stats',
    type: 'function',
    inputs: [],
    outputs: [{
      type: '(core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u16, core::integer::u16)'
    }],
    state_mutability: 'view'
  }
];

const u256ToBigInt = (value) => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') return BigInt(value);
  if (value && typeof value === 'object' && 'low' in value && 'high' in value) {
    const low = BigInt(value.low);
    const high = BigInt(value.high);
    return (high << 128n) + low;
  }
  throw new Error('Unable to parse u256 value');
};

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
   * Get current exchange rate via get_stats (matches frontend logic)
   * Returns STRK wei needed for 1 spSTRK
   */
  async getExchangeRate() {
    const KNOWN_RATE = BigInt('1176638000000000000'); // 1.176638e18 fallback

    try {
      const spSTRKAddress = starknetConfig.spSTRKContractAddress;
      const rpcUrl = starknetConfig.rpcUrl || 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/LOIuv6FM2_iaC8ZCb1Omu';

      const provider = new RpcProvider({ nodeUrl: rpcUrl });
      const contract = new Contract({ abi: SPSTRK_ABI, address: spSTRKAddress, providerOrAccount: provider });

      const stats = await contract.get_stats();
      const exchangeRate = u256ToBigInt(stats[2]);

      console.log(`   ✅ Exchange rate from get_stats: ${Number(exchangeRate) / 1e18} STRK per spSTRK`);
      return exchangeRate;
    } catch (error) {
      console.warn('   ⚠️ Error fetching exchange rate via get_stats:', error.message);
      console.log(`   📊 Using known rate: 1.176638`);
      return KNOWN_RATE;
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

      // Get current exchange rate from contract
      const exchangeRate = await this.getExchangeRate();
      console.log(`   📊 Exchange rate: ${Number(exchangeRate) / 1e18} STRK per spSTRK`);

      // Calculate exact STRK needed for 10 spSTRK (no buffer - contract handles tolerance)
      const strkNeededExact = (PRIVACY_DENOMINATION * exchangeRate) / BigInt('1000000000000000000');
      console.log(`   💰 STRK needed for 10 spSTRK: ${Number(strkNeededExact) / 1e18} STRK`);

      // Convert ZEC to STRK
      const strkFromZec = await priceOracle.convertZatoshisToSTRK(transaction.amountZat);
      const convertedAmount = BigInt(strkFromZec);
      console.log(`   💰 STRK from ZEC: ${Number(convertedAmount) / 1e18} STRK`);

      // Verify user sent enough ZEC (exact amount needed, contract has 5% overpay tolerance)
      if (convertedAmount < strkNeededExact) {
        throw new Error(`Insufficient ZEC: got ${Number(convertedAmount) / 1e18} STRK, need ${Number(strkNeededExact) / 1e18} STRK for 10 spSTRK`);
      }

      // Check not overpaying too much (max 5% over what contract allows)
      const maxAllowed = (strkNeededExact * 105n) / 100n;
      if (convertedAmount > maxAllowed) {
        console.warn(`   ⚠️ User overpaid: got ${Number(convertedAmount) / 1e18} STRK, only need ${Number(strkNeededExact) / 1e18} STRK`);
        // Still proceed but warn - extra goes to pool
      }

      // Add 2% buffer to amount we send to avoid decimal edge cases
      // Contract accepts up to 5% overpay, so 2% buffer is safe
      const amount = (strkNeededExact * 102n) / 100n;
      console.log(`   📤 Sending with 2% buffer: ${Number(amount) / 1e18} STRK`);
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