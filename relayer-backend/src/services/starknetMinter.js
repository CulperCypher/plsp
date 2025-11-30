import { exec } from 'child_process';
import { promisify } from 'util';
import { starknetConfig } from '../config/starknetConfig.js';
import { priceOracle } from './priceOracle.js';

const execAsync = promisify(exec);

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

    const { stdout: stakeOutput } = await execAsync(stakeCmd);
    console.log(`   ✅ Staked! Backend received spSTRK`);

    // Parse stake tx hash
    let stakeTxHash;
    const patterns = [
      /Transaction Hash:\s*(0x[a-fA-F0-9]+)/i,
      /transaction_hash:\s*(0x[a-fA-F0-9]+)/i,
      /tx\/([a-fA-F0-9]+)/,
    ];

    for (const pattern of patterns) {
      const match = stakeOutput.match(pattern);
      if (match) {
        stakeTxHash = match[1].startsWith('0x') ? match[1] : '0x' + match[1];
        break;
      }
    }

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

    const { stdout: transferOutput } = await execAsync(transferCmd);
    console.log(`   ✅ spSTRK transferred to user!`);

    // Parse transfer tx hash
    let transferTxHash;
    for (const pattern of patterns) {
      const match = transferOutput.match(pattern);
      if (match) {
        transferTxHash = match[1].startsWith('0x') ? match[1] : '0x' + match[1];
        break;
      }
    }

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