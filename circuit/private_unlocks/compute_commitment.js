// Helper script to compute the correct commitment hash for withdrawal circuit
// Run with: node compute_commitment.js
// Install: npm install circomlibjs

const { buildPoseidon } = require("circomlibjs");

// These should match your Prover.toml witness values
const witness = {
    secret: BigInt("0x1234567890abcdef"),
    shares: BigInt("100000000000000000"),
    unlock_time: BigInt(1700000001),
    request_time: BigInt(691200),
    blinding: BigInt("0x9876543210fedcba")
};

async function computeCommitment() {
    const poseidon = await buildPoseidon();
    
    console.log("Witness values:");
    console.log("  secret:", witness.secret.toString());
    console.log("  shares:", witness.shares.toString());
    console.log("  unlock_time:", witness.unlock_time.toString());
    console.log("  request_time:", witness.request_time.toString());
    console.log("  blinding:", witness.blinding.toString());
    console.log();
    
    // h1 = hash_2([secret, shares])
    const h1 = poseidon.F.toString(poseidon([witness.secret, witness.shares]));
    console.log("h1 = hash_2([secret, shares]) =", h1);
    
    // h2 = hash_2([h1, unlock_time])
    const h2 = poseidon.F.toString(poseidon([BigInt(h1), witness.unlock_time]));
    console.log("h2 = hash_2([h1, unlock_time]) =", h2);
    
    // h3 = hash_2([h2, request_time])
    const h3 = poseidon.F.toString(poseidon([BigInt(h2), witness.request_time]));
    console.log("h3 = hash_2([h2, request_time]) =", h3);
    
    // commitment = hash_2([h3, blinding])
    const commitment = poseidon.F.toString(poseidon([BigInt(h3), witness.blinding]));
    console.log("commitment = hash_2([h3, blinding]) =", commitment);
    console.log();
    
    // nullifier = hash_2([secret, shares])
    const nullifier = h1; // Same as h1!
    console.log("nullifier = hash_2([secret, shares]) =", nullifier);
    console.log();
    
    console.log("✅ Update Prover.toml:");
    console.log(`commitment = "${commitment}"`);
    console.log(`nullifier = "${nullifier}"`);
}

computeCommitment().catch(console.error);
