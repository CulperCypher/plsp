import dotenv from 'dotenv';
dotenv.config();

export const starknetConfig = {
  rpcUrl: process.env.STARKNET_RPC_URL,
  contractAddress: process.env.WTAZ_CONTRACT_ADDRESS,
  spSTRKContractAddress: process.env.SPSTRK_CONTRACT_ADDRESS,
  strkTokenAddress: process.env.STRK_TOKEN_ADDRESS,
  backendAccountAddress: process.env.BACKEND_ACCOUNT_ADDRESS,
  backendPrivateKey: process.env.BACKEND_PRIVATE_KEY,
  chainId: 'SN_SEPOLIA',
};