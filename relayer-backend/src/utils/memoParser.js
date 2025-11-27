/**
 * Parse memo to extract destination address
 * Memo format: First 32 bytes (64 hex chars) = Ethereum/Starknet address
 */
export function parseMemo(memoHex) {
  try {
    // Remove any whitespace
    const cleanMemo = memoHex.trim();
    
    // Extract first 64 hex characters (32 bytes)
    const destinationAddress = cleanMemo.substring(0, 64);
    
    // Validate it's a valid hex string
    if (!/^[0-9a-fA-F]{64}$/.test(destinationAddress)) {
      throw new Error('Invalid memo format: not a valid 64-char hex string');
    }
    
    // Add 0x prefix for Ethereum/Starknet address
    return '0x' + destinationAddress;
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