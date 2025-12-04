## Zcash ➜ Starknet Bridge Relayer

This service watches shielded Zcash transactions, parses memo instructions, and executes the corresponding Starknet actions (`stake_from_bridge_public` or `stake_from_bridge_private`). It also exposes simple health/stats APIs and stores events in MongoDB for monitoring.

### What It Does

1. Polls `zcashd` for new transactions sent to the bridge vault address.
2. Parses memo payloads:
   - `01:<starknet_address>` → public stake route (mint spSTRK to user).
   - `02:<commitment>` → private stake route (fixed 10 spSTRK note).
3. Quotes STRK needed using the on-chain exchange rate from the spSTRK contract.
4. Sends STRK approvals + staking transactions via a Starknet account (`BACKEND_ACCOUNT_ADDRESS`).
5. Records status in MongoDB and serves REST endpoints for health, stats, and recent transactions.

### Prerequisites

- Node.js 18 or later.
- Running Zcash **testnet** node with RPC enabled (`zcashd -testnet`).
- Starknet Sepolia account funded with STRK for the relayer.
- MongoDB instance (local or hosted).

### Environment Variables

Create `.env` in `relayer-backend/` (values here are examples; see your real `.env`):

```env
PORT=3000

STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_9/<KEY>
BACKEND_ACCOUNT_ADDRESS=0x...
BACKEND_PRIVATE_KEY=0x...
SPSTRK_CONTRACT_ADDRESS=0x05efc624f4f0afb75bd6a57b35a0d2fb270c6eb0cea0e3f7dc36aefe9681e509
STRK_TOKEN_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
BACKEND_PRIVATE_STAKE_TOLERANCE_BPS=50   # 0.5% buffer over quote
REQUIRED_CONFIRMATIONS=1
POLL_INTERVAL_MS=10000

MONGODB_URI=mongodb://user:pass@host/db

BRIDGE_VAULT_ADDRESS=utest1...      # Zcash shielded address receiving user deposits
SENDING_WALLET_ADDRESS=utest1...    # Relayer Zcash wallet
ZCASH_RPC_URL=http://localhost:18232/
ZCASH_RPC_USER=...
ZCASH_RPC_PASSWORD=...
```

### Install & Run

```bash
cd relayer-backend
npm install

# development (auto-reload)
npm run dev

# production
npm start
```

When it starts you should see:

- `GET /health` – basic status.
- `GET /transactions` – last 50 processed bridge transactions.
- `GET /stats` – counts of pending/confirmed/minted.

### Helper Scripts

The `scripts/` folder contains CLI helpers:

- `privateBridgeSend.js` – quote + build Zcash memo for a fixed 10 spSTRK **private** stake.
- `publicBridgeSend.js` – quote + build Zcash memo for a **public** stake.

Run with `node scripts/privateBridgeSend.js --help` to see options like `--commitment` or `--zec`.

### Workflow

1. User sends shielded ZEC with memo to `BRIDGE_VAULT_ADDRESS`.
2. Relayer detects the transaction after `REQUIRED_CONFIRMATIONS`.
3. Converts ZEC to STRK using price feeds and the spSTRK exchange rate.
4. For action `01`, calls the public stake path and transfers spSTRK to the user.
5. For action `02`, calls the private stake path and creates a 10 spSTRK commitment on Starknet.
6. Marks the transaction as `minted` once the Starknet tx is confirmed.

### Troubleshooting

- **`u256_sub Overflow` from STRK token** – relayer Starknet account does not have enough STRK; top it up.
- **Zcash RPC errors** – verify `ZCASH_RPC_URL`, user, and password, and ensure the node is fully synced to testnet.
- **MongoDB connection errors** – check `MONGODB_URI` and that MongoDB is reachable from this process.
- **No new transactions detected** – confirm funds are sent to `BRIDGE_VAULT_ADDRESS` on the correct Zcash network and memos use the right `01`/`02` prefix.

### Docker (Optional)

You can run the relayer in Docker:

```bash
docker build -t zcash-relayer .
docker run --env-file .env zcash-relayer
```

Make sure the container can reach both the Zcash RPC endpoint and MongoDB.