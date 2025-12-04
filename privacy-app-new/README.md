# Liquid Privacy Frontend

Liquid Privacy is a Starknet dApp that combines liquid staking with optional privacy. Users can:

1. Stake STRK publicly through a standard ERC-4626 vault and receive spSTRK.
2. Enter the privacy pool (fixed 10 spSTRK denomination) where deposits/withdrawals are shielded with Noir proofs and a Poseidon Merkle tree.
3. Bridge shielded ZEC from Zcash directly into Starknet via memo-based intents handled by the relayer backend.

This README focuses on the `privacy-app-new/` React + Vite frontend that orchestrates wallet actions, proof generation, and bridge status monitoring.

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Project Structure](#project-structure)
- [Key Workflows](#key-workflows)
- [Troubleshooting](#troubleshooting)
- [Resources](#resources)

## Features

- **Dual staking paths** – Public ERC-4626 staking and private deposits that mint fixed 10 spSTRK notes.
- **In-browser Noir proofs** – Generates UltraHonk proofs for private withdrawals with Barretenberg/Honk WASM.
- **App-level RPC provider** – Uses an Alchemy Starknet RPC (configurable) for reliable tx confirmation regardless of wallet RPC issues.
- **Bridge visibility** – Shows memo instructions for shielded ZEC transfers and monitors relayer progress.
- **Merkle tooling** – Fetches siblings/roots from the off-chain indexer to build private withdrawal proofs.

## Architecture Overview

```
Wallet (Braavos/Argent) ─┐
                         ├─ Frontend (React + Vite)
Relayer + Merkle indexer ┘      │
                                ├─ Starknet contracts (spSTRK vault, verifiers)
Zcash shielded pool ────────────┘
```

- **Frontend** handles user flows, proof generation, and transaction submission.
- **Relayer** (separate package) watches Zcash memos, converts ZEC→STRK, and calls `stake_from_bridge_*` entrypoints.
- **Merkle indexer** exposes REST endpoints consumed by the app to obtain Merkle paths/roots for commitments.

## Prerequisites

- Node.js `>=18`
- npm, pnpm, or bun (project scripts assume `npm` but any package manager works)
- Starknet-compatible wallet (Braavos or Argent X)
- Alchemy Starknet Sepolia RPC key (or any stable RPC endpoint)

## Environment Variables

Create a `.env` file in `privacy-app-new/` with:

```bash
VITE_RPC_URL=
VITE_INDEXER_URL=
VITE_RELAYER_STATUS_URL=
```

- `VITE_RPC_URL` is required and powers the app-level `RpcProvider`.
- Other values are optional if you run the indexer/relayer locally (defaults point to `/api/...` routes when deployed on Vercel).

## Getting Started

```bash
cd privacy-app-new
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`. Connect your wallet on Starknet Sepolia.

## Available Scripts

| Command            | Description                                                   |
|--------------------|---------------------------------------------------------------|
| `npm run dev`      | Start Vite dev server with hot reload.                        |
| `npm run build`    | Compile production assets (used by Vercel deployment).        |
| `npm run preview`  | Preview the production build locally.                         |
| `npm run lint`     | (Optional) Run ESLint/TypeScript checks if configured.        |

## Project Structure

```
privacy-app-new/
├─ public/                # Static assets
├─ src/
│  ├─ App.tsx            # Main UI + staking/bridge logic
│  ├─ hooks/usePublicStaking.ts # Public staking hooks + RPC helper
│  ├─ helpers/proof.ts   # Noir proof helpers / serialization
│  ├─ types/             # Shared TypeScript defs
│  └─ styles/            # CSS
├─ package.json
└─ tsconfig*.json
```

## Key Workflows

1. **Public stake** – Approve STRK → call `stake` → display balances/unlock status.
2. **Private deposit** – Generate secret/blinding → compute commitment → approve STRK → call `private_deposit` → prompt user to save note.
3. **Private withdraw** – Paste note → fetch Merkle path → generate Noir proof → call `claim_spSTRK` or `request_private_unlock`.
4. **Zcash bridge** – Follow memo instructions, send shielded ZEC, let relayer execute `stake_from_bridge_private` (fixed 10 spSTRK) or `stake_from_bridge_public`.

## Troubleshooting

- **Wallet tx pending forever** – Ensure `VITE_RPC_URL` points to a working RPC (e.g., Alchemy). The app uses its own provider for `waitForTransaction`.
- **Private withdraw failing** – Confirm the indexer is synced and returning the commitment’s siblings/root. Recompute note data carefully.
- **Bridge memo errors** – Action codes must match (`01` public stake, `02` private). Commitment must be 32-byte decimal string for private path.

## Resources

- Demo video: https://youtu.be/7QtYn-ZPjNI
- Starknet contracts + relayer: see root project README for full documentation.
- Issues/questions: open a GitHub issue or reach out via the hackathon Discord channel.
