# Merkle Indexer

Off-chain Merkle tree indexer for the spSTRK privacy system.

## Why This Exists

The Noir circuits use **BN254 Poseidon** for hashing, but Starknet/Cairo uses **STARK Poseidon**. These are different hash functions on different curves, so we cannot compute the Merkle tree on-chain.

This indexer:
1. Watches for `CommitmentCreated` events from the contract
2. Builds the Merkle tree using BN254 Poseidon (matching Noir circuits)
3. Provides Merkle paths for proof generation
4. Submits computed roots to the contract

## Decentralization

**The indexer is a convenience layer, not a trust layer.**

- All commitments are on-chain (emitted as events)
- Anyone can run their own indexer
- Anyone can reconstruct the tree from on-chain events
- Wrong roots = failed proofs (cryptographic guarantee)
- The indexer cannot steal funds or forge proofs

If the main indexer goes down, users can:
1. Run their own indexer
2. Query `CommitmentCreated` events directly
3. Rebuild the tree and compute their own Merkle paths

## Setup

```bash
npm install
cp .env.example .env  # Configure your settings
npm start
```

## Environment Variables

```env
RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/...
CONTRACT=0x05efc624f4f0afb75bd6a57b35a0d2fb270c6eb0cea0e3f7dc36aefe9681e509
START_BLOCK=500000
PORT=4000

# Optional: For automatic root submission
INDEXER_PRIVATE_KEY=0x...
INDEXER_ACCOUNT_ADDRESS=0x...
```

## API Endpoints

### GET /health
Health check with current state.

```json
{
  "status": "ok",
  "leaves": 5,
  "latestRoot": "1234567890..."
}
```

### GET /root
Get the latest computed Merkle root.

```json
{
  "root": "1234567890..."
}
```

### GET /path/:index
Get Merkle path by leaf index (for proof generation).

```json
{
  "leaf_index": 0,
  "commitment": "9876543210...",
  "siblings": ["0", "0", ...],  // 32 Field strings
  "root": "1234567890..."
}
```

### GET /path/commitment/:commitment
Get Merkle path by commitment hash.

### GET /pending-roots
Get roots that haven't been submitted to the contract yet.

### POST /submit-root
Submit a root to the contract.

If `INDEXER_PRIVATE_KEY` is not set, returns the calldata for manual submission:
```json
{
  "message": "No indexer account configured...",
  "root": "1234...",
  "calldata": { "low": "...", "high": "..." },
  "command": "starkli invoke 0x... submit_merkle_root ..."
}
```

### POST /submit-all-roots
Submit all pending roots to the contract (requires account configured).

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   User Deposit  │────▶│    Contract     │────▶│  Emit Event     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Submit Root    │◀────│    Indexer      │◀────│  Watch Events   │
└─────────────────┘     │  (BN254 Tree)   │     └─────────────────┘
        │               └─────────────────┘
        ▼                       │
┌─────────────────┐             │
│ Contract stores │             ▼
│ root in history │     ┌─────────────────┐
└─────────────────┘     │  Provide paths  │
                        │  via API        │
                        └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │  User generates │
                        │  ZK proof       │
                        └─────────────────┘
```

## Running Your Own Indexer

1. Clone this repo
2. Configure `.env` with your RPC URL and the contract address
3. Run `npm start`
4. The indexer will sync from `START_BLOCK` and catch up to the latest block
5. Use the API to get Merkle paths for your proofs

## Recovery Mode

If you need to withdraw but no indexer is available:

1. Query all `CommitmentCreated` events from the contract
2. Extract commitments and leaf indices
3. Build the Merkle tree using BN254 Poseidon
4. Compute your Merkle path
5. Generate the ZK proof and withdraw

The data is all on-chain - the indexer just makes it convenient.
