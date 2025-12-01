const { buildPoseidon } = require("circomlibjs");

const witness = {
  secret: BigInt("0x1234567890abcdef"),
  shares: BigInt("100000000000000000"),
  deposit_time: BigInt(1700000001),
  blinding: BigInt("0x9876543210fedcba"),
};

async function main() {
  const poseidon = await buildPoseidon();

  const h1 = poseidon([witness.secret, witness.shares]);
  const h2 = poseidon([h1, witness.deposit_time]);
  const commitment = poseidon([h2, witness.blinding]);
  const nullifier = poseidon([witness.secret, witness.blinding]);

  console.log("commitment =", poseidon.F.toString(commitment));
  console.log("nullifier  =", poseidon.F.toString(nullifier));
}

main().catch(console.error);