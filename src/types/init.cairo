use starknet::ContractAddress;

// Initialization parameters for the spSTRK contract
#[derive(Drop, Serde, Copy)]
pub struct InitParams {
    // Owner of the contract
    pub owner: ContractAddress,
    // STRK token contract address
    pub strk_token: ContractAddress,
    // DAO fee basis points
    pub dao_fee_basis_points: u16,
    // Developer fee basis points
    pub dev_fee_basis_points: u16,
    // Minimum stake amount
    pub min_stake_amount: u256,
    // Unlock period in seconds
    pub unlock_period: u64,
    // Claim window in seconds
    pub claim_window: u64,
    // Validator pool contract address
    pub validator_pool: ContractAddress,

    pub withdrawal_queue_nft: ContractAddress,
}
