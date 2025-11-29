use poseidon::poseidon::bn254::hash_2;

fn main(
    secret: pub Field,
    shares: pub Field,
    deposit_time: pub Field,
    blinding: pub Field,
) {
    let h1 = hash_2([secret, shares]);
    let h2 = hash_2([h1, deposit_time]);
    let commitment = hash_2([h2, blinding]);
    let nullifier = hash_2([secret, blinding]);

    dbg!(commitment);
    dbg!(nullifier);
}