const { buildPoseidon } = require("circomlibjs");

const witness = {
    secret: BigInt("98765432109876543210"),
    shares: BigInt("100000000000000000000"),
    deposit_time: BigInt("1700000000"),
    blinding: BigInt("12345678901234567890")
};

async function computeCommitment() {
    const poseidon = await buildPoseidon();
    
    const h1 = poseidon.F.toString(poseidon([witness.secret, witness.shares]));
    const h2 = poseidon.F.toString(poseidon([BigInt(h1), witness.deposit_time]));
    const commitment = poseidon.F.toString(poseidon([BigInt(h2), witness.blinding]));
    
    console.log("commitment =", commitment);
    console.log(`\nUpdate Prover.toml: commitment = "${commitment}"`);
}

computeCommitment().catch(console.error);