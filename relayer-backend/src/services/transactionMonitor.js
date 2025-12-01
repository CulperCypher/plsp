import { zcashRpc } from "./zcashRpc.js";
import { config } from "../config/config.js";
import { parseMemo, isValidAddress } from "../utils/memoParser.js";
import { Transaction } from "../models/Transaction.js";
import { starknetMinter } from "./starknetMinter.js";

class TransactionMonitor {
  constructor() {
    this.isRunning = false;
    this.bridgeAddress = config.zcash.bridgeVaultAddress;
    this.requiredConfirmations = config.polling.requiredConfirmations;
  }

  async start() {
    console.log("🚀 Starting transaction monitor...");
    console.log(`📍 Monitoring address: ${this.bridgeAddress}`);
    console.log(
      `⏱️  Polling every ${config.polling.intervalMs / 1000} seconds`
    );
    console.log(`✅ Required confirmations: ${this.requiredConfirmations}`);

    this.isRunning = true;
    this.poll();
  }

  async poll() {
    if (!this.isRunning) return;

    try {
      await this.checkForNewTransactions();
      await this.updatePendingTransactions();
    } catch (error) {
      console.error("❌ Error during polling:", error.message);
    }

    // Schedule next poll
    setTimeout(() => this.poll(), config.polling.intervalMs);
  }

  async checkForNewTransactions() {
    try {
      // Get all received transactions for bridge address
      const receivedTxs = await zcashRpc.listReceivedByAddress(
        this.bridgeAddress,
        1
      );

      console.log(`📥 Found ${receivedTxs.length} total transactions`);

      for (const tx of receivedTxs) {
        // Check if we've already processed this transaction
        const existingTx = await Transaction.findOne({ txid: tx.txid });

        if (existingTx) {
          continue; // Already in database
        }

        // Parse memo using unified parser
        const memoData = parseMemo(tx.memo);
        
        if (!memoData) {
          console.log(`⚠️  Skipping tx ${tx.txid}: Invalid memo format`);
          continue;
        }

        // Validate address for non-private actions
        if (memoData.action !== '02' && !isValidAddress(memoData.address)) {
          console.log(`⚠️  Skipping tx ${tx.txid}: Invalid address`);
          continue;
        }

        // Save new transaction to database
        const newTx = new Transaction({
          txid: tx.txid,
          amount: tx.amount,
          amountZat: tx.amountZat,
          destinationAddress: memoData.address || undefined,
          action: memoData.action,
          memo: tx.memo,
          confirmations: tx.confirmations,
          blockHeight: tx.blockheight,
          status: "pending",
          commitment: memoData.commitment || undefined,
        });

        await newTx.save();

        console.log(`\n✨ New transaction detected!`);
        console.log(`   TXID: ${tx.txid}`);
        console.log(`   Amount: ${tx.amount} ZEC`);
        
        const actionLabels = { '00': 'MINT wTAZ', '01': 'PUBLIC STAKE', '02': 'PRIVATE STAKE' };
        console.log(`   Action: ${actionLabels[memoData.action] || memoData.action}`);
        
        if (memoData.address) {
          console.log(`   Destination: ${memoData.address}`);
        }
        if (memoData.commitment) {
          console.log(`   Commitment: ${memoData.commitment}`);
        }
        console.log(`   Confirmations: ${tx.confirmations}/${this.requiredConfirmations}`);
      }
    } catch (error) {
      console.error("Error checking new transactions:", error.message);
    }
  }

  async updatePendingTransactions() {
    try {
      // Get all pending or confirmed transactions (not yet minted)
      const pendingTxs = await Transaction.find({
        status: { $in: ["pending", "confirmed"] },
      });

      for (const tx of pendingTxs) {
        // Get fresh transaction data from Zcash
        const receivedTxs = await zcashRpc.listReceivedByAddress(
          this.bridgeAddress,
          1
        );
        const freshTx = receivedTxs.find((t) => t.txid === tx.txid);

        if (!freshTx) continue;

        // Update confirmations
        tx.confirmations = freshTx.confirmations;

        // Check if we have enough confirmations
        if (
          freshTx.confirmations >= this.requiredConfirmations &&
          tx.status === "pending"
        ) {
          tx.status = "confirmed";
          await tx.save();

          console.log(`\n✅ Transaction confirmed!`);
          console.log(`   TXID: ${tx.txid}`);
          console.log(`   Amount: ${tx.amount} ZEC`);
          console.log(`   Destination: ${tx.destinationAddress}`);
          console.log(`   Ready to mint on Starknet!`);

          // TODO: Call Starknet minting service here
          await this.mintOnStarknet(tx);
        } else {
          await tx.save();
        }
      }
    } catch (error) {
      console.error("Error updating pending transactions:", error.message);
    }
  }

  async mintOnStarknet(transaction) {
    try {
      const action = transaction.action || "00";

      if (action === "00") {
        // MINT wTAZ flow
        console.log(`\n🎨 Processing MINT wTAZ request...`);
        console.log(`   Amount: ${transaction.amount} ZEC → wTAZ`);
        console.log(`   User: ${transaction.destinationAddress}`);

        const txHash = await starknetMinter.mint(
          transaction.destinationAddress,
          transaction.amountZat
        );

        transaction.status = "minted";
        transaction.mintTxHash = txHash;
        await transaction.save();

        console.log(`   ✅ Successfully minted wTAZ!`);
        console.log(`   Starknet TX: ${txHash}`);
      } else if (action === "01") {
        // PUBLIC STAKE flow - Convert ZEC to STRK and stake into spSTRK
        console.log(`\n🥩 Processing PUBLIC STAKE request...`);
        console.log(`   Amount: ${transaction.amount} ZEC → STRK → spSTRK`);
        console.log(`   User: ${transaction.destinationAddress}`);

        const txHash = await starknetMinter.stakeForUser(
          transaction.destinationAddress,
          transaction.amountZat
        );

        transaction.status = "staked";
        transaction.mintTxHash = txHash;
        await transaction.save();

        console.log(`   ✅ Successfully staked into spSTRK!`);
        console.log(`   Starknet TX: ${txHash}`);
      } else if (action === "02") {
        // PRIVATE STAKE flow - Fixed 10 spSTRK denomination
        console.log(`\n🕶️ Processing PRIVATE STAKE request (10 spSTRK)...`);
        console.log(`   Commitment: ${transaction.commitment}`);

        const txHash = await starknetMinter.stakePrivateCommitment(transaction);

        transaction.status = "private_staked";
        transaction.mintTxHash = txHash;
        await transaction.save();

        console.log(`   ✅ Private commitment stored on Starknet!`);
        console.log(`   Starknet TX: ${txHash}`);
      } else {
        throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      console.error(`   ❌ Failed:`, error.message);
      transaction.status = "failed";
      await transaction.save();
      throw error;
    }
  }
  stop() {
    console.log("🛑 Stopping transaction monitor...");
    this.isRunning = false;
  }
}

const transactionMonitor = new TransactionMonitor();
export { transactionMonitor };
