# Private Liquid Staking Protocol

A privacy-preserving liquid staking protocol for Starknet, built with Cairo and Noir ZK circuits.

## Overview

spSTRK is an ERC-4626 liquid staking token that allows users to stake STRK while maintaining liquidity. The protocol includes privacy features via zero-knowledge proofs.

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

## Deployment

**Starknet Sepolia:** `0x05efc624f4f0afb75bd6a57b35a0d2fb270c6eb0cea0e3f7dc36aefe9681e509`

## Roadmap

- [ ] Integrate cross-chain bridge into staking logic
- [ ] Integrate Noir Circuits for private deposits
- [ ] Integrate Noir Circuits for private withdrawal of spSTRK or STRK
- [ ] Integrate a frontend UI for privacy staking  
