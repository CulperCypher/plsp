import axios from 'axios';

async function testPriceAPI() {
  try {
    console.log('🧪 Testing CoinGecko API...\n');
    
    // Test ZEC price
    console.log('Fetching ZEC price...');
    const zecResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'zcash',
        vs_currencies: 'usd'
      }
    });
    const zecPrice = zecResponse.data.zcash.usd;
    console.log(`✅ ZEC/USD: $${zecPrice}\n`);
    
    // Test STRK price
    console.log('Fetching STRK price...');
    const strkResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'starknet',
        vs_currencies: 'usd'
      }
    });
    const strkPrice = strkResponse.data.starknet.usd;
    console.log(`✅ STRK/USD: $${strkPrice}\n`);
    
    // Test conversion
    const testZEC = 0.1;
    const usdValue = testZEC * zecPrice;
    const strkAmount = usdValue / strkPrice;
    const strkWei = BigInt(Math.floor(strkAmount * 1e18));
    
    console.log('📊 Test Conversion:');
    console.log(`   ${testZEC} ZEC = $${usdValue.toFixed(2)}`);
    console.log(`   $${usdValue.toFixed(2)} = ${strkAmount.toFixed(6)} STRK`);
    console.log(`   ${strkAmount.toFixed(6)} STRK = ${strkWei.toString()} wei`);
    
    console.log('\n✅ Price API working correctly!');
    
  } catch (error) {
    console.error('❌ Error testing price API:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testPriceAPI();