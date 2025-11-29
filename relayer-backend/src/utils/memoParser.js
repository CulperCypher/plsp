/**
 * Parse memo to extract destination address AND action
 * Memo format: 
 * - First 64 hex chars = Starknet address
 * - Next 2 hex chars = action (00 = mint wTAZ, 01 = stake spSTRK)
 */
export function parseMemo(memoHex) {
  try {
    // Remove any whitespace
    const cleanMemo = memoHex.trim();
    
    // Extract address (first 64 chars)
    const destinationAddress = cleanMemo.substring(0, 64);
    
    // Extract action (next 2 chars, or default to '00')
    const action = cleanMemo.length >= 66 ? cleanMemo.substring(64, 66) : '00';
    
    // Validate address is valid hex
    if (!/^[0-9a-fA-F]{64}$/.test(destinationAddress)) {
      throw new Error('Invalid memo format: not a valid 64-char hex string');
    }
    
    console.log(`   📝 Parsed memo:`);
    console.log(`      Address: 0x${destinationAddress}`);
    console.log(`      Action: ${action} (${action === '01' ? 'STAKE' : 'MINT'})`);
    
    return {
      address: '0x' + destinationAddress,
      action: action  // '00' or '01'
    };
  } catch (error) {
    console.error('Error parsing memo:', error.message);
    return null;
  }
}

/**
 * Validate if address is valid Ethereum/Starknet format
 */
export function isValidAddress(address) {
  return /^0x[0-9a-fA-F]{64}$/.test(address);
}