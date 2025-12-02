import { RpcProvider, Contract } from 'starknet';
import { priceOracle } from '../src/services/priceOracle.js';
import { starknetConfig } from '../src/config/starknetConfig.js';

// Minimal ABI for get_exchange_rate
const SPSTRK_ABI = [
  {
    name: 'get_exchange_rate',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view'
  }
];

const usage = () => {
  console.log('Usage: node scripts/calcRequiredZec.js [--private | <strkAmount>]');
  console.log('');
  console.log('Options:');
  console.log('  --private      Calculate ZEC for PRIVATE stake (fixed 10 spSTRK denomination)');
  console.log('  <strkAmount>   Calculate ZEC for PUBLIC stake (any amount)');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/calcRequiredZec.js --private   # Private: 10 spSTRK note');
  console.log('  node scripts/calcRequiredZec.js 50          # Public: 50 STRK worth');
};

/**
 * Fetch exchange rate from spSTRK contract via starknet.js
 */
async function getExchangeRate() {
  try {
    const spSTRKAddress = starknetConfig.spSTRKContractAddress;
    const rpcUrl = starknetConfig.rpcUrl || 'https://starknet-sepolia.public.blastapi.io';
    
    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    const contract = new Contract({ abi: SPSTRK_ABI, address: spSTRKAddress, providerOrAccount: provider });
    
    const result = await contract.get_exchange_rate();
    
    // Result is a u256 (could be BigInt or object with low/high)
    let rate;
    if (typeof result === 'bigint') {
      rate = Number(result) / 1e18;
    } else if (result.low !== undefined) {
      rate = Number(BigInt(result.low) + (BigInt(result.high || 0) << 128n)) / 1e18;
    } else {
      rate = Number(BigInt(result)) / 1e18;
    }
    
    console.log(`   ✅ Got exchange rate from RPC: ${rate.toFixed(6)}`);
    return rate;
  } catch (error) {
    console.warn('   ⚠️ Error fetching exchange rate:', error.message);
    return 1.0; // Fallback to 1:1 rate (safer)
  }
}

async function main() {
  const [, , arg] = process.argv;

  if (!arg) {
    usage();
    process.exit(1);
  }

  const isPrivate = arg === '--private';
  let strkAmount;
  let mode;

  if (isPrivate) {
    // PRIVATE: Fixed 10 spSTRK denomination
    console.log('\n📊 Fetching exchange rate from spSTRK contract...');
    const exchangeRate = await getExchangeRate();
    // Calculate STRK needed for 10 spSTRK (with 2% buffer)
    strkAmount = 10 * exchangeRate * 1.02;
    mode = 'PRIVATE (10 spSTRK note)';
    console.log(`   Exchange rate: ${exchangeRate.toFixed(6)} STRK per spSTRK`);
  } else {
    // PUBLIC: User-specified amount
    strkAmount = Number(arg);
    if (Number.isNaN(strkAmount) || strkAmount <= 0) {
      console.error('Please provide a positive numeric STRK amount or --private.');
      process.exit(1);
    }
    mode = 'PUBLIC (direct STRK)';
  }

  const targetStrkWei = BigInt(Math.floor(strkAmount * 1e18));

  const [strkPrice, zecPrice] = await Promise.all([
    priceOracle.getSTRKPrice(),
    priceOracle.getZECPrice(),
  ]);

  const usdValue = strkAmount * strkPrice;
  const requiredZec = usdValue / zecPrice;
  const zatoshis = Math.round(requiredZec * 1e8);

  console.log(`\n📐 Bridge Conversion Helper (${mode})`);
  console.log('------------------------------------------------');
  console.log(`Target STRK: ${strkAmount.toFixed(4)} STRK`);
  console.log(`Target STRK (wei): ${targetStrkWei.toString()}`);
  console.log(`STRK/USD: $${strkPrice}`);
  console.log(`ZEC/USD: $${zecPrice}`);
  console.log(`Required ZEC: ${requiredZec.toFixed(8)} ZEC`);
  console.log(`Required ZEC (zatoshis): ${zatoshis}`);
  
  if (isPrivate) {
    console.log('\nMemo format: 02:<commitment>');
  } else {
    console.log('\nMemo format: 01:<your-starknet-address>');
  }
}

main().catch((err) => {
  console.error('Error computing required ZEC:', err.message);
  process.exit(1);
});
