/**
 * Validate if address is valid Starknet format (with or without 0x prefix)
 */
export function isValidAddress(address) {
  if (!address) return false;
  const clean = address.startsWith('0x') ? address.slice(2) : address;
  return /^[0-9a-fA-F]{1,64}$/.test(clean);
}

/**
 * Parse unified colon-delimited memo format.
 * 
 * Formats:
 * - 00:<address>           → Mint wTAZ to address
 * - 01:<address>           → Public stake, send spSTRK to address
 * - 02:<commitment>        → Private stake, 10 spSTRK note (fixed denomination)
 * - <address>              → Legacy: defaults to action 01 (public stake)
 * 
 * All formats support hex-encoded memos (will be decoded to ASCII first)
 */
export function parseMemo(memoString) {
  try {
    if (!memoString) {
      return null;
    }

    let candidate = memoString.trim();

    // Check if memo is hex-encoded and decode to ASCII
    const isHex = /^[0-9a-fA-F]+$/.test(candidate) && candidate.length % 2 === 0;
    if (isHex && candidate.length > 64) {
      try {
        let ascii = '';
        for (let i = 0; i < candidate.length; i += 2) {
          const charCode = parseInt(candidate.substring(i, i + 2), 16);
          if (charCode > 0) ascii += String.fromCharCode(charCode);
        }
        candidate = ascii.replace(/\0+$/, '').trim();
      } catch (decodeError) {
        // Not valid hex encoding, use as-is
      }
    }

    // Check for colon-delimited format
    if (candidate.includes(':')) {
      const parts = candidate.split(':');
      const action = parts[0];

      if (action === '00' && parts.length === 2) {
        // 00:<address> → Mint wTAZ
        const address = parts[1].startsWith('0x') ? parts[1] : '0x' + parts[1];
        if (!isValidAddress(address)) {
          throw new Error('Invalid address in memo');
        }
        console.log('   📝 Parsed memo (mint wTAZ):');
        console.log(`      Action: 00 (MINT)`);
        console.log(`      Address: ${address}`);
        return { action: '00', address, commitment: null };
      }

      if (action === '01' && parts.length === 2) {
        // 01:<address> → Public stake
        const address = parts[1].startsWith('0x') ? parts[1] : '0x' + parts[1];
        if (!isValidAddress(address)) {
          throw new Error('Invalid address in memo');
        }
        console.log('   📝 Parsed memo (public stake):');
        console.log(`      Action: 01 (STAKE)`);
        console.log(`      Address: ${address}`);
        return { action: '01', address, commitment: null };
      }

      if (action === '02') {
        // 02:<commitment> → Private stake (fixed denomination)
        const commitment = parts.length === 2 ? parts[1] : parts[2]; // Support legacy 02:amount:commitment
        if (!/^[0-9]+$/.test(commitment)) {
          throw new Error('Invalid commitment format');
        }
        console.log('   📝 Parsed memo (private stake):');
        console.log(`      Action: 02 (PRIVATE)`);
        console.log(`      Commitment: ${commitment}`);
        console.log(`      Amount: calculated by relayer (10 spSTRK)`);
        return { action: '02', address: null, commitment };
      }

      throw new Error(`Unknown action: ${action}`);
    }

    // Legacy format: just an address (no action code) → defaults to public stake (01)
    const address = candidate.startsWith('0x') ? candidate : '0x' + candidate;
    if (isValidAddress(address)) {
      console.log('   📝 Parsed memo (legacy - public stake):');
      console.log(`      Action: 01 (STAKE) - default`);
      console.log(`      Address: ${address}`);
      return { action: '01', address, commitment: null };
    }

    throw new Error('Invalid memo format');
  } catch (error) {
    console.error('Error parsing memo:', error.message);
    return null;
  }
}

// Alias for backwards compatibility
export function parsePrivateStakeMemo(memoString) {
  const result = parseMemo(memoString);
  if (result && result.action === '02') {
    return { action: '02', commitment: result.commitment, amountWei: null };
  }
  return null;
}