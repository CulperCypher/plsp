import { execSync } from 'child_process';
import { priceOracle } from '../src/services/priceOracle.js';
import { starknetConfig } from '../src/config/starknetConfig.js';
import { config } from '../src/config/config.js';

const usage = () => {
  console.log('Usage: node scripts/privateBridgeSend.js --commitment <poseidon> [--from <zaddr>] [--send] [--datadir <path>] [--fee <float>]');
  console.log('');
  console.log('FIXED DENOMINATION: All private bridge deposits create a 10 spSTRK note.');
  console.log('The script automatically calculates the ZEC needed based on current exchange rate.');
  console.log('');
  console.log('Example (dry run): node scripts/privateBridgeSend.js --commitment 123...');
  console.log('Example (auto send): node scripts/privateBridgeSend.js --commitment 123... --from utest1... --send');
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    send: false,
    from: process.env.ZCASH_FROM_ADDRESS || process.env.SENDING_WALLET_ADDRESS,
    datadir: process.env.ZCASH_DATADIR,
    fee: process.env.ZCASH_FEE,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--commitment':
        opts.commitment = args[++i];
        break;
      case '--from':
        opts.from = args[++i];
        break;
      case '--datadir':
        opts.datadir = args[++i];
        break;
      case '--fee':
        opts.fee = args[++i];
        break;
      case '--send':
        opts.send = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
        process.exit(1);
    }
  }
  return opts;
};

const toZecString = (zatoshis) => {
  return (Number(zatoshis) / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0';
};

/**
 * Fetch exchange rate from spSTRK contract via RPC
 */
async function getExchangeRate() {
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
      const rate = Number(low + (high << 128n)) / 1e18;
      console.log(`   ✅ Got exchange rate from RPC: ${rate.toFixed(6)}`);
      return rate;
    }
    
    console.warn('   ⚠️ Could not parse exchange rate from RPC, using fallback 1.17');
    return 1.17; // Fallback to approximate current rate
  } catch (error) {
    console.warn('   ⚠️ Error fetching exchange rate:', error.message);
    return 1.17; // Fallback to approximate current rate
  }
}

async function main() {
  const opts = parseArgs();

  if (!opts.commitment) {
    usage();
    process.exit(1);
  }

  if (opts.send && !opts.from) {
    console.error('Missing --from <zaddr> (or ZCASH_FROM_ADDRESS env) for auto-send.');
    process.exit(1);
  }

  const commitment = opts.commitment.trim();

  // FIXED DENOMINATION: 10 spSTRK
  const PRIVACY_DENOMINATION = 10;
  
  // Get exchange rate from contract
  console.log('\n📊 Fetching exchange rate from spSTRK contract...');
  const exchangeRate = await getExchangeRate();
  
  // Calculate STRK needed for 10 spSTRK (with 2% buffer to match relayer)
  const strkNeeded = PRIVACY_DENOMINATION * exchangeRate * 1.02;
  
  console.log(`   Exchange rate: ${exchangeRate.toFixed(6)} STRK per spSTRK`);
  console.log(`   STRK needed for ${PRIVACY_DENOMINATION} spSTRK: ${strkNeeded.toFixed(4)} STRK`);

  const [strkPrice, zecPrice] = await Promise.all([
    priceOracle.getSTRKPrice(),
    priceOracle.getZECPrice(),
  ]);

  const usdValue = strkNeeded * strkPrice;
  const requiredZec = usdValue / zecPrice;
  const zatoshis = Math.round(requiredZec * 1e8);
  const zecAmountStr = toZecString(zatoshis);

  // Simplified memo format: just action:commitment (no amount needed)
  const memo = `02:${commitment}`;
  const memoHex = Buffer.from(memo, 'utf8').toString('hex');

  console.log('\n📐 Bridge Quote (FIXED 10 spSTRK DENOMINATION)');
  console.log('------------------------------------------------');
  console.log(`Exchange rate: ${exchangeRate.toFixed(6)} STRK/spSTRK`);
  console.log(`Target: 10 spSTRK note`);
  console.log(`STRK needed: ${strkNeeded.toFixed(4)} STRK`);
  console.log(`STRK/USD: $${strkPrice}`);
  console.log(`ZEC/USD: $${zecPrice}`);
  console.log(`Required ZEC: ${zecAmountStr} ZEC`);
  console.log(`Required ZEC (zatoshis): ${zatoshis}`);
  console.log(`Memo: ${memo}`);
  console.log(`Memo hex: ${memoHex}`);
  console.log('\nRun the following command to send manually:');
  const resolvedDatadir = opts.datadir || process.env.ZCASH_DATADIR || '/root/zcash-data';
  const resolvedFrom = opts.from || process.env.ZCASH_FROM_ADDRESS || process.env.SENDING_WALLET_ADDRESS || '<FROM_ZADDR>';
  const manualCmd = `${process.env.ZCASH_CLI || 'zcash-cli'} -datadir=${resolvedDatadir} z_sendmany "${resolvedFrom}" '[{"address":"${config.zcash.bridgeVaultAddress}","amount":${zecAmountStr},"memo":"${memoHex}"}]' 1 ${opts.fee || '0.0001'}`;
  console.log(manualCmd);

  if (!opts.send) {
    console.log('\nAdd --send --from <zaddr> to execute automatically.');
    return;
  }

  const fee = opts.fee || '0.0001';
  const datadirArg = `-datadir=${resolvedDatadir}`;
  const cli = process.env.ZCASH_CLI || 'zcash-cli';
  const command = `${cli} ${datadirArg} z_sendmany "${opts.from}" '[{"address":"${config.zcash.bridgeVaultAddress}","amount":${zecAmountStr},"memo":"${memoHex}"}]' 1 ${fee}`;

  console.log(`\n🚀 Executing send command...`);
  console.log(command);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error('\n❌ z_sendmany failed:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error generating bridge quote:', error.message);
  process.exit(1);
});
