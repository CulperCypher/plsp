use poseidon::poseidon::bn254::hash_2;

fn main(
    secret: Field,
    blinding: Field,
) -> pub Field {
    hash_2([secret, blinding])
}