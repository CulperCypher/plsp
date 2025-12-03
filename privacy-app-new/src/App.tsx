import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import './App.css'
import { ProofState, ProofStateData } from './types'
import { Noir } from "@noir-lang/noir_js";
import { DebugFileMap } from "@noir-lang/types";
import { UltraHonkBackend } from "@aztec/bb.js";
import { flattenFieldsAsArray } from "./helpers/proof";
import { getHonkCallData, init } from 'garaga';
import { bytecode, abi } from "./assets/circuit.json";
import { bytecode as unlockBytecode, abi as unlockAbi } from "../../circuits/private_unlocks/target/private_unlocks.json";
import depositVkUrl from './assets/deposit_vk.bin?url';
import unlockVkUrl from './assets/unlock_vk.bin?url';
import { RpcProvider, Contract, hash as starknetHash } from 'starknet';
import { abi as verifierAbi } from "./assets/verifier.json";
import { connect } from '@starknet-io/get-starknet';
import initNoirC from "@noir-lang/noirc_abi";
import initACVM from "@noir-lang/acvm_js";
import acvm from "@noir-lang/acvm_js/web/acvm_js_bg.wasm?url";
import noirc from "@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url";
// @ts-ignore - no types for circomlibjs
import { buildPoseidon } from 'circomlibjs';
import { usePublicStaking } from './hooks/usePublicStaking';
import { useToast } from './components/Toast/ToastContext';

// Contract addresses
const SPSTRK_ADDRESS = '0x05efc624f4f0afb75bd6a57b35a0d2fb270c6eb0cea0e3f7dc36aefe9681e509';
const DEPOSIT_VERIFIER_ADDRESS = '0x039fbb068b510e5528eeea74a51c5ffa6e7c8278acddcf3f6ad628bd9d16c0d5';
const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'; // Sepolia STRK
const ZEC_BRIDGE_ADDRESS = 'utest1qp6yjdhx2srg4lkphwaacmgsw8amz5dtte3rx2v5nrp8r6wlq7tplchna7esw0lghnr46cwqj2pele2a0tf0fuws7pp2qu2vfrj4t0d4tueq5wcw56mw5mpwu0x6aqe67tjwt99erelah630qx2zefn2jvywgzrthth3lfhv8y2mfheheddcd8pqyrkl2ekacllqdzevy5xazk6hnh0';
const STRK_DECIMALS = 18n;
const TEN = 10n;
const U128_MASK = (1n << 128n) - 1n;

// Fixed denomination for privacy pool (Tornado Cash style)
// All private deposits/withdrawals are exactly 10 spSTRK
const PRIVACY_DENOMINATION = '10'; // 10 spSTRK
const PRIVACY_DENOMINATION_WEI = '10000000000000000000'; // 10 * 10^18

// Default STRK amount to deposit (should convert to ~10 spSTRK)
// This is an estimate - actual rate varies. Contract validates 10-10.5 spSTRK range.
const DEFAULT_STRK_FOR_PRIVACY = '12'; // ~12 STRK should cover 10 spSTRK with margin

const strkToWei = (value: string): string => {
  if (!value) return '0';
  const [wholePart, fractionPart = ''] = value.split('.');
  const sanitizedWhole = (wholePart.replace(/[^0-9]/g, '') || '0');
  const sanitizedFraction = fractionPart.replace(/[^0-9]/g, '');
  const paddedFraction = (sanitizedFraction + '0'.repeat(Number(STRK_DECIMALS))).slice(0, Number(STRK_DECIMALS));
  try {
    const wei = BigInt(sanitizedWhole) * (TEN ** STRK_DECIMALS) + BigInt(paddedFraction || '0');
    return wei.toString();
  } catch {
    return '0';
  }
};

const weiToStrk = (value: string): string => {
  if (!value) return '0';
  try {
    const wei = BigInt(value);
    const whole = wei / (TEN ** STRK_DECIMALS);
    const fraction = wei % (TEN ** STRK_DECIMALS);
    const fractionStr = fraction.toString().padStart(Number(STRK_DECIMALS), '0').replace(/0+$/, '');
    return fractionStr ? `${whole}.${fractionStr.slice(0, 6)}` : whole.toString();
  } catch {
    return '0';
  }
};

const toU256 = (value: string) => {
  const bigVal = BigInt(value);
  const low = bigVal & U128_MASK;
  const high = bigVal >> 128n;
  return { low: low.toString(), high: high.toString() };
};

const lifecycleSteps = [
  {
    title: '1. Deposit',
    description: 'Choose public speed or privacy-protected deposit. Both mint the same spSTRK receipt tokens.'
  },
  {
    title: '2. Receive spSTRK',
    description: 'spSTRK is fully fungible.  Claim with privacy enabled or swap publicly the choice is yours'
  },
  {
    title: '3. Auto-delegation',
    description: 'Your STRK is delegated to our validator pool immediately, letting it earn continuously.'
  },
  {
    title: '4. Unlock / burn',
    description: 'Request an unlock publicly or generate a private withdrawal proof for private withdrawal of either spSTRK or STRK'
  },
  {
    title: '5. Withdraw STRK',
    description: 'Redeem STRK or spSTRK to any address. Withdrawals stay private via the Merkle tree + Noir proof.'
  }
];

// Merkle indexer URL (for fetching Merkle paths for unlock proofs)
const INDEXER_URL = 'http://65.108.206.214:4000'; // TODO: Update to your server IP

// Minimal ABI for spSTRK contract
const spStrkAbi = [
  {
    "name": "mark_deposit_intent",
    "type": "function",
    "inputs": [{ "name": "amount", "type": "core::integer::u256" }],
    "outputs": [],
    "state_mutability": "external"
  },
  {
    "name": "create_private_commitment",
    "type": "function", 
    "inputs": [
      { "name": "proof", "type": "core::array::Span::<core::felt252>" },
      { "name": "commitment", "type": "core::integer::u256" },
      { "name": "strk_amount", "type": "core::integer::u256" }
    ],
    "outputs": [],
    "state_mutability": "external"
  },
  {
    "name": "claim_spSTRK",
    "type": "function",
    "inputs": [
      { "name": "proof", "type": "core::array::Span::<core::felt252>" },
      { "name": "nullifier", "type": "core::integer::u256" },
      { "name": "recipient", "type": "core::starknet::contract_address::ContractAddress" }
    ],
    "outputs": [],
    "state_mutability": "external"
  },
  {
    "name": "request_private_unlock",
    "type": "function",
    "inputs": [
      { "name": "proof", "type": "core::array::Span::<core::felt252>" },
      { "name": "nullifier_hash", "type": "core::integer::u256" }
    ],
    "outputs": [],
    "state_mutability": "external"
  },
  {
    "name": "complete_private_withdraw",
    "type": "function",
    "inputs": [
      { "name": "proof", "type": "core::array::Span::<core::felt252>" },
      { "name": "nullifier", "type": "core::integer::u256" },
      { "name": "recipient", "type": "core::starknet::contract_address::ContractAddress" }
    ],
    "outputs": [],
    "state_mutability": "external"
  },
  {
    "name": "private_deposit",
    "type": "function",
    "inputs": [
      { "name": "strk_amount", "type": "core::integer::u256" },
      { "name": "commitment", "type": "core::integer::u256" }
    ],
    "outputs": [],
    "state_mutability": "external"
  },
  {
    "name": "create_commitment",
    "type": "function",
    "inputs": [
      { "name": "strk_amount", "type": "core::integer::u256" },
      { "name": "commitment", "type": "core::integer::u256" },
      { "name": "blinding", "type": "core::felt252" }
    ],
    "outputs": [{ "type": "core::integer::u256" }],
    "state_mutability": "external"
  }
];

// Minimal ERC20 ABI for approve
const erc20Abi = [
  {
    "name": "approve",
    "type": "function",
    "inputs": [
      { "name": "spender", "type": "core::starknet::contract_address::ContractAddress" },
      { "name": "amount", "type": "core::integer::u256" }
    ],
    "outputs": [{ "type": "core::bool" }],
    "state_mutability": "external"
  }
];

function App() {
  const [proofState, setProofState] = useState<ProofStateData>({
    state: ProofState.Initial
  });
  const [vk, setVk] = useState<Uint8Array | null>(null);
  const [unlockVk, setUnlockVk] = useState<Uint8Array | null>(null);
  
  // Wallet state
  const { success: toastSuccess, error: toastError, warning: toastWarning, info: toastInfo } = useToast();
  const notifySuccess = (message: string, txHash?: string) => toastSuccess(message, { txHash });
  const notifyError = (message: string) => toastError(message);
  const notifyWarning = (message: string) => toastWarning(message);
  const notifyInfo = (message: string) => toastInfo(message);

  const [wallet, setWallet] = useState<any>(null);
  const getActionLabel = (label: string, options?: { loading?: boolean; loadingLabel?: string }) => {
    if (options?.loading) return options.loadingLabel ?? 'Submitting…';
    return wallet ? label : 'Connect wallet';
  };
  const [walletAddress, setWalletAddress] = useState<string>('');
  
  // Deposit flow step (1 = mark intent, 2 = create commitment)
  const [depositStep, setDepositStep] = useState<number>(0);
  const [intentMarked, setIntentMarked] = useState<boolean>(false);
  
  // Deposit mode: 'single' (secure) or 'two-step' (experimental privacy)
  const [depositMode, setDepositMode] = useState<'single' | 'two-step'>('single');
  
  // Private inputs (witness)
  const [secret, setSecret] = useState<string>('');
  // amount = STRK to deposit (should convert to ~10 spSTRK)
  const [amount, setAmount] = useState<string>(DEFAULT_STRK_FOR_PRIVACY);
  // shares is always fixed at 10 spSTRK - not user-editable
  const [_shares, _setShares] = useState<string>(PRIVACY_DENOMINATION);
  const [blinding, setBlinding] = useState<string>('');

  // Computed commitment (will be calculated from inputs)
  const [commitment, setCommitment] = useState<string>('');
  const [depositTime, setDepositTime] = useState<string>('');

  const amountWei = useMemo(() => strkToWei(amount || '0'), [amount]);
  // Fixed denomination: always 10 spSTRK for privacy
  const sharesWei = PRIVACY_DENOMINATION_WEI;

  // Use a ref to reliably track the current state across asynchronous operations
  const currentStateRef = useRef<ProofState>(ProofState.Initial);
  
  // Generated proof data (stored between steps)
  const [_generatedProof, setGeneratedProof] = useState<bigint[] | null>(null);
  
  // Withdraw flow state (shares fixed at 10 spSTRK)
  const [withdrawSecret, setWithdrawSecret] = useState<string>('');
  const [withdrawBlinding, setWithdrawBlinding] = useState<string>('');
  const [withdrawRecipient, setWithdrawRecipient] = useState<string>('');

  const [publicStakeAmount, setPublicStakeAmount] = useState('');
  const [publicUnlockAmount, setPublicUnlockAmount] = useState('');
  const [stakeMode, setStakeMode] = useState<'standard' | 'privacy'>('privacy');
  const [withdrawTab, setWithdrawTab] = useState<'standard' | 'private'>('private');
  const [privateWithdrawMode, setPrivateWithdrawMode] = useState<'strk' | 'spstrk'>('spstrk');
  const [activeSection, setActiveSection] = useState('section-getting-started');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bridgePrices, setBridgePrices] = useState<{ zec: number; strk: number }>({ zec: 430, strk: 0.125 });

  const starknetAccount = wallet?.account ?? null;
  const {
    stats: publicStats,
    unlockRequest: publicUnlockRequest,
    loading: publicLoading,
    stake: publicStake,
    requestUnlock: publicRequestUnlock,
    claimUnlock: publicClaimUnlock,
    cancelUnlock: publicCancelUnlock,
    refresh: refreshPublicStats
  } = usePublicStaking(SPSTRK_ADDRESS, starknetAccount, walletAddress || undefined);

  // Calculate exact STRK needed for 10 spSTRK based on current exchange rate
  const strkNeededFor10SpStrk = useMemo(() => {
    const rate = parseFloat(publicStats.exchangeRate || '1');
    // Add 2% buffer to ensure we're above minimum
    return (10 * rate * 1.02).toFixed(4);
  }, [publicStats.exchangeRate]);

  // Fetch ZEC/STRK prices for bridge calculation
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=zcash,starknet&vs_currencies=usd');
        const data = await response.json();
        if (data.zcash?.usd && data.starknet?.usd) {
          setBridgePrices({ zec: data.zcash.usd, strk: data.starknet.usd });
        }
      } catch (error) {
        console.warn('Could not fetch prices, using defaults');
      }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  // Calculate ZEC needed for bridge deposit
  const zecNeededForBridge = useMemo(() => {
    const strkAmount = parseFloat(strkNeededFor10SpStrk);
    const usdValue = strkAmount * bridgePrices.strk;
    const zecAmount = usdValue / bridgePrices.zec;
    return zecAmount.toFixed(8);
  }, [strkNeededFor10SpStrk, bridgePrices]);

  // Auto-set default amount when exchange rate loads
  useEffect(() => {
    if (publicStats.exchangeRate && publicStats.exchangeRate !== '1.000000' && !commitment) {
      setAmount(strkNeededFor10SpStrk);
    }
  }, [strkNeededFor10SpStrk, publicStats.exchangeRate, commitment]);

  interface NavItem {
    id: string;
    label: string;
    children?: NavItem[];
  }

  const navItems = useMemo<NavItem[]>(() => ([
    { id: 'section-getting-started', label: 'Getting Started' },
    {
      id: 'section-stake-group',
      label: 'Stake',
      children: [
        { id: 'section-stake-privacy', label: 'Privacy staking' },
        { id: 'section-stake-standard', label: 'Standard staking' }
      ]
    },
    {
      id: 'section-withdraw-group',
      label: 'Withdraw',
      children: [
        { id: 'section-withdraw-privacy', label: 'Private withdrawal' },
        { id: 'section-withdraw-standard', label: 'Standard withdrawal' }
      ]
    },
    {
      id: 'section-bridge-group',
      label: 'Bridge',
      children: [
        { id: 'section-zcash', label: 'Zcash bridge' }
      ]
    }
  ]), []);

  const statusCards = useMemo(() => {
    const unlockSummary = publicUnlockRequest
      ? `${publicUnlockRequest.spStrkAmount} spSTRK → ${publicUnlockRequest.strkAmount} STRK`
      : 'No pending unlocks';
    return [
      {
        label: 'Total pooled STRK',
        value: `${publicStats.totalPooled} STRK`,
        helper: 'Auto delegated to validator pool on deposit.'
      },
      {
        label: 'spSTRK supply',
        value: `${publicStats.totalSupply} spSTRK`,
        helper: 'Fungible receipts usable in both public & private exits.'
      },
      {
        label: 'Exchange rate',
        value: `1 spSTRK = ${publicStats.exchangeRate} STRK`,
        helper: 'Updates with pool performance.'
      },
      {
        label: 'Unlock queue',
        value: unlockSummary,
        helper: publicUnlockRequest ? (publicUnlockRequest.isReady ? 'Ready to claim now.' : 'Unlock ticking...') : 'Request unlock anytime.'
      },
      {
        label: 'Indexer service',
        value: 'Online',
        helper: `Merkle roots synced via ${INDEXER_URL.replace(/^https?:\/\//, '')}`
      }
    ];
  }, [publicStats, publicUnlockRequest]);

  const handleNavClick = (id: string) => {
    // Reset inputs when switching sections to avoid data leaking between pages
    if (id !== activeSection) {
      // Reset deposit inputs
      setSecret('');
      setBlinding('');
      setCommitment('');
      setDepositTime('');
      setDepositStep(0);
      setIntentMarked(false);
      // Reset withdraw inputs
      setWithdrawSecret('');
      setWithdrawBlinding('');
      setWithdrawRecipient('');
      // Reset proof state
      currentStateRef.current = ProofState.Initial;
      setProofState({ state: ProofState.Initial, error: undefined });
    }

    if (id === 'section-withdraw-standard') {
      setWithdrawTab('standard');
    } else if (id === 'section-withdraw-privacy') {
      setWithdrawTab('private');
    }

    if (id === 'section-stake-standard') {
      setStakeMode('standard');
    } else if (id === 'section-stake-privacy') {
      setStakeMode('privacy');
    }

    if (window.innerWidth < 992) {
      setSidebarOpen(false);
    }

    setActiveSection(id);
  };

  // Simplified memo format: 02:commitment (amount calculated by relayer)
  const memoPreview = useMemo(() => {
    if (!commitment) return '';
    const actionFlag = '02';
    return `${actionFlag}:${commitment}`;
  }, [commitment]);

  const resetNoteInputs = () => {
    // Reset deposit inputs
    setSecret('');
    setBlinding('');
    setCommitment('');
    setDepositTime('');
    setAmount(strkNeededFor10SpStrk); // Reset to calculated amount
    // Reset deposit flow state
    setDepositStep(0);
    setIntentMarked(false);
    // Reset proof state
    currentStateRef.current = ProofState.Initial;
    setProofState({ state: ProofState.Initial, error: undefined });
  };

  const resetWithdrawInputs = () => {
    // Reset withdraw inputs
    setWithdrawSecret('');
    setWithdrawBlinding('');
    setWithdrawRecipient('');
    setDepositTime('');
    // Reset proof state
    currentStateRef.current = ProofState.Initial;
    setProofState({ state: ProofState.Initial, error: undefined });
  };

  // Initialize WASM on component mount
  useEffect(() => {
    const initWasm = async () => {
      try {
        // This might have already been initialized in main.tsx,
        // but we're adding it here as a fallback
        if (typeof window !== 'undefined') {
          await Promise.all([initACVM(fetch(acvm)), initNoirC(fetch(noirc))]);
          console.log('WASM initialization in App component complete');
        }
      } catch (error) {
        console.error('Failed to initialize WASM in App component:', error);
      }
    };

    const loadVk = async () => {
      const response = await fetch(depositVkUrl);
      const arrayBuffer = await response.arrayBuffer();
      const binaryData = new Uint8Array(arrayBuffer);
      setVk(binaryData);
      console.log('Loaded deposit verifying key:', binaryData);
    };

    const loadUnlockVk = async () => {
      const response = await fetch(unlockVkUrl);
      const arrayBuffer = await response.arrayBuffer();
      const binaryData = new Uint8Array(arrayBuffer);
      setUnlockVk(binaryData);
      console.log('Loaded unlock verifying key:', binaryData);
    };
    
    initWasm();
    loadVk();
    loadUnlockVk();
  }, []);

  const resetState = () => {
    currentStateRef.current = ProofState.Initial;
    setProofState({ 
      state: ProofState.Initial,
      error: undefined 
    });
  };

  const handleError = (error: unknown) => {
    console.error('Error:', error);
    let errorMessage: string;
    
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error !== null && error !== undefined) {
      // Try to convert any non-Error object to a string
      try {
        errorMessage = String(error);
      } catch {
        errorMessage = 'Unknown error (non-stringifiable object)';
      }
    } else {
      errorMessage = 'Unknown error occurred';
    }
    
    // Use the ref to get the most recent state
    setProofState({
      state: currentStateRef.current,
      error: errorMessage
    });
    notifyError(errorMessage || 'Unexpected error');
  };

  const updateState = (newState: ProofState) => {
    currentStateRef.current = newState;
    setProofState({ state: newState, error: undefined });
  };

  // Generate random values for secret and blinding
  const generateRandomValues = () => {
    // Generate cryptographically secure random values
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const randomSecret = BigInt('0x' + Array.from(array.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')).toString();
    
    crypto.getRandomValues(array);
    const randomBlinding = BigInt('0x' + Array.from(array.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')).toString();
    
    setSecret(randomSecret);
    setBlinding(randomBlinding);
    setDepositTime(Math.floor(Date.now() / 1000).toString());
  };

  // Compute commitment using Poseidon hash (matching Noir circuit structure)
  const computeCommitment = async () => {
    if (!secret || !blinding || !amount) {
      notifyWarning('Generate secret + blinding first.');
      return;
    }
    
    try {
      const time = depositTime || Math.floor(Date.now() / 1000).toString();
      setDepositTime(time);
      
      // Build Poseidon hasher (uses BN254 field like Noir)
      const poseidon = await buildPoseidon();
      
      // Match the Noir circuit structure:
      // h1 = hash_2([secret, shares])
      // h2 = hash_2([h1, deposit_time])
      // commitment = hash_2([h2, blinding])
      
      const secretBigInt = BigInt(secret);
      const sharesBigInt = BigInt(sharesWei);
      const timeBigInt = BigInt(time);
      const blindingBigInt = BigInt(blinding);
      
      console.log('Computing Poseidon hash with chained structure:');
      console.log('secret:', secretBigInt);
      console.log('shares:', sharesBigInt);
      console.log('time:', timeBigInt);
      console.log('blinding:', blindingBigInt);
      
      // Step 1: h1 = poseidon([secret, shares])
      const h1 = poseidon([secretBigInt, sharesBigInt]);
      const h1BigInt = BigInt(poseidon.F.toString(h1));
      console.log('h1 (secret, shares):', h1BigInt);
      
      // Step 2: h2 = poseidon([h1, deposit_time])
      const h2 = poseidon([h1BigInt, timeBigInt]);
      const h2BigInt = BigInt(poseidon.F.toString(h2));
      console.log('h2 (h1, time):', h2BigInt);
      
      // Step 3: commitment = poseidon([h2, blinding])
      const commitmentHash = poseidon([h2BigInt, blindingBigInt]);
      const commitmentStr = poseidon.F.toString(commitmentHash);
      
      console.log('Computed commitment:', commitmentStr);
      setCommitment(commitmentStr);
      
      notifySuccess('Commitment computed! Save your note before depositing.');
      
    } catch (error) {
      console.error('Error computing commitment:', error);
      notifyError('Error computing commitment: ' + (error as Error).message);
    }
  };

  // Generate note string for user to save
  const generateNote = (): string => {
    const time = depositTime || Math.floor(Date.now() / 1000).toString();
    return `sparrow:${amountWei}:${secret}:${blinding}:${time}:${sharesWei}:${commitment}`;
  };

  // Fetch Merkle path from indexer for unlock proofs
  const fetchMerklePath = async (commitment: string): Promise<{leaf_index: number, siblings: string[], root: string}> => {
    const response = await fetch(`${INDEXER_URL}/path/commitment/${commitment}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Failed to fetch Merkle path: ${error.error || response.statusText}`);
    }
    return response.json();
  };

  // Parse note string
  const parseNote = (note: string) => {
    const parts = note.split(':');
    if (parts[0] !== 'sparrow' || parts.length < 5) {
      notifyError('Invalid note format.');
      return;
    }
    setAmount(weiToStrk(parts[1] || '0'));
    setSecret(parts[2]);
    setBlinding(parts[3]);
    setDepositTime(parts[4]);
    // parts[5] was shares - now fixed at 10 spSTRK, ignore legacy notes
    if (parts[6]) setCommitment(parts[6]);
  };

  // Download note as file
  const downloadNote = () => {
    if (!secret || !blinding) {
      notifyWarning('Generate secret + blinding first.');
      return;
    }
    const note = generateNote();
    const blob = new Blob([note], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sparrow-deposit-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Copy note to clipboard
  const copyNote = () => {
    if (!secret || !blinding) {
      alert('Please generate secret and blinding first');
      return;
    }
    const note = generateNote();
    navigator.clipboard.writeText(note);
    notifySuccess('Note copied! Save it securely to withdraw later.');
  };

  // Connect wallet
  const connectWallet = async () => {
    try {
      const starknet = await connect() as any;
      if (starknet) {
        await starknet.enable();
        setWallet(starknet);
        const address = starknet.account?.address || starknet.selectedAddress || '';
        setWalletAddress(address);
        console.log('Wallet connected:', address);
      }
    } catch (error) {
      handleError(error);
    }
  };

  // Step 1: Mark deposit intent (transfers STRK to contract)
  const markDepositIntent = async () => {
    if (!wallet) {
      notifyWarning('Connect your wallet first.');
      return;
    }
    
    try {
      updateState(ProofState.ConnectingWallet);
      
      const strkToken = new Contract({ abi: erc20Abi, address: STRK_TOKEN_ADDRESS, providerOrAccount: wallet.account });
      const spStrkContract = new Contract({ abi: spStrkAbi, address: SPSTRK_ADDRESS, providerOrAccount: wallet.account });
      
      // Approve STRK spend
      updateState(ProofState.SendingTransaction);
      console.log('Approving STRK spend...');
      if (amountWei === '0') {
        notifyWarning('Enter an amount greater than 0.');
        resetState();
        return;
      }
      const amountU256 = toU256(amountWei);
      const approveTx = await strkToken.approve(SPSTRK_ADDRESS, amountU256);
      await wallet.account.waitForTransaction(approveTx.transaction_hash);
      console.log('Approval confirmed');
      
      // Mark deposit intent
      console.log('Marking deposit intent...');
      const intentTx = await spStrkContract.mark_deposit_intent(amountU256);
      await wallet.account.waitForTransaction(intentTx.transaction_hash);
      console.log('Deposit intent marked!');
      
      setIntentMarked(true);
      setDepositStep(1);
      setDepositTime(Math.floor(Date.now() / 1000).toString());
      
      notifySuccess('Step 1 complete! STRK transferred. Generate proof next.');
      resetState();
    } catch (error) {
      handleError(error);
    }
  };

  // Single-step private deposit (RECOMMENDED - no front-running risk)
  const privateDeposit = async () => {
    if (!wallet) {
      notifyWarning('Connect your wallet first.');
      return;
    }
    if (!secret || !blinding) {
      notifyWarning('Generate secret + blinding first.');
      return;
    }
    if (!commitment) {
      notifyWarning('Compute commitment first.');
      return;
    }
    
    try {
      updateState(ProofState.ConnectingWallet);
      
      const strkToken = new Contract({ abi: erc20Abi, address: STRK_TOKEN_ADDRESS, providerOrAccount: wallet.account });
      const spStrkContract = new Contract({ abi: spStrkAbi, address: SPSTRK_ADDRESS, providerOrAccount: wallet.account });

      if (amount === '0') {
        notifyWarning('Enter an amount greater than 0.');
        resetState();
        return;
      }
      const amountU256 = toU256(strkToWei(amount));
      // Approve STRK spend
      updateState(ProofState.SendingTransaction);
      console.log('Approving STRK spend...');
      const approveTx = await strkToken.approve(SPSTRK_ADDRESS, amountU256);
      await wallet.account.waitForTransaction(approveTx.transaction_hash);
      console.log('Approval confirmed');
      
      // Single-step deposit (no proof needed!)
      console.log('Calling private_deposit...');
      console.log('Amount:', amountU256);
      console.log('Commitment:', toU256(commitment));
      
      const depositTx = await spStrkContract.private_deposit(
        amountU256,
        toU256(commitment)
      );
      await wallet.account.waitForTransaction(depositTx.transaction_hash);
      console.log('Private deposit complete!');
      
      setDepositStep(2);
      updateState(ProofState.ProofVerified);
      
      notifySuccess('Private deposit complete! Save your note to withdraw later.');
    } catch (error) {
      handleError(error);
    }
  };

  // Public staking helpers
  const handlePublicStake = async () => {
    if (!publicStakeAmount) {
      notifyWarning('Enter an amount to stake.');
      return;
    }
    try {
      await publicStake(publicStakeAmount);
      setPublicStakeAmount('');
      notifySuccess('Stake submitted! You will receive spSTRK shortly.');
    } catch (error) {
      handleError(error);
    }
  };

  const handlePublicUnlock = async () => {
    if (!publicUnlockAmount) {
      notifyWarning('Enter spSTRK amount to unlock.');
      return;
    }
    try {
      await publicRequestUnlock(publicUnlockAmount);
      setPublicUnlockAmount('');
      notifyInfo('Unlock requested. Come back after unlock period to claim STRK.');
    } catch (error) {
      handleError(error);
    }
  };

  const handlePublicClaim = async () => {
    try {
      await publicClaimUnlock();
      notifySuccess('Unlocked STRK claimed.');
    } catch (error) {
      handleError(error);
    }
  };

  const handlePublicCancel = async () => {
    try {
      await publicCancelUnlock();
      notifyInfo('Unlock request cancelled.');
    } catch (error) {
      handleError(error);
    }
  };

  const renderPublicCard = (mode: 'both' | 'stake' | 'withdraw' = 'both') => {
    const showStakeForm = mode !== 'withdraw';
    const showUnlockForm = mode !== 'stake';
    const title = showStakeForm && !showUnlockForm
      ? 'Public STRK staking'
      : !showStakeForm && showUnlockForm
        ? 'Public spSTRK unlocks'
        : 'Public STRK staking & unlocks';
    const subtitle = showStakeForm && !showUnlockForm
      ? 'Stake STRK to receive spSTRK using the standard ERC-4626 flow. Requests are visible on-chain.'
      : !showStakeForm && showUnlockForm
        ? 'Request unlocks and burn spSTRK for STRK transparently through the public queue.'
        : 'Stake and unlock STRK transparently. Perfect for demos and dashboards.';

    return (
      <div className="card public-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Traditional route</p>
            <h2>{title}</h2>
            <p className="card-subtitle">{subtitle}</p>
          </div>
          <button className="ghost-button" onClick={refreshPublicStats}>Refresh stats</button>
        </div>

        <div className="public-forms">
          {showStakeForm && (
            <div className="swap-box" style={{ background: 'var(--surface-1)', borderRadius: '16px', padding: '16px', border: '1px solid var(--border)' }}>
              {/* From Token */}
              <div className="swap-token-box" style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>You pay</span>
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>Balance: {publicStats.userBalance}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input
                    className="swap-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.0"
                    value={publicStakeAmount}
                    onChange={(e) => setPublicStakeAmount(e.target.value)}
                  />
                  <div style={{ background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold' }}>STRK</div>
                </div>
              </div>
              
              {/* Arrow */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '-12px 0', position: 'relative', zIndex: 1 }}>
                <div style={{ background: 'var(--surface-1)', border: '4px solid var(--background)', borderRadius: '12px', padding: '8px' }}>↓</div>
              </div>
              
              {/* To Token */}
              <div className="swap-token-box" style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>You receive</span>
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>Balance: {publicStats.userSpBalance}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input
                    className="swap-input"
                    type="text"
                    readOnly
                    value={publicStakeAmount && parseFloat(publicStakeAmount) > 0 
                      ? (parseFloat(publicStakeAmount) / parseFloat(publicStats.exchangeRate || '1')).toFixed(4)
                      : '0.0'}
                  />
                  <div style={{ background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold' }}>spSTRK</div>
                </div>
              </div>
              
              {/* Rate */}
              <div style={{ textAlign: 'center', fontSize: '12px', opacity: 0.6, margin: '12px 0' }}>
                1 spSTRK = {publicStats.exchangeRate} STRK • Unlock completes ~60 seconds after request
              </div>
              
              <button className="primary-button" onClick={handlePublicStake} disabled={publicLoading || !wallet} style={{ width: '100%' }}>
                {getActionLabel('Stake', { loading: publicLoading, loadingLabel: 'Submitting…' })}
              </button>
            </div>
          )}

          {showUnlockForm && (
            <div className="swap-box" style={{ background: 'var(--surface-1)', borderRadius: '16px', padding: '16px', border: '1px solid var(--border)' }}>
              {/* From Token */}
              <div className="swap-token-box" style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>You unstake</span>
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>Balance: {publicStats.userSpBalance}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input
                    className="swap-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.0"
                    value={publicUnlockAmount}
                    onChange={(e) => setPublicUnlockAmount(e.target.value)}
                  />
                  <div style={{ background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold' }}>spSTRK</div>
                </div>
              </div>
              
              {/* Arrow */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '-12px 0', position: 'relative', zIndex: 1 }}>
                <div style={{ background: 'var(--surface-1)', border: '4px solid var(--background)', borderRadius: '12px', padding: '8px' }}>↓</div>
              </div>
              
              {/* To Token */}
              <div className="swap-token-box" style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>You receive</span>
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>Balance: {publicStats.userBalance}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input
                    className="swap-input"
                    type="text"
                    readOnly
                    value={publicUnlockAmount && parseFloat(publicUnlockAmount) > 0 
                      ? (parseFloat(publicUnlockAmount) * parseFloat(publicStats.exchangeRate || '1')).toFixed(4)
                      : '0.0'}
                  />
                  <div style={{ background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold' }}>STRK</div>
                </div>
              </div>
              
              {/* Rate */}
              <div style={{ textAlign: 'center', fontSize: '12px', opacity: 0.6, margin: '12px 0' }}>
                1 spSTRK = {publicStats.exchangeRate} STRK
              </div>
              
              <button className="warning-button" onClick={handlePublicUnlock} disabled={publicLoading || !wallet} style={{ width: '100%' }}>
                {getActionLabel('Request Unlock', { loading: publicLoading, loadingLabel: 'Submitting…' })}
              </button>
            </div>
          )}
        </div>

        {showUnlockForm && (
          publicUnlockRequest ? (
            <div className="unlock-card">
              <div>
                <p className="stat-label">Pending unlock</p>
                <p className="stat-value">{publicUnlockRequest.spStrkAmount} spSTRK → {publicUnlockRequest.strkAmount} STRK</p>
              </div>
              <div className="unlock-meta">
                <span>Ready: {publicUnlockRequest.isReady ? 'Yes' : 'No'}</span>
                <span>Expires: {publicUnlockRequest.isExpired ? 'Expired' : new Date(publicUnlockRequest.expiryTime * 1000).toLocaleString()}</span>
              </div>
              <div className="action-row wrap">
                <button className="primary-button" onClick={handlePublicClaim} disabled={!wallet || !publicUnlockRequest.isReady || publicLoading}>
                  {getActionLabel('Claim STRK', { loading: publicLoading, loadingLabel: 'Claiming…' })}
                </button>
                <button className="ghost-button" onClick={handlePublicCancel} disabled={publicLoading || !wallet}>
                  {getActionLabel('Cancel unlock', { loading: publicLoading, loadingLabel: 'Cancelling…' })}
                </button>
              </div>
            </div>
          ) : (
            <p className="stat-label">No pending unlock requests.</p>
          )
        )}
      </div>
    );
  };

  // Step 2: Generate proof and create private commitment (LEGACY - two-step flow)
  const createPrivateCommitment = async () => {
    if (!wallet) {
      notifyWarning('Connect your wallet first.');
      return;
    }
    if (!intentMarked) {
      notifyWarning('Mark deposit intent first (Step 1).');
      return;
    }
    
    try {
      // Generate proof
      updateState(ProofState.GeneratingWitness);
      
      // IMPORTANT: Use the SAME timestamp that was used to compute the commitment!
      // The circuit asserts: witness.deposit_time == current_time
      const proofTime = depositTime || Math.floor(Date.now() / 1000).toString();
      
      // FIXED DENOMINATION: shares is always 10 spSTRK
      // Use actual pool stats from contract (convert formatted strings back to wei)
      const poolTotalAssets = strkToWei(publicStats.totalPooled || '0');
      const poolTotalSupply = strkToWei(publicStats.totalSupply || '0');
      
      const input = {
        witness: {
          secret: secret,
          amount: amountWei,
          shares: PRIVACY_DENOMINATION_WEI, // Fixed: 10 spSTRK
          deposit_time: proofTime,
          blinding: blinding
        },
        commitment: commitment,
        shares: PRIVACY_DENOMINATION_WEI, // Fixed: 10 spSTRK
        amount: amountWei,
        total_assets: poolTotalAssets,
        total_supply: poolTotalSupply,
        current_time: proofTime  // Must match deposit_time!
      };
      console.log('Circuit input:', input);
      
      let noir = new Noir({ bytecode, abi: abi as any, debug_symbols: '', file_map: {} as DebugFileMap });
      let execResult = await noir.execute(input);
      console.log('Witness generated:', execResult);
      
      updateState(ProofState.GeneratingProof);
      let honk = new UltraHonkBackend(bytecode, { threads: 1 });
      let proof = await honk.generateProof(execResult.witness, { starknet: true });
      honk.destroy();
      console.log('Proof generated:', proof);
      
      updateState(ProofState.PreparingCalldata);
      await init();
      const callData = getHonkCallData(
        proof.proof,
        flattenFieldsAsArray(proof.publicInputs),
        vk as Uint8Array,
        1
      );
      console.log('Calldata prepared, length:', callData.length);
      setGeneratedProof(callData);
      
      // Send to contract
      updateState(ProofState.SendingTransaction);
      const spStrkContract = new Contract({ abi: spStrkAbi, address: SPSTRK_ADDRESS, providerOrAccount: wallet.account });
      
      // Convert calldata for contract call (remove length prefix, convert to felt252 array)
      const proofData = callData.slice(1).map(n => '0x' + n.toString(16));
      
      // Helper to split BigInt into u256 (low, high) - each 128 bits
      // Test verifier directly before calling contract
      console.log('Testing verifier directly...');
      const testProvider = new RpcProvider({ nodeUrl: 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/LOIuv6FM2_iaC8ZCb1Omu' });
      const testVerifier = new Contract({ abi: verifierAbi, address: DEPOSIT_VERIFIER_ADDRESS, providerOrAccount: testProvider });
      try {
        const testResult = await testVerifier.verify_ultra_starknet_honk_proof(proofData);
        console.log('Verifier result:', testResult);
      } catch (e) {
        console.log('Verifier error:', e);
      }
      
      console.log('Calling create_private_commitment...');
      console.log('Commitment u256:', toU256(commitment));
      console.log('STRK Amount u256:', toU256(amountWei));
      console.log('Fixed denomination: 10 spSTRK');
      
      // Contract now only takes strk_amount (must convert to 10-10.5 spSTRK)
      const tx = await spStrkContract.create_private_commitment(
        proofData,
        toU256(commitment),
        toU256(amountWei)  // STRK amount only - contract validates it converts to ~10 spSTRK
      );
      await wallet.account.waitForTransaction(tx.transaction_hash);
      
      console.log('Private commitment created!');
      updateState(ProofState.ProofVerified);
      setDepositStep(2);
      
      notifySuccess('Private deposit complete. Commitment stored on-chain.');
    } catch (error) {
      handleError(error);
    }
  };

  // Test verification only (no wallet needed)
  const testVerification = async () => {
    try {
      updateState(ProofState.GeneratingWitness);
      
      // Use test values
      const testTime = '1700000000';
      const testCommitment = '9957662587905725615748918040227477895405062759336297902018093777162112651173';
      const testSecret = '98765432109876543210';
      const testBlinding = '12345678901234567890';
      const testAmount = '100000000000000000000';
      
      const input = {
        witness: {
          secret: testSecret,
          amount: testAmount,
          shares: testAmount,
          deposit_time: testTime,
          blinding: testBlinding
        },
        commitment: testCommitment,
        shares: testAmount,
        amount: testAmount,
        total_assets: '0',
        total_supply: '0',
        current_time: testTime
      };
      
      let noir = new Noir({ bytecode, abi: abi as any, debug_symbols: '', file_map: {} as DebugFileMap });
      let execResult = await noir.execute(input);
      
      updateState(ProofState.GeneratingProof);
      let honk = new UltraHonkBackend(bytecode, { threads: 1 });
      let proof = await honk.generateProof(execResult.witness, { starknet: true });
      honk.destroy();
      
      updateState(ProofState.PreparingCalldata);
      await init();
      const callData = getHonkCallData(
        proof.proof,
        flattenFieldsAsArray(proof.publicInputs),
        vk as Uint8Array,
        1
      );
      
      updateState(ProofState.SendingTransaction);
      const provider = new RpcProvider({ nodeUrl: 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/LOIuv6FM2_iaC8ZCb1Omu' });
      const verifierContract = new Contract({ abi: verifierAbi, address: DEPOSIT_VERIFIER_ADDRESS, providerOrAccount: provider });
      
      const res = await verifierContract.verify_ultra_starknet_honk_proof(callData.slice(1));
      console.log('Verification result:', res);
      
      updateState(ProofState.ProofVerified);
    } catch (error) {
      handleError(error);
    }
  };

  // Claim spSTRK - exit privacy for liquidity (always 10 spSTRK)
  const claimSpSTRK = async () => {
    if (!wallet || !withdrawSecret || !unlockVk) {
      notifyWarning('Paste your note and connect wallet.');
      return;
    }

    try {
      updateState(ProofState.GeneratingWitness);

      // Use UNLOCK circuit for claim (proves ownership + computes nullifier)
      const poseidon = await buildPoseidon();
      const F = poseidon.F;

      // Debug: log all note components
      console.log('=== CLAIM spSTRK NOTE DEBUG ===');
      console.log('withdrawSecret:', withdrawSecret);
      console.log('Fixed denomination:', PRIVACY_DENOMINATION_WEI);
      console.log('depositTime:', depositTime);
      console.log('withdrawBlinding:', withdrawBlinding);

      // Compute commitment from note data (FIXED DENOMINATION: always 10 spSTRK)
      const h1 = poseidon([BigInt(withdrawSecret), BigInt(PRIVACY_DENOMINATION_WEI)]);
      const h2 = poseidon([h1, BigInt(depositTime)]);
      const computedCommitment = poseidon([h2, BigInt(withdrawBlinding)]);

      // Compute nullifier = hash(secret, blinding)
      const nullifier = poseidon([BigInt(withdrawSecret), BigInt(withdrawBlinding)]);

      const commitmentStr = F.toString(computedCommitment);
      const nullifierStr = F.toString(nullifier);
      
      console.log('h1 (hash of secret,shares):', F.toString(h1));
      console.log('h2 (hash of h1,time):', F.toString(h2));
      console.log('Computed commitment:', commitmentStr);
      console.log('Computed nullifier:', nullifierStr);

      // Fetch Merkle path from indexer
      console.log('Fetching Merkle path from indexer...');
      const merklePath = await fetchMerklePath(commitmentStr);
      console.log('Merkle path:', merklePath);

      // Generate proof using UNLOCK circuit with Merkle proof
      // FIXED DENOMINATION: shares must be exactly 10 spSTRK (circuit enforces this)
      const input = {
        witness: {
          secret: withdrawSecret,
          shares: PRIVACY_DENOMINATION_WEI, // Fixed: 10 spSTRK
          deposit_time: depositTime,
          blinding: withdrawBlinding
        },
        leaf_index: merklePath.leaf_index,
        siblings: merklePath.siblings,
        // Public inputs only
        nullifier: nullifierStr,
        shares: PRIVACY_DENOMINATION_WEI, // Fixed: 10 spSTRK
        root: merklePath.root
      };

      console.log('Unlock circuit input:', input);

      updateState(ProofState.GeneratingProof);
      let noir = new Noir({ bytecode: unlockBytecode, abi: unlockAbi as any, debug_symbols: '', file_map: {} as DebugFileMap });
      let execResult = await noir.execute(input);
      
      updateState(ProofState.PreparingCalldata);
      const honk = new UltraHonkBackend(unlockBytecode);
      const proof = await honk.generateProof(execResult.witness, { starknet: true });
      honk.destroy();
      
      await init();
      
      // Debug: Log public inputs from the proof
      console.log('Proof public inputs:', proof.publicInputs);
      const flatInputs = flattenFieldsAsArray(proof.publicInputs);
      console.log('Flattened public inputs:', flatInputs);
      
      const callData = getHonkCallData(
        proof.proof,
        flatInputs,
        unlockVk as Uint8Array,
        1
      );

      // Send to contract
      updateState(ProofState.SendingTransaction);
      const spStrkContract = new Contract({ abi: spStrkAbi, address: SPSTRK_ADDRESS, providerOrAccount: wallet.account });

      const proofData = callData.slice(1).map(n => '0x' + n.toString(16));
      const toU256 = (value: string) => {
        const bigVal = BigInt(value);
        const low = bigVal % (2n ** 128n);
        const high = bigVal / (2n ** 128n);
        return { low: low.toString(), high: high.toString() };
      };

      const recipient = withdrawRecipient || walletAddress;
      // TRUE PRIVACY: Only nullifier is passed, commitment stays hidden!
      console.log('Calling claim_spSTRK to:', recipient);
      const tx = await spStrkContract.claim_spSTRK(
        proofData,
        toU256(nullifierStr),
        recipient
      );
      await wallet.account.waitForTransaction(tx.transaction_hash);

      console.log('spSTRK claimed successfully!');
      updateState(ProofState.ProofVerified);

      notifySuccess(`Success! ${PRIVACY_DENOMINATION} spSTRK sent to ${recipient}`);
    } catch (error) {
      handleError(error);
    }
  };

  // Request private unlock - starts 60s timer to get STRK back
  const requestPrivateUnlock = async () => {
    if (!wallet || !withdrawSecret || !unlockVk) {
      notifyWarning('Paste your note and connect wallet.');
      return;
    }

    try {
      updateState(ProofState.GeneratingWitness);

      const poseidon = await buildPoseidon();
      const F = poseidon.F;

      // Compute commitment from note data (FIXED DENOMINATION: always 10 spSTRK)
      const h1 = poseidon([BigInt(withdrawSecret), BigInt(PRIVACY_DENOMINATION_WEI)]);
      const h2 = poseidon([h1, BigInt(depositTime)]);
      const computedCommitment = poseidon([h2, BigInt(withdrawBlinding)]);

      // Compute nullifier and nullifier_hash
      const nullifier = poseidon([BigInt(withdrawSecret), BigInt(withdrawBlinding)]);
      const nullifierBigInt = BigInt(F.toString(nullifier));
      
      // nullifier_hash uses STARKNET Pedersen (not Poseidon!)
      // Contract computes: pedersen(nullifier.low, nullifier.high)
      const nullifierLow = nullifierBigInt & ((1n << 128n) - 1n);
      const nullifierHigh = nullifierBigInt >> 128n;
      console.log('=== NULLIFIER HASH DEBUG ===');
      console.log('nullifierBigInt:', nullifierBigInt.toString());
      console.log('nullifierLow:', nullifierLow.toString());
      console.log('nullifierHigh:', nullifierHigh.toString());
      const nullifierHashFelt = starknetHash.computePedersenHash(nullifierLow.toString(), nullifierHigh.toString());
      console.log('nullifierHashFelt:', nullifierHashFelt);

      const commitmentStr = F.toString(computedCommitment);
      const nullifierStr = F.toString(nullifier);
      const nullifierHashStr = nullifierHashFelt;
      
      console.log('Request unlock - Nullifier hash:', nullifierHashStr);
      console.log('Frontend computed commitment:', commitmentStr);

      // Fetch Merkle path from indexer
      console.log('Fetching Merkle path from indexer...');
      const merklePath = await fetchMerklePath(commitmentStr);
      console.log('Merkle path:', merklePath);
      console.log('Siblings length:', merklePath.siblings?.length);
      console.log('First 3 siblings:', merklePath.siblings?.slice(0, 3));
      console.log('Root from indexer:', merklePath.root);

      // Generate proof using UNLOCK circuit with Merkle proof
      // FIXED DENOMINATION: shares must be exactly 10 spSTRK
      const input = {
        witness: {
          secret: withdrawSecret,
          shares: PRIVACY_DENOMINATION_WEI, // Fixed: 10 spSTRK
          deposit_time: depositTime,
          blinding: withdrawBlinding
        },
        leaf_index: merklePath.leaf_index,
        siblings: merklePath.siblings,
        // Public inputs only
        nullifier: nullifierStr,
        shares: PRIVACY_DENOMINATION_WEI, // Fixed: 10 spSTRK
        root: merklePath.root
      };

      // DEBUG: Log exact circuit inputs
      console.log('=== CIRCUIT PUBLIC INPUTS ===');
      console.log('nullifier:', nullifierStr);
      console.log('shares (fixed):', PRIVACY_DENOMINATION_WEI);
      console.log('root:', merklePath.root);
      console.log('leaf_index:', merklePath.leaf_index);
      console.log('witness.secret:', withdrawSecret);
      console.log('witness.blinding:', withdrawBlinding);
      console.log('witness.deposit_time:', depositTime);

      updateState(ProofState.GeneratingProof);
      let noir = new Noir({ bytecode: unlockBytecode, abi: unlockAbi as any, debug_symbols: '', file_map: {} as DebugFileMap });
      let execResult = await noir.execute(input);
      
      updateState(ProofState.PreparingCalldata);
      const honk = new UltraHonkBackend(unlockBytecode);
      const proof = await honk.generateProof(execResult.witness, { starknet: true });
      honk.destroy();
      
      await init();
      
      // DEBUG: Log proof outputs
      console.log('=== PROOF PUBLIC INPUTS ===');
      console.log('proof.publicInputs:', proof.publicInputs);
      console.log('proof.publicInputs length:', proof.publicInputs.length);
      // Log each public input value
      proof.publicInputs.forEach((pi: any, i: number) => {
        console.log(`  publicInput[${i}]:`, pi, typeof pi);
      });
      
      const flatInputs = flattenFieldsAsArray(proof.publicInputs);
      console.log('flatInputs:', flatInputs);
      console.log('flatInputs length:', flatInputs.length);
      
      // Compare expected vs actual public inputs
      console.log('=== COMPARISON ===');
      console.log('Expected nullifier:', nullifierStr);
      console.log('Expected shares (fixed):', PRIVACY_DENOMINATION_WEI);
      console.log('Expected root:', merklePath.root);
      
      const callData = getHonkCallData(
        proof.proof,
        flatInputs,
        unlockVk as Uint8Array,
        1
      );
      
      console.log('callData length:', callData.length);
      console.log('VK size:', (unlockVk as Uint8Array).length);
      console.log('callData[0] (length prefix):', callData[0]);

      const proofData = callData.slice(1).map(n => '0x' + n.toString(16));
      console.log('proofData length after slice:', proofData.length);
      
      // Test unlock verifier directly before calling contract
      console.log('=== TESTING UNLOCK VERIFIER DIRECTLY ===');
      const testProvider = new RpcProvider({ nodeUrl: 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/LOIuv6FM2_iaC8ZCb1Omu' });
      const UNLOCK_VERIFIER_ADDRESS = '0x077aacdfef0ed6fb5d6a48894afe1d0a3bb5bbc41026c47276c3964c32622f7b';
      const testVerifier = new Contract({ 
        abi: [{ type: 'function', name: 'verify_ultra_starknet_honk_proof', inputs: [{ name: 'full_proof_with_hints', type: 'core::array::Span::<core::felt252>' }], outputs: [{ type: 'core::option::Option::<core::array::Span::<core::integer::u256>>' }], state_mutability: 'view' }],
        address: UNLOCK_VERIFIER_ADDRESS, 
        providerOrAccount: testProvider 
      });
      try {
        const testResult = await testVerifier.verify_ultra_starknet_honk_proof(proofData);
        console.log('Verifier result:', testResult);
      } catch (e) {
        console.log('Verifier direct test error:', e);
      }

      updateState(ProofState.SendingTransaction);
      const spStrkContract = new Contract({ abi: spStrkAbi, address: SPSTRK_ADDRESS, providerOrAccount: wallet.account });

      const toU256 = (value: string) => {
        const bigVal = BigInt(value);
        const low = bigVal % (2n ** 128n);
        const high = bigVal / (2n ** 128n);
        return { low: low.toString(), high: high.toString() };
      };

      // TRUE PRIVACY: Only nullifier_hash is passed (not commitment or nullifier)
      console.log('Calling request_private_unlock with nullifier_hash:', nullifierHashStr);
      const tx = await spStrkContract.request_private_unlock(
        proofData,
        toU256(nullifierHashStr)
      );
      await wallet.account.waitForTransaction(tx.transaction_hash);

      console.log('Unlock requested! Wait 60 seconds then complete withdraw.');
      updateState(ProofState.ProofVerified);

      notifyInfo('Unlock requested! Wait 60 seconds, then complete withdraw.');
    } catch (error) {
      handleError(error);
    }
  };

  // Complete private withdraw - after 60s unlock period, get STRK back (always 10 spSTRK)
  const completePrivateWithdraw = async () => {
    if (!wallet || !withdrawSecret || !unlockVk) {
      notifyWarning('Paste your note and connect wallet.');
      return;
    }

    try {
      updateState(ProofState.GeneratingWitness);

      const poseidon = await buildPoseidon();
      const F = poseidon.F;

      // Compute commitment and nullifier (FIXED DENOMINATION: always 10 spSTRK)
      const h1 = poseidon([BigInt(withdrawSecret), BigInt(PRIVACY_DENOMINATION_WEI)]);
      const h2 = poseidon([h1, BigInt(depositTime)]);
      const computedCommitment = poseidon([h2, BigInt(withdrawBlinding)]);
      const nullifier = poseidon([BigInt(withdrawSecret), BigInt(withdrawBlinding)]);

      const commitmentStr = F.toString(computedCommitment);
      const nullifierStr = F.toString(nullifier);

      console.log('Complete withdraw - Commitment:', commitmentStr);
      console.log('Complete withdraw - Nullifier:', nullifierStr);

      // Fetch Merkle path from indexer
      console.log('Fetching Merkle path from indexer...');
      const merklePath = await fetchMerklePath(commitmentStr);
      console.log('Merkle path:', merklePath);

      // Generate proof using UNLOCK circuit with Merkle proof
      // FIXED DENOMINATION: shares must be exactly 10 spSTRK
      const input = {
        witness: {
          secret: withdrawSecret,
          shares: PRIVACY_DENOMINATION_WEI, // Fixed: 10 spSTRK
          deposit_time: depositTime,
          blinding: withdrawBlinding
        },
        leaf_index: merklePath.leaf_index,
        siblings: merklePath.siblings,
        // Public inputs (only these are visible on-chain)
        nullifier: nullifierStr,
        shares: PRIVACY_DENOMINATION_WEI, // Fixed: 10 spSTRK
        root: merklePath.root
      };

      updateState(ProofState.GeneratingProof);
      let noir = new Noir({ bytecode: unlockBytecode, abi: unlockAbi as any, debug_symbols: '', file_map: {} as DebugFileMap });
      let execResult = await noir.execute(input);
      
      updateState(ProofState.PreparingCalldata);
      const honk = new UltraHonkBackend(unlockBytecode);
      const proof = await honk.generateProof(execResult.witness, { starknet: true });
      honk.destroy();
      
      await init();
      
      const flatInputs = flattenFieldsAsArray(proof.publicInputs);
      const callData = getHonkCallData(
        proof.proof,
        flatInputs,
        unlockVk as Uint8Array,
        1
      );

      updateState(ProofState.SendingTransaction);
      const spStrkContract = new Contract({ abi: spStrkAbi, address: SPSTRK_ADDRESS, providerOrAccount: wallet.account });

      const proofData = callData.slice(1).map(n => '0x' + n.toString(16));
      const toU256 = (value: string) => {
        const bigVal = BigInt(value);
        const low = bigVal % (2n ** 128n);
        const high = bigVal / (2n ** 128n);
        return { low: low.toString(), high: high.toString() };
      };

      const recipient = withdrawRecipient || walletAddress;
      const nullifierU256 = toU256(nullifierStr);

      // TRUE PRIVACY: Only nullifier is passed, commitment stays hidden!
      console.log('Calling complete_private_withdraw to:', recipient);
      const tx = await spStrkContract.complete_private_withdraw(
        proofData,
        nullifierU256,
        recipient
      );
      await wallet.account.waitForTransaction(tx.transaction_hash);

      console.log('STRK withdrawn successfully!');
      updateState(ProofState.ProofVerified);

      notifySuccess(`Success! STRK withdrawn to ${recipient}`);
    } catch (error) {
      handleError(error);
    }
  };

  const renderStateIndicator = (state: ProofState, current: ProofState) => {
    let status = 'pending';

    if (current === state && proofState.error) {
      status = 'error';
    } else if (current === state) {
      status = 'active';
    } else if (getStateIndex(current) > getStateIndex(state)) {
      status = 'completed';
    }

    const labels: Record<ProofState, string> = {
      [ProofState.Initial]: 'Ready',
      [ProofState.GeneratingWitness]: 'Generating witness',
      [ProofState.GeneratingProof]: 'Generating proof',
      [ProofState.PreparingCalldata]: 'Preparing calldata',
      [ProofState.ConnectingWallet]: 'Connecting wallet',
      [ProofState.SendingTransaction]: 'Sending transaction',
      [ProofState.ProofVerified]: 'Proof verified'
    };

    const label = labels[state] ?? state;

    return (
      <div className={`step-chip ${status}`}>
        <span className="chip-dot" />
        <span className="chip-label">{label}</span>
      </div>
    );
  };

  const getStateIndex = (state: ProofState): number => {
    const states = [
      ProofState.Initial,
      ProofState.GeneratingWitness,
      ProofState.GeneratingProof,
      ProofState.PreparingCalldata,
      ProofState.ConnectingWallet,
      ProofState.SendingTransaction,
      ProofState.ProofVerified
    ];

    return states.indexOf(state);
  };

  const renderDepositCard = () => (
    <div className="card form-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Stake privately</p>
          <h2>Private deposit workflow</h2>
          <p className="card-subtitle">
            All private deposits mint exactly <strong>10 spSTRK</strong> per note. 
            This fixed denomination ensures withdrawal privacy—everyone's notes look identical on-chain.
          </p>
        </div>
        <span className="status-badge">Step {Math.min(depositStep + 1, 2)} / 2</span>
      </div>

      <div className="mode-strip">
        <span>Deposit Mode</span>
        <div className="segment-control compact">
          <button
            className={!intentMarked && depositMode === 'single' ? 'active' : depositMode === 'single' ? 'active' : ''}
            onClick={() => setDepositMode('single')}
          >
            Single-step
          </button>
          <button
            className={depositMode === 'two-step' ? 'active' : ''}
            onClick={() => setDepositMode('two-step')}
          >
            Two-step (experimental)
          </button>
        </div>
      </div>

      {/* Swap-style deposit box */}
      <div className="swap-box" style={{ background: 'var(--surface-1)', borderRadius: '16px', padding: '16px', border: '1px solid var(--border)', marginBottom: '16px' }}>
        {/* From Token */}
        <div className="swap-token-box" style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', opacity: 0.7 }}>You deposit</span>
            <span 
              style={{ fontSize: '14px', opacity: 0.7, cursor: 'pointer' }} 
              onClick={() => setAmount(strkNeededFor10SpStrk)}
            >
              Balance: {publicStats.userBalance} (use max)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              className="swap-input"
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={proofState.state !== ProofState.Initial || depositStep === 2 || intentMarked}
              placeholder={strkNeededFor10SpStrk}
            />
            <div style={{ background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold' }}>STRK</div>
          </div>
        </div>
        
        {/* Arrow */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '-12px 0', position: 'relative', zIndex: 1 }}>
          <div style={{ background: 'var(--surface-1)', border: '4px solid var(--background)', borderRadius: '12px', padding: '8px' }}>↓</div>
        </div>
        
        {/* To Token - Fixed 10 spSTRK */}
        <div className="swap-token-box" style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginTop: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', opacity: 0.7 }}>You receive (private note)</span>
            <span style={{ fontSize: '14px', opacity: 0.7 }}>Fixed denomination</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              className="swap-input"
              type="text"
              readOnly
              value="10.0000"
            />
            <div style={{ background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold' }}>spSTRK</div>
          </div>
        </div>
        
        {/* Rate */}
        <div style={{ textAlign: 'center', fontSize: '12px', opacity: 0.6, margin: '12px 0' }}>
          1 spSTRK = {publicStats.exchangeRate} STRK • Recommended: {strkNeededFor10SpStrk} STRK (includes 2% buffer)
        </div>
      </div>

      {(depositMode === 'single' || intentMarked) && (
        <>
          <div className="input-group">
            <label>Secret</label>
            <input
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={proofState.state !== ProofState.Initial}
            />
            <button className="ghost-button" onClick={generateRandomValues} disabled={proofState.state !== ProofState.Initial}>
              Generate
            </button>
          </div>
          <div className="input-group">
            <label>Blinding</label>
            <input
              type="text"
              value={blinding}
              onChange={(e) => setBlinding(e.target.value)}
              disabled={proofState.state !== ProofState.Initial}
            />
          </div>
          <div className="input-group">
            <label>Commitment</label>
            <input
              type="text"
              value={commitment}
              onChange={(e) => setCommitment(e.target.value)}
              placeholder="Click compute after generating secret/blinding"
              readOnly
            />
            <button className="ghost-button" onClick={computeCommitment} disabled={!secret || !blinding}>
              Compute
            </button>
          </div>
        </>
      )}

      {commitment && (
        <div className="note-panel">
          <div className="note-header">
            <h4>Save your note</h4>
            <p className="note-callout">
              This entire string is your proof for private withdrawals later. Copy it, paste it below to confirm, then
              download and store it somewhere safe before you press <strong>Deposit</strong>.
            </p>
            <div className="note-warning-pill">Required to withdraw privately</div>
            <ul className="note-steps">
              <li>📋 Copy the full note and paste it into a password manager or secure file.</li>
              <li>💾 Download the note file as an offline backup.</li>
              <li>✅ Once both copies are saved, click Deposit to finalize your commitment.</li>
            </ul>
          </div>
          <div className="note-buttons">
            <button onClick={copyNote}>Copy note</button>
            <button onClick={downloadNote}>Download note</button>
          </div>
          <textarea
            className="note-input"
            rows={3}
            placeholder="sparrow:amount:secret:blinding:time:shares[:commitment]"
            onChange={(e) => parseNote(e.target.value)}
          />
        </div>
      )}

      <div className="action-row">
        {depositMode === 'single' ? (
          <button className="primary-button" onClick={privateDeposit} disabled={!wallet || !commitment}>
            {getActionLabel('Private deposit', { loading: proofState.state !== ProofState.Initial && !proofState.error, loadingLabel: 'Submitting…' })}
          </button>
        ) : (
          <div className="split-actions">
            <button
              className="warning-button"
              onClick={markDepositIntent}
              disabled={!wallet || intentMarked}
            >
              {getActionLabel('Step 1: Mark intent')}
            </button>
            <button
              className="warning-button"
              onClick={createPrivateCommitment}
              disabled={!commitment || !intentMarked}
            >
              Step 2: Create commitment
            </button>
          </div>
        )}

        <button
          className="ghost-button"
          onClick={testVerification}
          disabled={proofState.state !== ProofState.Initial}
        >
          Test verifier
        </button>

        <button className="ghost-button" onClick={resetNoteInputs}>
          Reset All
        </button>
      </div>

      <div className="card-tracker">
        {renderTracker()}
      </div>
    </div>
  );

  const renderWithdrawCard = () => (
    <div className="card form-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Unlock spSTRK / STRK privately</p>
          <h2>Choose withdrawal asset + prove ownership</h2>
          <p className="card-subtitle">Paste your saved note, pick the asset you want, and keep exits unlinkable.</p>
        </div>
        <div className="segment-control">
          <button className={privateWithdrawMode === 'spstrk' ? 'active' : ''} onClick={() => setPrivateWithdrawMode('spstrk')}>
            spSTRK (instant)
          </button>
          <button className={privateWithdrawMode === 'strk' ? 'active' : ''} onClick={() => setPrivateWithdrawMode('strk')}>
            STRK (2-step)
          </button>
        </div>
      </div>

      {/* Swap-style withdraw preview */}
      <div className="swap-box" style={{ background: 'var(--surface-1)', borderRadius: '16px', padding: '16px', border: '1px solid var(--border)', marginBottom: '16px' }}>
        {/* From Token - Fixed 10 spSTRK note */}
        <div className="swap-token-box" style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', opacity: 0.7 }}>You burn (private note)</span>
            <span style={{ fontSize: '14px', opacity: 0.7 }}>From your note</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              className="swap-input"
              type="text"
              readOnly
              value="10.0000"
            />
            <div style={{ background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold' }}>spSTRK</div>
          </div>
        </div>
        
        {/* Arrow */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '-12px 0', position: 'relative', zIndex: 1 }}>
          <div style={{ background: 'var(--surface-1)', border: '4px solid var(--background)', borderRadius: '12px', padding: '8px' }}>↓</div>
        </div>
        
        {/* To Token */}
        <div className="swap-token-box" style={{ background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginTop: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', opacity: 0.7 }}>You receive</span>
            <span style={{ fontSize: '14px', opacity: 0.7 }}>{privateWithdrawMode === 'spstrk' ? '⚡ Instant' : '⏳ After unlock period'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              className="swap-input"
              type="text"
              readOnly
              value={privateWithdrawMode === 'spstrk' 
                ? '10.0000' 
                : (10 * parseFloat(publicStats.exchangeRate || '1')).toFixed(4)}
            />
            <div style={{ background: 'var(--surface-1)', padding: '8px 12px', borderRadius: '8px', fontWeight: 'bold' }}>
              {privateWithdrawMode === 'spstrk' ? 'spSTRK' : 'STRK'}
            </div>
          </div>
        </div>
        
        {/* Rate */}
        <div style={{ textAlign: 'center', fontSize: '12px', opacity: 0.6, margin: '12px 0' }}>
          {privateWithdrawMode === 'spstrk' 
            ? '1:1 spSTRK transfer (no conversion)'
            : `1 spSTRK = ${publicStats.exchangeRate} STRK • Unlock period: ~21 days`}
        </div>
      </div>

      <div className="input-group">
        <label>Your saved note</label>
        <textarea
          className="note-input"
          rows={3}
          placeholder="sparrow:amount:secret:blinding:time:shares:commitment"
          onChange={(e) => {
            const parts = e.target.value.split(':');
            if (parts.length >= 6 && parts[0] === 'sparrow') {
              // shares (parts[5]) ignored - using fixed 10 spSTRK denomination
              setWithdrawSecret(parts[2]);
              setWithdrawBlinding(parts[3]);
              setDepositTime(parts[4]);
            }
          }}
        />
      </div>

      <div className="input-group">
        <label>Recipient (fresh wallet recommended for privacy)</label>
        <input
          type="text"
          value={withdrawRecipient || walletAddress}
          onChange={(e) => setWithdrawRecipient(e.target.value)}
          placeholder="0x..."
        />
      </div>

      <div className="action-row">
        {privateWithdrawMode === 'spstrk' ? (
          <button className="primary-button" onClick={claimSpSTRK} disabled={!wallet}>
            {getActionLabel('Claim spSTRK privately')}
          </button>
        ) : (
          <>
            <button className="primary-button" onClick={requestPrivateUnlock} disabled={!wallet}>
              {getActionLabel('Request private unlock')}
            </button>
            <button className="warning-button" onClick={completePrivateWithdraw} disabled={!wallet}>
              {getActionLabel('Complete STRK withdraw')}
            </button>
          </>
        )}
        <button className="ghost-button" onClick={resetWithdrawInputs}>
          Reset All
        </button>
      </div>

      <div className="card-tracker">
        {renderTracker()}
      </div>
    </div>
  );

  const renderTracker = () => (
    <div className="step-tracker">
      {[
        ProofState.GeneratingWitness,
        ProofState.GeneratingProof,
        ProofState.PreparingCalldata,
        ProofState.ConnectingWallet,
        ProofState.SendingTransaction,
        ProofState.ProofVerified
      ].map((state) => (
        <Fragment key={state}>{renderStateIndicator(state, proofState.state)}</Fragment>
      ))}
    </div>
  );

  const renderStatusGrid = () => (
    <section className="status-grid">
      {statusCards.map((card) => (
        <article className="status-card" key={card.label}>
          <p className="status-label">{card.label}</p>
          <p className="status-value">{card.value}</p>
          <p className="status-helper">{card.helper}</p>
        </article>
      ))}
    </section>
  );

  const renderGettingStartedPage = () => (
    <>
      <header className="hero-card">
        <div className="hero-top">
          <div className="hero-text">
            <p className="eyebrow">Noir circuits • Poseidon Merkle tree • Starknet • BTCFi rails</p>
            <h1>Bridge privately, stake publicly, exit anywhere.</h1>
            <p>
              Route shielded ZEC through the bridge or stake STRK, WBTC, TBTC, solvBTC, and IBTC directly. Every path mints spSTRK, auto-delegates to
              validators, and keeps private withdrawals one proof away.
            </p>
          </div>
        </div>

        <div className="hero-grid">
          <div className="hero-panel privacy">
            <div>
              <p className="eyebrow">Privacy-enabled route</p>
              <h2>Zcash bridge + private withdrawals</h2>
              <p>
                Generate the note, copy the memo, and send ZEC to the vault. The relayer stakes on Starknet, the indexer records your commitment, and
                you can later withdraw STRK or BTC-wrapped assets with Noir proofs.
              </p>
            </div>
            <ul>
              <li>Memo-driven ZEC → STRK relay</li>
              <li>Commitments + roots tracked off-chain</li>
              <li>Proof-backed withdrawals to any wallet</li>
            </ul>
          </div>
          <div className="hero-panel public">
            <div>
              <p className="eyebrow">Public route</p>
              <h2>Composable liquid staking</h2>
              <p>
                Use the ERC-4626 flow for STRK or BTCFi receipts, stay visible for dashboards, and let withdrawals go private whenever you want.
              </p>
            </div>
            <ul>
              <li>Direct STRK/BTCFi → spSTRK mint</li>
              <li>Unlock queue with claim windows</li>
              <li>Opt-in privacy on exit</li>
            </ul>
          </div>
        </div>
      </header>

      <section className="story-stack">
        <article className="card story-card">
          <p className="eyebrow">Liquid staking 101</p>
          <h3>ERC-4626 core with BTCFi inputs</h3>
          <p>
            Users can delegate STRK or wrapped BTC assets (WBTC, TBTC, solvBTC, IBTC) into the ERC-4626 vault and mint spSTRK as the universal receipt.
            Deposits are auto-delegated to Starknet validators, rewards stream back, and the exchange rate of spSTRK climbs over time.
          </p>
          <p>
            <strong>Result:</strong> one fungible asset that stays liquid across DeFi while accruing validator yield in the background.
          </p>
        </article>

        <article className="card story-card">
          <p className="eyebrow">Where privacy breaks</p>
          <h3>Transparent routes leak strategies</h3>
          <p>
            Without commitments, every stake, unlock, redemption, and withdrawal is public. Observers can link the address that requested an unlock to the wallet that claimed STRK minutes later, revealing intent, position sizing, and exit targets.
          </p>
          <p>BTCFi whales, mission-driven treasuries, and relayers need a way to keep those moves off-chain.</p>
        </article>

        <article className="card story-card">
          <p className="eyebrow">What we built</p>
          <h3>End-to-end private exits</h3>
          <p>
            We combined Noir circuits, Poseidon commitments, a Merkle-tree indexer, validator delegation, and a Zcash relayer to create three coordinated flows:
          </p>
          <ol>
            <li>
              <strong>Shielded bridge:</strong> ZEC → STRK via memo <code>action:amount:commitment</code>; relayer calls <code>stake_from_bridge_private</code>.
            </li>
            <li>
              <strong>Private stake from Starknet:</strong> stake publicly, generate a note, withdraw STRK or spSTRK anywhere with Noir unlock proofs.
            </li>
            <li>
              <strong>Intent (experimental):</strong> two-step commitment creation for research on intent pools and front-running mitigation.
            </li>
          </ol>
        </article>

        <article className="card story-card">
          <p className="eyebrow">Why it matters</p>
          <h3>Composable DeFi, optional privacy</h3>
          <p>
            spSTRK stays ERC-20 compatible for lending, LPing, or acting as BTCFi collateral. When it’s time to exit, the note author proves ownership, burns spSTRK, and unlocks STRK (or restakes) without exposing the original wallet.
          </p>
          <p>
            <strong>Wildcard pitch:</strong> the same Rails can shield any BTCFi receipt on Starknet, giving the ecosystem a private staking + bridge primitive built with Noir, Cairo, and validator economics.
          </p>
        </article>
      </section>

      <section className="card-grid info">
        <article className="card mini-card">
          <p className="eyebrow">User playbook</p>
          <ol>
            <li>Pick a route: shielded ZEC bridge, public ERC-4626 stake, or experimental intent flow.</li>
            <li>Generate secret + blinding, compute the commitment, and save the note.</li>
            <li>Let the validator pool compound on your behalf, then withdraw privately anytime.</li>
          </ol>
        </article>
        <article className="card mini-card">
          <p className="eyebrow">Privacy modes</p>
          <ul>
            <li>Single-step deposits (front-run-proof Noir flow).</li>
            <li>Legacy two-step intent mode for research demos.</li>
            <li>All exits require Noir unlock proofs + Merkle paths.</li>
          </ul>
        </article>
        <article className="card mini-card">
          <p className="eyebrow">Zcash bridge</p>
          <p>
            Copy the memo, send ZEC to the vault, and the relayer mints commitments on Starknet. Shielded inputs, spSTRK outputs, noir-proven withdrawals.
          </p>
        </article>
      </section>

      <section className="lifecycle">
        <div className="section-header">
          <div>
            <p className="eyebrow">How it flows</p>
            <h3>Lifecycle of your STRK → spSTRK → STRK</h3>
            <p className="section-description">
              Every deposit, whether public or private, eventually burns spSTRK to exit. This quick diagram shows what
              happens behind the scenes with the validator pool and the Merkle indexer.
            </p>
          </div>
        </div>
        <div className="lifecycle-track">
          {lifecycleSteps.map((step) => (
            <div className="lifecycle-step" key={step.title}>
              <div className="step-marker">{step.title.split('.')[0]}</div>
              <div>
                <h4>{step.title.replace(/^[0-9]+\.\s*/, '')}</h4>
                <p>{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );

  const renderStakePage = () => (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Stake STRK</p>
          <h3>Choose public speed or privacy guarantees</h3>
          <p className="section-description">
            Standard staking mints spSTRK through the ERC-4626 contract. Privacy mode generates a commitment and keeps
            withdrawals unlinkable forever.
          </p>
        </div>
        <div className="segment-control">
          <button className={stakeMode === 'privacy' ? 'active' : ''} onClick={() => { setStakeMode('privacy'); setActiveSection('section-stake-privacy'); }}>
            Privacy enabled
          </button>
          <button className={stakeMode === 'standard' ? 'active' : ''} onClick={() => { setStakeMode('standard'); setActiveSection('section-stake-standard'); }}>
            Standard
          </button>
        </div>
      </div>

      {stakeMode === 'standard' ? renderPublicCard('stake') : renderDepositCard()}
    </section>
  );

  const renderWithdrawPage = () => (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Redeem STRK</p>
          <h3>Burn spSTRK publicly or withdraw with privacy</h3>
          <p className="section-description">
            Use the transparent unlock queue for immediate STRK, or paste your note to complete a private withdrawal.
          </p>
        </div>
        <div className="segment-control">
          <button className={withdrawTab === 'private' ? 'active' : ''} onClick={() => { setWithdrawTab('private'); setActiveSection('section-withdraw-privacy'); }}>
            Private withdrawal
          </button>
          <button className={withdrawTab === 'standard' ? 'active' : ''} onClick={() => { setWithdrawTab('standard'); setActiveSection('section-withdraw-standard'); }}>
            Standard withdrawal
          </button>
        </div>
      </div>

      {withdrawTab === 'standard' ? renderPublicCard('withdraw') : renderWithdrawCard()}
    </section>
  );

  const renderZcashPage = () => (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Zcash bridge</p>
          <h3>Shielded deposits via relayer</h3>
          <p className="section-description">
            Follow these steps to get ZEC → STRK via the bridge while keeping your withdrawal path private.
          </p>
        </div>
      </div>
      <article className="card form-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Bridge deposit</p>
            <h2>Single-step private deposit via relayer</h2>
            <p className="card-subtitle">
              All bridge deposits mint exactly <strong>10 spSTRK</strong> per note. 
              This fixed denomination ensures withdrawal privacy—everyone's notes look identical on-chain.
            </p>
          </div>
        </div>

        <div className="bridge-instructions">
          <div className="bridge-quote" style={{ background: 'var(--surface-2)', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 8px 0' }}>Bridge Quote (Live)</h4>
            <p style={{ margin: '4px 0', fontSize: '14px' }}>
              <strong>Send:</strong> ~{zecNeededForBridge} ZEC
            </p>
            <p style={{ margin: '4px 0', fontSize: '14px' }}>
              <strong>Get:</strong> 10 spSTRK note (fixed denomination)
            </p>
            <p style={{ margin: '4px 0', fontSize: '12px', opacity: 0.7 }}>
              ZEC: ${bridgePrices.zec.toFixed(2)} | STRK: ${bridgePrices.strk.toFixed(4)} | Rate: {publicStats.exchangeRate} STRK/spSTRK
            </p>
          </div>
          <ol>
            <li><strong>Generate</strong> secret + blinding below, then compute commitment.</li>
            <li><strong>Copy the memo</strong> (format: <code>02:&lt;commitment&gt;</code>).</li>
            <li><strong>Send ~{zecNeededForBridge} ZEC</strong> to the bridge address with the memo.</li>
            <li><strong>Save your note</strong> — you need it to withdraw later!</li>
          </ol>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="ghost-button" onClick={() => navigator.clipboard.writeText(ZEC_BRIDGE_ADDRESS)}>Copy bridge address</button>
            <button className="ghost-button" onClick={() => navigator.clipboard.writeText(zecNeededForBridge)}>Copy ZEC amount</button>
          </div>
          <p style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>
            Bridge address: <code style={{ wordBreak: 'break-all' }}>{ZEC_BRIDGE_ADDRESS}</code>
          </p>
        </div>

        <div className="input-group">
          <label>STRK Equivalent (for 10 spSTRK note)</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={strkNeededFor10SpStrk}
              disabled={!!commitment}
              style={{ flex: 1 }}
            />
            <button 
              className="ghost-button" 
              onClick={() => setAmount(strkNeededFor10SpStrk)}
              disabled={!!commitment}
              style={{ whiteSpace: 'nowrap' }}
            >
              Use {strkNeededFor10SpStrk} STRK
            </button>
          </div>
          <p className="input-note">
            Current rate: 1 spSTRK = {publicStats.exchangeRate} STRK | 
            Need ~{strkNeededFor10SpStrk} STRK worth of ZEC for 10 spSTRK note
          </p>
          {commitment && <p className="memo-helper">Amount is locked for this note. Click "Reset note inputs" to start over with a new value.</p>}
        </div>

        <div className="split-actions">
          <button className="ghost-button" onClick={generateRandomValues}>
            Generate secret + blinding
          </button>
          <button className="ghost-button" onClick={computeCommitment} disabled={!secret || !blinding}>
            Compute commitment
          </button>
        </div>

        {commitment && (
          <div className="note-panel">
            <div className="note-header">
              <h4>Bridge memo + secret note</h4>
              <p>The memo below is what you paste into your Zcash wallet when sending to the bridge. The note is your private receipt—keep it safe to withdraw later.</p>
            </div>
            <div className="memo-preview">
              <p><strong>1) Memo for Zcash transaction</strong></p>
              <p className="memo-helper">Paste this into the memo field when you send ZEC. Format: <code>02:commitment</code> (relayer calculates amount).</p>
              <code>{memoPreview}</code>
              <button
                className="memo-copy-button"
                onClick={() => memoPreview && navigator.clipboard.writeText(memoPreview)}
                disabled={!memoPreview}
              >
                Copy memo text
              </button>
            </div>
            <div className="note-info">
              <p><strong>2) Private note (required to withdraw anywhere)</strong></p>
              <p className="memo-helper">**Important** You must copy and save and/or download and/or write down this note, you must have this to withdraw to any address later.  Anyone with this note can withdraw the funds.  Without it your funds are lost permanantly.  Store it somewhere securely. </p>
            </div>
            <textarea
              className="note-input"
              rows={3}
              defaultValue={generateNote()}
              readOnly
            />
            <div className="note-action-buttons">
              <button onClick={copyNote}>Copy note</button>
              <button onClick={downloadNote}>Download note</button>
            </div>
          </div>
        )}

        <div className="action-row">
          <button className="ghost-button" onClick={resetNoteInputs}>
            Reset note inputs
          </button>
        </div>
      </article>
    </section>
  );

  const renderCurrentPage = () => {
    if (activeSection === 'section-getting-started') return renderGettingStartedPage();
    if (activeSection.startsWith('section-stake')) return renderStakePage();
    if (activeSection.startsWith('section-withdraw')) return renderWithdrawPage();
    if (activeSection === 'section-zcash') return renderZcashPage();
    return renderGettingStartedPage();
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <span>Liquid Privacy</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <div className="nav-section" key={item.id}>
              {item.children ? (
                <>
                  <p className="nav-heading">{item.label}</p>
                  <div className="nav-children">
                    {item.children.map((child) => (
                      <button
                        key={child.id}
                        className={activeSection === child.id ? 'nav-link active' : 'nav-link'}
                        onClick={() => handleNavClick(child.id)}
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button
                  className={activeSection === item.id ? 'nav-link active' : 'nav-link'}
                  onClick={() => handleNavClick(item.id)}
                >
                  {item.label}
                </button>
              )}
            </div>
          ))}
        </nav>
      </aside>
      <div className="page">
        <div className="page-header">
          {!wallet ? (
            <button className="primary-button" onClick={connectWallet}>Connect wallet</button>
          ) : (
            <div className="pill connected">Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</div>
          )}
        </div>
        <div className="status-overview">
          {renderStatusGrid()}
        </div>
        {renderCurrentPage()}
        {proofState.error && (
          <div className="alert error">
            <strong>Stage '{proofState.state}' failed:</strong> {proofState.error}
          </div>
        )}

        {proofState.state === ProofState.ProofVerified && !proofState.error && (
          <div className="alert success">
            ✅ Proof verified. Continue with the next action or reset.
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
