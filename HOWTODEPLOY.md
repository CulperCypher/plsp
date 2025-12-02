## Deployment checklist

1. **Confirm toolchain versions**
   - Noir: `nargo 1.0.0-beta.5`
   - Barretenberg: `bb 0.87.4-starknet.1`
   - Garaga: `0.18.2` (Python venv recommended)
   - Scarb: `2.6.x` or later (needed for `garaga gen` formatting step)

2. **Compile Cairo contracts**
   - From repo root run:
   - `scarb build`
   - Outputs go to `target/dev/` (gitignored). Confirm `sp_strk` Sierra/Casm artifacts are created.

3. **Deploy contracts with Starkli**
   - Make sure Starkli is configured for the desired network (e.g., `starkli switch sepolia`).
   - Example: `starkli deploy target/dev/sp_strk.sp_strk.contract_class.json target/dev/sp_strk.sp_strk.compiled_contract_class.json --rpc <RPC_URL> --account <ACCOUNT>`
   - Capture the deployed addresses (spSTRK, withdrawal NFT, validator pool, etc.) and update `deployment.json` + frontend env.

4. **Compile Noir circuits**
   - Requires `nargo` (Noir) and `bb` (Barretenberg) plus `garaga`.
   - From `circuits/private_deposits` and `circuits/private_unlocks`:
     ```bash
     nargo compile
     bb prove --backend=starknet --circuit target/<circuit>.json ... # generate proof data
     bb vkey --backend=starknet --circuit target/<circuit>.json --vk-path ./vk
     ```
   - Versions used: `nargo <fill version>`, `bb starknet-<fill version>`, `garaga 0.18.2`.

5. **Generate Starknet verifier contracts**
   - Run `garaga` against each circuit’s verification key produced by `bb`:
     ```bash
     garaga --vk ./vk --output ./unlock_verifier
     ```
   - This produces Cairo verifier contract sources inside each circuit folder.

6. **Deploy verifier contracts**
   - Use Starkli again to deploy the generated `unlock_verifier` and `deposit_verifier` classes.
   - Record their addresses and call `set_unlock_verifier` / `set_deposit_verifier` on `sp_strk`.
   - Finally call `enable_privacy` once both verifiers + Merkle indexer are live.

7. **Run the Merkle indexer**
   - From repo root: `cd merkle_indexer`
   - Install deps (`npm install` or `yarn`).
   - Configure `INDEXER_URL`, Starknet RPC, and database env vars.
   - Start with `npm run dev` (or `npm run start` for prod). This service must push fresh Merkle roots via the owner account.

8. **Start the frontend**
   - From repo root: `cd privacy-app-new`
   - `npm install`
   - Provide env vars (RPC, indexer URL, deployment addresses). See `deployment.json` as source of truth.
   - `npm run dev` for local testing or `npm run build && npm run preview` / deploy to Vercel.

9. **Smoke test workflow**
   - Public stake/withdraw (ERC-4626) path.
   - Private deposit → claim spSTRK.
   - Private unlock (request + complete) for STRK and spSTRK toggle.
   - Verify proofs progress in UI and Merkle roots updating via indexer logs.

10. **Ztarknet (Madara) deployment notes**

- **RPC:** `https://ztarknet-madara.d.karnot.xyz`
- **Contracts to deploy:**
  1. `spSTRK` (same class hash as Starknet Sepolia)
  2. `private_deposits` verifier (`0x0687...5659` class hash)
  3. `unlock_verifier` (`0x67d7...19de` class hash)
- **Post-deploy config:**
  - Call `set_deposit_verifier`, `set_unlock_verifier`, `set_indexer` on `spSTRK` with the new addresses.
  - Re-run `enable_privacy` once verifiers + relayer are wired up.
  - Update `deployment.json` and frontend `.env` to point at the Ztarknet addresses.
- **Indexing:** The relayer still needs to push Merkle roots. Point its RPC + admin keys at Ztarknet.

Keep `target/` artifacts out of git (already ignored). Archive unused verifier experiments (e.g., `PrivateUnlocksVerifier/`) outside the repo if desired.