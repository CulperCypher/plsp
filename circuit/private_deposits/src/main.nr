// circuits/private_deposits/src/main.nr

use poseidon::poseidon::bn254::hash_2;

// Secret data the user keeps local
struct DepositWitness {
    secret: Field,              // User's secret
    amount: Field,              // Amount to deposit
    shares: Field,              // Calculated shares
    deposit_time: u64,          // When depositing
    blinding: Field,            // Random blinding factor
}

fn hash_deposit_note(w: DepositWitness) -> Field {
    // Same as withdrawal commitment
    let h1 = hash_2([w.secret, w.shares]);
    let h2 = hash_2([h1, w.deposit_time as Field]);
    hash_2([h2, w.blinding])
}

// Main function with individual public parameters (Noir 1.0-beta.5 syntax)
fn main(
    witness: DepositWitness,
    commitment: pub Field,      // Output: commitment to be stored
    shares: pub Field,          // Shares user will receive
    amount: pub Field,          // Amount being deposited
    total_assets: pub Field,    // Current pool total assets
    total_supply: pub Field,    // Current spSTRK supply
    current_time: pub u64,      // Block timestamp
) {
    // 1. Verify commitment
    let computed_commitment = hash_deposit_note(witness);
    assert(computed_commitment == commitment);

    // 2. Verify amount matches
    assert(witness.amount == amount);
    assert(witness.amount != 0);

    // 3. Verify shares calculation (exchange rate)
    if total_supply == 0 {
        assert(witness.amount == witness.shares);
        assert(shares == witness.shares);
    } else {
        assert(
            witness.shares * total_assets ==
            witness.amount * total_supply
        );
        assert(shares == witness.shares);
    }

    // 4. Verify timestamp
    assert(witness.deposit_time == current_time);
}