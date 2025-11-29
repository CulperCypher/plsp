import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { RpcProvider, hash, num, Account, Contract } from 'starknet';
import Database from 'better-sqlite3';
import { poseidon2 } from 'poseidon-lite';
const provider = new RpcProvider({ nodeUrl: process.env.RPC_URL });
const CONTRACT = process.env.CONTRACT;
const START_BLOCK = Number(process.env.START_BLOCK || 0);
const PORT = Number(process.env.PORT || 4000);

// Optional: Account for submitting roots (if INDEXER_PRIVATE_KEY is set)
const INDEXER_PRIVATE_KEY = process.env.INDEXER_PRIVATE_KEY;
const INDEXER_ACCOUNT_ADDRESS = process.env.INDEXER_ACCOUNT_ADDRESS;

const db = new Database('commitments.db');
db.exec(`CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leaf_index INTEGER UNIQUE,
  commitment TEXT UNIQUE,
  block INTEGER
);`);

db.exec(`CREATE TABLE IF NOT EXISTS roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root TEXT UNIQUE,
  block INTEGER,
  submitted INTEGER DEFAULT 0
);`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_commitment ON commitments(commitment);`);

const getLeaves = () => {
  const rows = db.prepare('SELECT commitment FROM commitments ORDER BY leaf_index ASC').all();
  return rows.map(r => BigInt(r.commitment));
};

// Poseidon hash matching BN254 curve (same as Noir circuit)
const poseidonHash = (a, b) => poseidon2([BigInt(a), BigInt(b)]).toString();

// Build in-memory tree data from DB
const buildTree = () => {
  const leaves = getLeaves();
  if (!leaves.length) return null;
  return { leaves };
};

// Compute Merkle root and sibling path for a given leaf index (matches Noir circuit)
const computeMerklePath = (leaves, leafIndex) => {
  const TREE_HEIGHT = 32;
  const siblings = [];
  let currentIndex = leafIndex;
  
  // Build path level by level
  let currentLevel = leaves.map(l => l.toString());
  
  for (let level = 0; level < TREE_HEIGHT; level++) {
    const isRight = currentIndex % 2 === 1;
    const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
    
    // Get sibling (0 if doesn't exist)
    const sibling = currentLevel[siblingIndex] ?? '0';
    siblings.push(sibling);
    
    // Build next level
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i] ?? '0';
      const right = currentLevel[i + 1] ?? '0';
      nextLevel.push(poseidonHash(left, right));
    }
    if (nextLevel.length === 0) nextLevel.push(poseidonHash('0', '0'));
    
    currentLevel = nextLevel;
    currentIndex = Math.floor(currentIndex / 2);
  }
  
  return { siblings, root: currentLevel[0] };
};

let tree = buildTree();

// Listen for all commitment events (regular, private, bridge, and single-step deposit)
const COMMITMENT_EVENT = hash.getSelectorFromName('CommitmentCreated');
const PRIVATE_COMMITMENT_EVENT = hash.getSelectorFromName('PrivateCommitmentCreated');
const BRIDGE_COMMITMENT_EVENT = hash.getSelectorFromName('BridgeCommitmentCreated');
const PRIVATE_DEPOSIT_EVENT = hash.getSelectorFromName('PrivateDeposit');

async function fetchEvents(fromBlock, toBlock) {
  let continuationToken = undefined;
  const events = [];

  do {
    const res = await provider.getEvents({
      address: CONTRACT,
      keys: [[COMMITMENT_EVENT, PRIVATE_COMMITMENT_EVENT, BRIDGE_COMMITMENT_EVENT, PRIVATE_DEPOSIT_EVENT]],
      from_block: { block_number: Number(fromBlock) },
      to_block: { block_number: Number(toBlock) },
      continuation_token: continuationToken,
      chunk_size: 50,
    });
    events.push(...res.events);
    continuationToken = res.continuation_token;
  } while (continuationToken);

  return events;
}

async function sync() {
  let fromBlock = Number(START_BLOCK);
  const lastCommit = db
    .prepare('SELECT block FROM commitments ORDER BY leaf_index DESC LIMIT 1')
    .get();

  if (lastCommit && typeof lastCommit.block === 'number') {
    fromBlock = lastCommit.block;
  }

  while (true) {
    const latestBlock = await provider.getBlockNumber();
    if (fromBlock > latestBlock) {
      await new Promise((r) => setTimeout(r, 6000));
      continue;
    }

    console.log(`Syncing blocks ${fromBlock} -> ${latestBlock}`);
    const events = await fetchEvents(fromBlock, latestBlock);
    if (!events.length) {
      fromBlock = latestBlock + 1;
      await new Promise((r) => setTimeout(r, 6000));
      continue;
    }

    // Parse and insert commitment events
    // For events with #[key] commitment:
    //   keys: [selector, commitment_low, commitment_high]
    //   data: [leaf_index_low, leaf_index_high, ...]
    const insertStmt = db.prepare(
      'INSERT OR IGNORE INTO commitments (leaf_index, commitment, block) VALUES (?, ?, ?)'
    );
    const insertRoot = db.prepare(
      'INSERT INTO roots (root, block, submitted) VALUES (?, ?, 0)'
    );

    let newCommitments = 0;
    for (const evt of events) {
      const keys = evt.keys;
      const data = evt.data;
      
      // commitment is keyed, so it's in keys[1] and keys[2] (low/high)
      const commitmentLow = BigInt(keys[1]);
      const commitmentHigh = BigInt(keys[2]);
      const commitment = (commitmentHigh << 128n) + commitmentLow;
      
      // leaf_index is first in data
      const leafIndexLow = BigInt(data[0]);
      const leafIndexHigh = BigInt(data[1]);
      const leafIndex = Number((leafIndexHigh << 128n) + leafIndexLow);

      console.log(`  leaf[${leafIndex}] commitment=${commitment.toString().slice(0,20)}...`);

      try {
        const result = insertStmt.run(leafIndex, commitment.toString(), evt.block_number);
        if (result.changes > 0) newCommitments++;
      } catch (e) {
        if (!e.message.includes('UNIQUE')) console.error(e);
      }
    }

    // Rebuild in-memory tree and compute root using BN254 Poseidon
    tree = buildTree();
    
    if (newCommitments > 0 && tree && tree.leaves.length > 0) {
      // Compute the correct BN254 Poseidon root
      const { root } = computeMerklePath(tree.leaves, 0);
      console.log(`  Computed BN254 root: ${root.slice(0, 20)}...`);
      
      // Store the computed root
      let isNewRoot = false;
      try {
        const result = insertRoot.run(root, latestBlock);
        isNewRoot = result.changes > 0;
      } catch (e) {
        if (!e.message.includes('UNIQUE')) console.error(e);
      }
      
      // Auto-submit to contract if we have credentials and it's a new root
      if (isNewRoot && INDEXER_PRIVATE_KEY && INDEXER_ACCOUNT_ADDRESS) {
        try {
          console.log(`  Auto-submitting root to contract...`);
          const account = new Account(provider, INDEXER_ACCOUNT_ADDRESS, INDEXER_PRIVATE_KEY);
          const rootBn = BigInt(root);
          const low = (rootBn & ((1n << 128n) - 1n)).toString();
          const high = (rootBn >> 128n).toString();
          
          const tx = await account.execute({
            contractAddress: CONTRACT,
            entrypoint: 'submit_merkle_root',
            calldata: [low, high]
          });
          
          console.log(`  ✓ Root submitted! tx: ${tx.transaction_hash}`);
          db.prepare('UPDATE roots SET submitted = 1 WHERE root = ?').run(root);
        } catch (e) {
          console.error(`  ✗ Failed to submit root:`, e.message);
        }
      }
    }
    
    console.log(`  Processed ${events.length} events, ${newCommitments} new, tree has ${tree?.leaves?.length ?? 0} leaves`);

    fromBlock = latestBlock + 1;
  }
}

const app = express();
app.use(cors()); // Enable CORS for all origins
app.use(express.json());

// Get latest Merkle root
app.get('/root', (req, res) => {
  const row = db.prepare('SELECT root FROM roots ORDER BY id DESC LIMIT 1').get();
  res.json({ root: row?.root ?? null });
});

// Get Merkle path by leaf index (for proof generation)
app.get('/path/:index', (req, res) => {
  const index = Number(req.params.index);
  if (Number.isNaN(index)) return res.status(400).json({ error: 'invalid index' });
  
  if (!tree || !tree.leaves || tree.leaves.length === 0) {
    return res.status(404).json({ error: 'no leaves in tree' });
  }
  
  if (index >= tree.leaves.length) {
    return res.status(404).json({ error: 'leaf index out of range' });
  }
  
  const { siblings, root } = computeMerklePath(tree.leaves, index);
  res.json({
    leaf_index: index,
    commitment: tree.leaves[index].toString(),
    siblings,  // Array of 32 Field strings for Prover.toml
    root,
  });
});

// Get path by commitment hash
app.get('/path/commitment/:commitment', (req, res) => {
  const commitment = req.params.commitment;
  const row = db.prepare('SELECT leaf_index FROM commitments WHERE commitment = ?').get(commitment);
  if (!row) return res.status(404).json({ error: 'commitment not found' });
  
  if (!tree || !tree.leaves) {
    return res.status(500).json({ error: 'tree not initialized' });
  }
  
  const index = row.leaf_index;
  const { siblings, root } = computeMerklePath(tree.leaves, index);
  res.json({
    leaf_index: index,
    commitment,
    siblings,
    root,
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    leaves: tree?.leaves?.length ?? 0,
    latestRoot: db.prepare('SELECT root FROM roots ORDER BY id DESC LIMIT 1').get()?.root ?? null
  });
});

// Get pending (unsubmitted) roots
app.get('/pending-roots', (req, res) => {
  const rows = db.prepare('SELECT root, block FROM roots WHERE submitted = 0 ORDER BY id ASC').all();
  res.json({ pending: rows });
});

// Helper to convert BigInt to u256 calldata (low, high)
const toU256Calldata = (value) => {
  const bn = BigInt(value);
  const low = bn & ((1n << 128n) - 1n);
  const high = bn >> 128n;
  return [low.toString(), high.toString()];
};

// Submit a root to the contract (requires INDEXER_PRIVATE_KEY and INDEXER_ACCOUNT_ADDRESS)
app.post('/submit-root', express.json(), async (req, res) => {
  const { root } = req.body;
  
  if (!root) {
    // Get latest unsubmitted root
    const row = db.prepare('SELECT root FROM roots WHERE submitted = 0 ORDER BY id DESC LIMIT 1').get();
    if (!row) {
      return res.status(404).json({ error: 'No pending roots to submit' });
    }
    req.body.root = row.root;
  }
  
  if (!INDEXER_PRIVATE_KEY || !INDEXER_ACCOUNT_ADDRESS) {
    // Return the calldata for manual submission
    const [low, high] = toU256Calldata(req.body.root);
    return res.json({
      message: 'No indexer account configured. Use this calldata to submit manually:',
      root: req.body.root,
      calldata: { low, high },
      command: `starkli invoke ${CONTRACT} submit_merkle_root ${low} ${high} --account <YOUR_ACCOUNT>`
    });
  }
  
  try {
    const account = new Account(provider, INDEXER_ACCOUNT_ADDRESS, INDEXER_PRIVATE_KEY);
    const [low, high] = toU256Calldata(req.body.root);
    
    const tx = await account.execute({
      contractAddress: CONTRACT,
      entrypoint: 'submit_merkle_root',
      calldata: [low, high]
    });
    
    console.log(`Submitted root ${req.body.root.slice(0, 20)}... tx: ${tx.transaction_hash}`);
    
    // Mark as submitted
    db.prepare('UPDATE roots SET submitted = 1 WHERE root = ?').run(req.body.root);
    
    res.json({ 
      success: true, 
      root: req.body.root,
      transaction_hash: tx.transaction_hash 
    });
  } catch (e) {
    console.error('Failed to submit root:', e);
    res.status(500).json({ error: e.message });
  }
});

// Submit all pending roots
app.post('/submit-all-roots', express.json(), async (req, res) => {
  if (!INDEXER_PRIVATE_KEY || !INDEXER_ACCOUNT_ADDRESS) {
    return res.status(400).json({ error: 'No indexer account configured' });
  }
  
  const rows = db.prepare('SELECT root FROM roots WHERE submitted = 0 ORDER BY id ASC').all();
  if (!rows.length) {
    return res.json({ message: 'No pending roots', submitted: 0 });
  }
  
  const account = new Account(provider, INDEXER_ACCOUNT_ADDRESS, INDEXER_PRIVATE_KEY);
  const results = [];
  
  for (const row of rows) {
    try {
      const [low, high] = toU256Calldata(row.root);
      const tx = await account.execute({
        contractAddress: CONTRACT,
        entrypoint: 'submit_merkle_root',
        calldata: [low, high]
      });
      
      db.prepare('UPDATE roots SET submitted = 1 WHERE root = ?').run(row.root);
      results.push({ root: row.root, tx: tx.transaction_hash, success: true });
      console.log(`Submitted root ${row.root.slice(0, 20)}... tx: ${tx.transaction_hash}`);
    } catch (e) {
      results.push({ root: row.root, error: e.message, success: false });
    }
  }
  
  res.json({ submitted: results.filter(r => r.success).length, results });
});

app.listen(PORT, () => console.log(`Merkle Indexer API listening on port ${PORT}`));

sync().catch(err => {
  console.error('sync error', err);
  process.exit(1);
});
