# Liquid Privacy – Starknet + Zcash Private Liquid Staking

Liquid Privacy is a full-stack protocol that lets users stake STRK, earn yield, and preserve privacy. It merges:

- An ERC-4626 vault (`spSTRK`) that auto-delegates to validator pools.
- Noir circuits + Poseidon Merkle trees for private deposits/withdrawals.
- A Zcash relayer/indexer stack that turns shielded memos into Starknet transactions.

The repo contains all on-chain contracts, Noir circuits, the React frontend, bridge relayer, and Merkle indexer.

## Live Demo

- Frontend (Vercel): https://plsp-neon.vercel.app/
- Demo video: https://youtu.be/7QtYn-ZPjNI

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Key Features](#key-features)
3. [Repo Structure](#repo-structure)
4. [Deployments](#deployments)
5. [Getting Started](#getting-started)
6. [Bridge & Privacy Flows](#bridge--privacy-flows)
7. [Troubleshooting](#troubleshooting)
8. [Roadmap](#roadmap)

## System Architecture

```
         Zcash shielded pool
                │
      (02) memo │ (01) memo
                ▼
        Relayer backend ───► Starknet contracts (spSTRK, verifiers)
                │                     ▲
                │                     │
      Merkle indexer ◄───────────────┘
                │
                ▼
         Frontend (privacy-app-new)
```

- **Contracts**: ERC-4626 vault (spSTRK), private deposit verifier, private unlock verifier.
- **Relayer**: Watches shielded ZEC memos, converts ZEC→STRK, calls `stake_from_bridge_private/public`.
- **Merkle Indexer**: Rebuilds Poseidon tree off-chain, exposes REST endpoints for commitments and siblings.
- **Frontend**: React + Vite application that orchestrates wallet actions, Noir proof generation, and bridge monitoring.

## Key Features

| Feature | Description |
| --- | --- |
| Public staking | Standard ERC-4626 UX for users who want transparent staking. |
| Privacy pool | Fixed 10 spSTRK denomination using Noir circuits, Poseidon commitments, and Pedersen nullifiers. |
| Zcash bridge | Action-code memos move shielded ZEC into Starknet, auto-minting private or public stakes. |
| Auto delegation | Vault delegates STRK to validator pools and keeps a 10% liquid buffer. |
| Reward compounding | Claimed rewards increase exchange rate for all spSTRK holders. |
| App-level RPC | Frontend uses its own Alchemy provider for `waitForTransaction`, bypassing wallet RPC issues. |

## Repo Structure

```
plsp/
├─ contracts/               # Cairo contracts (ERC-4626 vault, verifiers)
├─ circuits/                # Noir projects for deposit/unlock
├─ relayer-backend/         # Zcash memo watcher + bridge executor
├─ merkle_indexer/          # Poseidon Merkle tree service
├─ privacy-app-new/         # React frontend (see README inside)
└─ README.md                # You are here
```

Refer to the sub-READMEs for detailed setup of each component.

## Deployments

### Starknet Sepolia

| Contract | Address |
| --- | --- |
| spSTRK (ERC-4626 vault) | `0x05efc624f4f0afb75bd6a57b35a0d2fb270c6eb0cea0e3f7dc36aefe9681e509` |
| Private Deposit Verifier | `0x039fbb068b510e5528eeea74a51c5ffa6e7c8278acddcf3f6ad628bd9d16c0d5` |
| Private Unlock Verifier | `0x01c992ea356cc4c99d61fa4cd5b671813db06753d5419e341857eebeee0aa55a` |

### Ztarknet (Madara testnet)

| Contract | Address |
| --- | --- |
| spSTRK | `0x058504c2b70fe7e2c258102b6fce8e802750beaffa0509c3b234e25e826464ee` |
| Private Deposit Verifier | `0x07139fb595c86c23e7b322775dfa1fd19c69e27329af1c96522ce0fc9bcb4b5d` |
| Private Unlock Verifier | `0x0059b8a43dadf9d211851d594de6a79d210aadaa3613544abe1aae6c1f100110` |

> RPCs: Starknet Sepolia default; Ztarknet Madara – `https://ztarknet-madara.d.karnot.xyz`

## Getting Started

```bash
git clone https://github.com/CulperCypher/plsp.git
cd plsp

# install frontend
cd privacy-app-new && npm install && cd ..

# install relayer
cd relayer-backend && npm install && cd ..

# install merkle indexer
cd merkle_indexer && npm install && cd ..
```

1. Export env vars for each package (see respective READMEs). Minimum requirement for frontend: `VITE_RPC_URL` pointing to Alchemy Starknet Sepolia.
2. Start services:
   - `npm run dev` inside `privacy-app-new/` for the UI.
   - `npm run start` inside `relayer-backend/` (requires Zcash node access + STRK funded account).
   - `npm run start` inside `merkle_indexer/` to serve Merkle paths.

## Tooling & Versions

| Component | Version / Command |
| --- | --- |
| Scarb | `scarb --version` → 2.5.x or newer |
| Starknet Foundry (`sncast`) | `snfoundryup` latest (tested on 0.29.x) |
| Noir | `noirup --version 1.0.0-beta.5` |
| Barretenberg | `bbup --version 0.87.4-starknet.1` (provides UltraHonk backend) |
| Garaga | `pip install garaga==0.18.1` |
| Node.js | `>= 18` for all JS packages |
| Zcash node | `zcashd` testnet (for relayer) |

Quick install snippet for the ZK stack:

```bash
noirup --version 1.0.0-beta.5
bbup --version 0.87.4-starknet.1
pip install garaga==0.18.1
```

Verify tooling before compiling circuits:

```bash
noir --version
bb --version
python -c "import garaga; print(garaga.__version__)"
```

If versions drift, proofs may fail to verify on-chain. Use these exact releases for reproducible builds.

## Deploying / Updating Contracts

All deployment scripts live in `contracts/` and rely on the root `.env` for RPC + key material.

1. **Configure `.env`** (root)

```env
PRIVATE_KEY=
STARKNET_SEPOLIA_RPC_URL=
STARKNET_NETWORK=
OWNER_ADDRESS=
DAO_FEE_BPS=
DEV_FEE_BPS=
UNLOCK_PERIOD=
CLAIM_WINDOW=
```

2. **Compile contracts**

```bash
cd contracts
scarb build   # outputs Sierra/CASM artifacts in target/
```

3. **Declare classes** (using `sncast`)

```bash
sncast --url $STARKNET_SEPOLIA_RPC_URL --account default declare \
  --contract-name sp_strk_vault \
  --compiled-class-hash target/dev/sp_strk_vault.compiled_class_hash.json

sncast ... declare --contract-name private_deposit_verifier
sncast ... declare --contract-name private_unlock_verifier
```

4. **Deploy**

```bash
sncast --url $STARKNET_SEPOLIA_RPC_URL --account default deploy \
  --class-hash <VAULT_CLASS_HASH> \
  --constructor-calldata \
  $STRK_TOKEN_SEPOLIA $OWNER_ADDRESS $DAO_FEE_BPS $DEV_FEE_BPS $UNLOCK_PERIOD $CLAIM_WINDOW

sncast ... deploy --class-hash <DEPOSIT_VERIFIER_CLASS_HASH>
sncast ... deploy --class-hash <UNLOCK_VERIFIER_CLASS_HASH>
```

5. **Update references**

- Record addresses in `.env` (`SPSTRK_CONTRACT_ADDRESS`, `PRIVATE_DEPOSITS_CONTRACT_ADDRESS`, `PRIVATE_UNLOCKS_CONTRACT_ADDRESS`).
- Update `privacy-app-new/src/App.tsx` constants if necessary.
- Restart relayer/indexer so they pick up the fresh addresses.

## Bridge & Privacy Flows

### Private Deposit (UI)

1. Generate secret & blinding → compute Poseidon commitment.
2. Approve STRK spend and call `private_deposit` (fixed 10 spSTRK). Save the note string.
3. Later, paste the note, fetch Merkle path from indexer, run Noir proof, and call `claim_spSTRK` or `request_private_unlock` → `complete_private_withdraw`.

### Zcash Bridge

- **Memo format**
  - `01:<starknet_address>` – public stake routed to that Starknet address.
  - `02:<commitment>` – private stake (fixed 10 spSTRK note) using decimal commitment.
- Relayer polls the Zcash node, parses memos, converts ZEC to STRK, then:
  - Calls `stake_from_bridge_public` for action 01 (mint spSTRK and transfer to user).
  - Calls `stake_from_bridge_private` for action 02 (mint private commitment on Starknet).

### Public Staking

1. User approves STRK.
2. Calls `stake` (from UI or relayer flow) → receives spSTRK.
3. Can request unlock, wait, claim STRK back.

## Troubleshooting

- **Wallet stuck “Waiting for tx”** – ensure env var `VITE_RPC_URL` is set; frontend uses its own provider.
- **Bridge errors** – relayer must hold enough STRK to cover the STRK leg plus a gas buffer.
- **Proof verification fails** – confirm indexer returns matching root, regenerate witness with correct note data, and ensure deposit has finalized.

## Roadmap

- [x] Integrate cross-chain bridge into staking logic.
- [x] Integrate Noir circuits for private deposits.
- [x] Integrate Noir circuits for private withdrawals of spSTRK/STRK.
- [x] Build frontend UI for privacy staking.

## Contact / Support

- Open an issue in this repo.
- Ping `@Culper` in the hackathon Discord.
