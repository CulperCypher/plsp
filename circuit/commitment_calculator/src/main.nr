use poseidon::poseidon::bn254::hash_2;

fn main(
    secret: Field,
    shares: Field,
    deposit_time: Field,
    blinding: Field,
) -> pub Field {
    // Same hash structure as private_deposits circuit
    let h1 = hash_2([secret, shares]);
    let h2 = hash_2([h1, deposit_time]);
    hash_2([h2, blinding])
}
