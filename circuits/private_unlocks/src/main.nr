use poseidon::poseidon::bn254::hash_2;

global TREE_HEIGHT: u32 = 32;

// Fixed denomination: 10 spSTRK (10 * 10^18 wei)
global DENOMINATION: Field = 10000000000000000000;

// Simplified private unlock circuit - FIXED DENOMINATION for security
// Matches deposit structure - contract handles time locks
// Circuit proves: ownership + nullifier

// Secret data the user keeps local (matches deposit note)
struct NoteWitness {
    secret: Field,
    shares: Field,
    deposit_time: Field,
    blinding: Field,
}

fn hash_commitment(w: NoteWitness) -> Field {
    let h1 = hash_2([w.secret, w.shares]);
    let h2 = hash_2([h1, w.deposit_time]);
    hash_2([h2, w.blinding])
}

fn hash_nullifier(w: NoteWitness) -> Field {
    hash_2([w.secret, w.blinding])
}

fn main(
    // Private witness - never revealed
    witness: NoteWitness,
    leaf_index: u32,
    siblings: [Field; TREE_HEIGHT],
    // Public inputs - only these are visible on-chain
    nullifier: pub Field,
    shares: pub Field,
    root: pub Field,
) {
    // 1. Compute commitment PRIVATELY (not revealed!)
    let commitment = hash_commitment(witness);

    // 2. Verify nullifier matches witness
    let computed_nullifier = hash_nullifier(witness);
    assert(computed_nullifier == nullifier);

    // 3. Verify shares matches FIXED DENOMINATION (security: prevents amount manipulation)
    assert(witness.shares == shares);
    assert(shares == DENOMINATION); // Must be exactly 10 spSTRK

    // 4. Merkle membership proof - proves commitment is in tree WITHOUT revealing it
    let mut current = commitment;
    let mut index: u32 = leaf_index;

    for sibling in siblings {
        let is_right = index & 1;
        let left = if is_right == 0 { current } else { sibling };
        let right = if is_right == 0 { sibling } else { current };
        current = hash_2([left, right]);
        index = index >> 1;
    }

    assert(current == root);
}