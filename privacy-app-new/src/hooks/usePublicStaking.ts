import { useCallback, useEffect, useMemo, useState } from 'react';
import { Contract, RpcProvider } from 'starknet';

const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/LOIuv6FM2_iaC8ZCb1Omu';
const DECIMALS = 18n;
const TEN = 10n;

const provider = new RpcProvider({ nodeUrl: RPC_URL });

const STAKING_ABI = [
  {
    name: 'stake',
    type: 'function',
    inputs: [
      { name: 'strk_amount', type: 'core::integer::u256' },
      { name: 'min_sp_strk_out', type: 'core::integer::u256' }
    ],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'external'
  },
  {
    name: 'request_unlock',
    type: 'function',
    inputs: [
      { name: 'sp_strk_amount', type: 'core::integer::u256' },
      { name: 'min_strk_out', type: 'core::integer::u256' }
    ],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'external'
  },
  {
    name: 'claim_unlock',
    type: 'function',
    inputs: [{ name: 'request_index', type: 'core::integer::u256' }],
    outputs: [],
    state_mutability: 'external'
  },
  {
    name: 'cancel_unlock',
    type: 'function',
    inputs: [{ name: 'request_index', type: 'core::integer::u256' }],
    outputs: [],
    state_mutability: 'external'
  },
  {
    name: 'get_stats',
    type: 'function',
    inputs: [],
    outputs: [{
      type: '(core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u16, core::integer::u16)'
    }],
    state_mutability: 'view'
  },
  {
    name: 'get_exchange_rate',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view'
  },
  {
    name: 'get_unlock_request_count',
    type: 'function',
    inputs: [{ name: 'user', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view'
  },
  {
    name: 'get_unlock_request',
    type: 'function',
    inputs: [
      { name: 'user', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'request_index', type: 'core::integer::u256' }
    ],
    outputs: [
      { type: '(core::integer::u256, core::integer::u256, core::integer::u64, core::integer::u64)' },
      { type: 'core::integer::u256' },
      { type: 'core::bool' },
      { type: 'core::bool' }
    ],
    state_mutability: 'view'
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view'
  }
];

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view'
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' }
    ],
    outputs: [{ type: 'core::bool' }],
    state_mutability: 'external'
  }
];

const formatU256 = (value: any, decimals = 4) => {
  if (!value) return '0';
  const bigint = toBigInt(value);
  const num = Number(bigint) / 10 ** Number(DECIMALS);
  // Floor to avoid displaying more than actual balance
  const factor = 10 ** decimals;
  return (Math.floor(num * factor) / factor).toFixed(decimals);
};

const toBigInt = (value: any): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') return BigInt(value);
  if (value && typeof value === 'object' && 'low' in value && 'high' in value) {
    const low = BigInt(value.low);
    const high = BigInt(value.high);
    return (high << 128n) + low;
  }
  return BigInt(0);
};

const parseAmountToWei = (value: string): bigint => {
  if (!value) return 0n;
  const [wholePart, fractionPart = ''] = value.split('.');
  const sanitizedWhole = wholePart.replace(/[^0-9]/g, '') || '0';
  const sanitizedFraction = fractionPart.replace(/[^0-9]/g, '');
  const fractionPadded = (sanitizedFraction + '0'.repeat(Number(DECIMALS)))
    .slice(0, Number(DECIMALS));
  return BigInt(sanitizedWhole) * (TEN ** DECIMALS) + BigInt(fractionPadded || '0');
};

const toU256 = (value: bigint) => {
  const low = value & ((1n << 128n) - 1n);
  const high = value >> 128n;
  return { low: low.toString(), high: high.toString() };
};

const ZERO_U256 = { low: '0', high: '0' };

export interface PublicStats {
  totalPooled: string;
  totalSupply: string;
  exchangeRate: string;
  contractBalance: string;
  userBalance: string;
  userSpBalance: string;
}

export interface PublicUnlockRequest {
  index: number;
  spStrkAmount: string;
  strkAmount: string;
  unlockTime: number;
  expiryTime: number;
  isReady: boolean;
  isExpired: boolean;
}

export function usePublicStaking(
  contractAddress: string,
  walletAccount: any | null,
  walletAddress?: string
) {
  const stakingReader = useMemo(() => new Contract({ abi: STAKING_ABI, address: contractAddress, providerOrAccount: provider }), [contractAddress]);
  const spTokenReader = useMemo(() => new Contract({ abi: ERC20_ABI, address: contractAddress, providerOrAccount: provider }), [contractAddress]);
  const strkReader = useMemo(() => new Contract({ abi: ERC20_ABI, address: STRK_TOKEN_ADDRESS, providerOrAccount: provider }), []);

  const stakingWriter = useMemo(() => (
    walletAccount ? new Contract({ abi: STAKING_ABI, address: contractAddress, providerOrAccount: walletAccount }) : null
  ), [walletAccount, contractAddress]);
  const strkWriter = useMemo(() => (
    walletAccount ? new Contract({ abi: ERC20_ABI, address: STRK_TOKEN_ADDRESS, providerOrAccount: walletAccount }) : null
  ), [walletAccount]);

  const [stats, setStats] = useState<PublicStats>({
    totalPooled: '0.00',
    totalSupply: '0.00',
    exchangeRate: '1.000000',
    contractBalance: '0.00',
    userBalance: '0.00',
    userSpBalance: '0.00'
  });
  const [unlockRequest, setUnlockRequest] = useState<PublicUnlockRequest | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const contractStats = await stakingReader.get_stats();
      setStats(prev => ({
        ...prev,
        totalPooled: formatU256(contractStats[0], 2),
        totalSupply: formatU256(contractStats[1], 2),
        exchangeRate: formatU256(contractStats[2], 6),
        contractBalance: formatU256(contractStats[3], 2)
      }));

      if (walletAddress) {
        const strkBal = await strkReader.balanceOf(walletAddress);
        const spBal = await spTokenReader.balanceOf(walletAddress);

        setStats(prev => ({
          ...prev,
          userBalance: formatU256(strkBal, 4),
          userSpBalance: formatU256(spBal, 4)
        }));

        const requestCountResponse = await stakingReader.get_unlock_request_count(walletAddress);
        const requestCount = toBigInt(requestCountResponse);
        if (requestCount > 0n) {
          const response = await stakingReader.get_unlock_request(walletAddress, ZERO_U256);
          const unlockTuple = response[0];
          const strkAmount = response[1];
          const isReady = response[2];
          const isExpired = response[3];

          const parsedRequest: PublicUnlockRequest = {
            index: 0,
            spStrkAmount: formatU256(unlockTuple[0], 4),
            strkAmount: formatU256(strkAmount, 4),
            unlockTime: Number(unlockTuple[2] || 0),
            expiryTime: Number(unlockTuple[3] || 0),
            isReady: Boolean(isReady),
            isExpired: Boolean(isExpired)
          };
          setUnlockRequest(parsedRequest);
        } else {
          setUnlockRequest(null);
        }
      } else {
        setUnlockRequest(null);
        setStats(prev => ({ ...prev, userBalance: '0.00', userSpBalance: '0.00' }));
      }
    } catch (error) {
      console.error('Failed to fetch public stats', error);
    }
  }, [stakingReader, strkReader, spTokenReader, walletAddress]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const ensureWallet = () => {
    if (!stakingWriter || !strkWriter) {
      throw new Error('Please connect a Starknet wallet first');
    }
  };

  const stake = useCallback(async (amount: string) => {
    ensureWallet();
    const amountWei = parseAmountToWei(amount);
    if (amountWei <= 0n) throw new Error('Enter a valid amount');

    setLoading(true);
    try {
      const approveTx = await strkWriter!.approve(contractAddress, toU256(amountWei));
      await provider.waitForTransaction(approveTx.transaction_hash);

      // Let contract calculate output - set minOut to 0 (no slippage protection for hackathon)
      const stakeTx = await stakingWriter!.stake(toU256(amountWei), ZERO_U256);
      await provider.waitForTransaction(stakeTx.transaction_hash);
      await fetchStats();
      return stakeTx.transaction_hash;
    } finally {
      setLoading(false);
    }
  }, [contractAddress, fetchStats, stakingWriter, strkWriter]);

  const requestUnlock = useCallback(async (spAmount: string) => {
    ensureWallet();
    const amountWei = parseAmountToWei(spAmount);
    if (amountWei <= 0n) throw new Error('Enter a valid amount');

    setLoading(true);
    try {
      // Let contract calculate output - set minOut to 0 (no slippage protection for hackathon)
      const tx = await stakingWriter!.request_unlock(toU256(amountWei), ZERO_U256);
      await provider.waitForTransaction(tx.transaction_hash);
      await fetchStats();
      return tx.transaction_hash;
    } finally {
      setLoading(false);
    }
  }, [fetchStats, stakingWriter]);

  const claimUnlock = useCallback(async () => {
    ensureWallet();
    setLoading(true);
    try {
      const tx = await stakingWriter!.claim_unlock(ZERO_U256);
      await provider.waitForTransaction(tx.transaction_hash);
      await fetchStats();
      return tx.transaction_hash;
    } finally {
      setLoading(false);
    }
  }, [fetchStats, stakingWriter]);

  const cancelUnlock = useCallback(async () => {
    ensureWallet();
    setLoading(true);
    try {
      const tx = await stakingWriter!.cancel_unlock(ZERO_U256);
      await provider.waitForTransaction(tx.transaction_hash);
      await fetchStats();
      return tx.transaction_hash;
    } finally {
      setLoading(false);
    }
  }, [fetchStats, stakingWriter]);

  return {
    stats,
    unlockRequest,
    loading,
    stake,
    requestUnlock,
    claimUnlock,
    cancelUnlock,
    refresh: fetchStats
  };
}
