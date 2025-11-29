import axios from 'axios';

class PriceOracle {
  constructor() {
    this.apiUrl = 'https://api.coingecko.com/api/v3/simple/price';
    this.priceCache = {};
    this.cacheDuration = 60000; // Cache for 1 minute to avoid rate limits
  }

  async getZECPrice() {
    const now = Date.now();
    if (this.priceCache.zec && (now - this.priceCache.zec.timestamp < this.cacheDuration)) {
      console.log('   💾 Using cached ZEC price: $' + this.priceCache.zec.price);
      return this.priceCache.zec.price;
    }

    try {
      const response = await axios.get(this.apiUrl, {
        params: { ids: 'zcash', vs_currencies: 'usd' }
      });
      const price = response.data.zcash.usd;
      this.priceCache.zec = { price, timestamp: now };
      console.log(`   💰 ZEC/USD: $${price}`);
      return price;
    } catch (error) {
      console.error('Error fetching ZEC price:', error.message);
      // Fallback to last cached price if available
      if (this.priceCache.zec) {
        console.warn('   ⚠️  Using stale ZEC price from cache');
        return this.priceCache.zec.price;
      }
      throw error;
    }
  }

  async getSTRKPrice() {
    const now = Date.now();
    if (this.priceCache.strk && (now - this.priceCache.strk.timestamp < this.cacheDuration)) {
      console.log('   💾 Using cached STRK price: $' + this.priceCache.strk.price);
      return this.priceCache.strk.price;
    }

    try {
      const response = await axios.get(this.apiUrl, {
        params: { ids: 'starknet', vs_currencies: 'usd' }
      });
      const price = response.data.starknet.usd;
      this.priceCache.strk = { price, timestamp: now };
      console.log(`   💰 STRK/USD: $${price}`);
      return price;
    } catch (error) {
      console.error('Error fetching STRK price:', error.message);
      // Fallback to last cached price if available
      if (this.priceCache.strk) {
        console.warn('   ⚠️  Using stale STRK price from cache');
        return this.priceCache.strk.price;
      }
      throw error;
    }
  }

  /**
   * Convert zatoshis to STRK wei using real exchange rates
   * @param {number} zatoshis - Amount in zatoshis (1 ZEC = 100,000,000 zatoshis)
   * @returns {string} - STRK amount in wei as string (for u256)
   */
  async convertZatoshisToSTRK(zatoshis) {
    try {
      console.log(`\n💱 Converting ${zatoshis} zatoshis to STRK...`);
      
      const zecPrice = await this.getZECPrice();
      const strkPrice = await this.getSTRKPrice();
      
      // zatoshis to ZEC (1 ZEC = 10^8 zatoshis)
      const zecAmount = zatoshis / 1e8;
      
      // ZEC to USD to STRK
      const usdValue = zecAmount * zecPrice;
      const strkAmount = usdValue / strkPrice;
      
      // Convert to wei (18 decimals)
      const strkWei = BigInt(Math.floor(strkAmount * 1e18));
      
      console.log(`   💵 ${zecAmount} ZEC = $${usdValue.toFixed(2)}`);
      console.log(`   🎯 ${strkAmount.toFixed(6)} STRK`);
      console.log(`   📊 ${strkWei.toString()} STRK wei`);
      
      return strkWei.toString();
    } catch (error) {
      console.error('Error converting zatoshis to STRK:', error.message);
      throw error;
    }
  }
}

export const priceOracle = new PriceOracle();