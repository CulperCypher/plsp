#!/usr/bin/env node
/**
 * Public Bridge Send Helper
 * Generates zcash-cli command for public stake (action 01)
 * ZEC -> STRK -> stake -> spSTRK sent to your wallet
 */

import 'dotenv/config';
import { RpcProvider, Contract } from 'starknet';

const SPSTRK_ADDRESS = process.env.SPSTRK_CONTRACT_ADDRESS || '0x05efc624f4f0afb75bd6a57b35a0d2fb270c6eb0cea0e3f7dc36aefe9681e509';
const RPC_URL = process.env.STARKNET_RPC_URL || 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/LOIuv6FM2_iaC8ZCb1Omu';

const BRIDGE_ADDRESS = 'utest1qp6yjdhx2srg4lkphwaacmgsw8amz5dtte3rx2v5nrp8r6wlq7tplchna7esw0lghnr46cwqj2pele2a0tf0fuws7pp2qu2vfrj4t0d4tueq5wcw56mw5mpwu0x6aqe67tjwt99erelah630qx2zefn2jvywgzrthth3lfhv8y2mfheheddcd8pqyrkl2ekacllqdzevy5xazk6hnh0';
const SOURCE_ADDRESS = 'utest1634pd4f7gxn4ajvyvgc4wf9r9e30n9yrk3fxlmfsm9um0j9mwftc06fsy4rxws096ktrsqety97hc03lk75mjn5d6ycwjmpqs43wfcrgctkm24rlpm3fwxznv835yfpdx47u5na63w4586kfvkhkqtuhdf85xpzntmxwqspxyag97qmnxklkzz4vy554a5czewsrq2pe9tgmysj83km';

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

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') return BigInt(value);
  if (value && typeof value === 'object' && 'low' in value && 'high' in value) {
    const low = BigInt(value.low);
    const high = BigInt(value.high);
    return (high << 128n) + low;
  }
  return BigInt(0);
}

async function getExchangeRate() {
  try {
    const provider = new RpcProvider({ nodeUrl: RPC_URL });
    const contract = new Contract(SPSTRK_ABI, SPSTRK_ADDRESS, provider);
    const stats = await contract.get_stats();
    const totalPooled = toBigInt(stats[0]);
    const totalSupply = toBigInt(stats[1]);
    if (totalSupply === 0n) return 1.0;
    return Number(totalPooled) / Number(totalSupply);
  } catch (error) {
    console.error('Error fetching exchange rate:', error.message);
    return 1.217; // Fallback
  }
}

async function getPrices() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=zcash,starknet&vs_currencies=usd');
    const data = await response.json();
    return {
      zecUsd: data.zcash?.usd || 350,
      strkUsd: data.starknet?.usd || 0.12
    };
  } catch {
    return { zecUsd: 350, strkUsd: 0.12 };
  }
}

function toZecString(zatoshis) {
  const zec = zatoshis / 1e8;
  return zec.toFixed(8);
}

async function main() {
  const args = process.argv.slice(2);
  let destinationAddress = null;
  let zecAmount = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--address' && args[i + 1]) {
      destinationAddress = args[i + 1];
      i++;
    } else if (args[i] === '--zec' && args[i + 1]) {
      zecAmount = parseFloat(args[i + 1]);
      i++;
    }
  }

  if (!destinationAddress) {
    console.log('Usage: node publicBridgeSend.js --address <starknet_address> [--zec <amount>]');
    console.log('');
    console.log('Example:');
    console.log('  node publicBridgeSend.js --address 0x073eb5658ce8291f795aad5584000dfc52aa197600b4df98568b4d480b9fdb65');
    console.log('  node publicBridgeSend.js --address 0x073eb... --zec 0.01');
    process.exit(1);
  }

  // Ensure address has 0x prefix
  if (!destinationAddress.startsWith('0x')) {
    destinationAddress = '0x' + destinationAddress;
  }

  console.log('\n📊 Fetching exchange rate from spSTRK contract...');
  const exchangeRate = await getExchangeRate();
  console.log(`   Exchange rate: ${exchangeRate.toFixed(6)} STRK per spSTRK`);

  const prices = await getPrices();
  console.log(`   💰 ZEC/USD: $${prices.zecUsd}`);
  console.log(`   💰 STRK/USD: $${prices.strkUsd}`);

  // Calculate ZEC needed if not specified
  let zatoshis;
  if (zecAmount) {
    zatoshis = Math.round(zecAmount * 1e8);
  } else {
    // Default: enough for ~10 spSTRK worth
    const strkNeeded = 10 * exchangeRate * 1.02; // 2% buffer
    const usdValue = strkNeeded * prices.strkUsd;
    const zecNeeded = usdValue / prices.zecUsd;
    zatoshis = Math.round(zecNeeded * 1e8);
  }

  const zecAmountStr = toZecString(zatoshis);

  // Calculate expected STRK output
  const usdFromZec = (zatoshis / 1e8) * prices.zecUsd;
  const expectedStrk = usdFromZec / prices.strkUsd;
  const expectedSpStrk = expectedStrk / exchangeRate;

  console.log('\n📐 Bridge Quote (PUBLIC STAKE)');
  console.log('------------------------------------------------');
  console.log(`Destination: ${destinationAddress}`);
  console.log(`ZEC amount: ${zecAmountStr} ZEC (~$${usdFromZec.toFixed(2)})`);
  console.log(`Expected STRK: ~${expectedStrk.toFixed(2)} STRK`);
  console.log(`Expected spSTRK: ~${expectedSpStrk.toFixed(2)} spSTRK`);

  // Create memo: 01:<address>
  const memo = `01:${destinationAddress}`;
  const memoHex = Buffer.from(memo, 'utf8').toString('hex');

  console.log(`\nMemo: ${memo}`);
  console.log(`Memo hex: ${memoHex}`);

  // Generate zcash-cli command
  const cmd = `zcash-cli -datadir=/root/zcash-data z_sendmany "${SOURCE_ADDRESS}" '[{"address":"${BRIDGE_ADDRESS}","amount":${zecAmountStr},"memo":"${memoHex}"}]' 1 0.0001`;

  console.log('\nRun the following command to send manually:');
  console.log(cmd);
  console.log('\nThe relayer will:');
  console.log('  1. Convert ZEC to STRK');
  console.log('  2. Stake STRK into spSTRK');
  console.log('  3. Send spSTRK to your address');
}

main().catch(console.error);
