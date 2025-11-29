const { buildPoseidon } = require("circomlibjs");

const commitment = BigInt("21098752700218543224960621296538648866114933415667035727129760525701482699380");
const leafIndex = 0n;                    // since you set leaf_index = "0"
const siblings = Array(32).fill(0n);     // your current siblings array

async function main() {
  const poseidon = await buildPoseidon();
  let current = commitment;
  let index = leafIndex;

  for (const sibling of siblings) {
    const left = index & 1n ? sibling : current;
    const right = index & 1n ? current : sibling;
    current = poseidon([left, right]);
    index >>= 1n;
  }

  console.log("computed root =", poseidon.F.toString(current));
}

main().catch(console.error);