# Private Liquid Staking Protocol

A privacy-preserving liquid staking protocol for Starknet, built with Cairo and Noir ZK circuits.

## Overview

spSTRK is an ERC-4626 liquid staking token that allows users to stake STRK while maintaining liquidity. The protocol includes privacy features via zero-knowledge proofs.

The privacy features extend standard ERC-4626 liquid staking with zero-knowledge proofs, enabling private deposits and withdrawals.

## Demo

- GO HERE ->> Frontend (Vercel): https://plsp-neon.vercel.app/

## Features

### Privacy Route
- Stake via ZK circuit and save a private note
- Withdraw liquid spSTRK to any wallet, or unstake by requesting an unlock
- Withdrawals can go to fresh wallets with no transaction history for enhanced privacy

### Public Route
- Standard staking interface for users who prefer traditional wallet interactions

### Validator Delegation
- Auto-delegation to validator pools
- Maintains 10% liquid buffer in contract for withdrawals

### Rewards
- Staking rewards are claimed and added to the pool
- Increases the share value of all spSTRK holders

### Contract Properties
- Upgradeable and Ownable
- ERC-20 / ERC-4626 compliant
- Configurable dev and DAO fees on rewards (capped at 10%)

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

> RPCs: Starknet Sepolia default; Ztarknet Madara: `https://ztarknet-madara.d.karnot.xyz`

## Roadmap

- [ ] Integrate cross-chain bridge into staking logic
- [ ] Integrate Noir Circuits for private deposits
- [ ] Integrate Noir Circuits for private withdrawal of spSTRK or STRK
- [ ] Integrate a frontend UI for privacy staking  
