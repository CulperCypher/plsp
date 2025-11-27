pub mod Constants {
    use starknet::ContractAddress;
    
    pub const BASIS_POINTS: u256 = 10000; // 100% = 10000 bps
    pub const MAX_TOTAL_FEE: u16 = 1000; // Max 10% (CLARITY Act)
    // pub const MIN_UNLOCK_PERIOD: u64 = 604800; // 7 days
    pub const MIN_UNLOCK_PERIOD: u64 = 60; // 1 minute
    pub const MAX_UNLOCK_PERIOD: u64 = 2592000; // 30 days
    pub const MIN_CLAIM_WINDOW: u64 = 3600; // 1 hour
    pub const MAX_CLAIM_WINDOW: u64 = 2592000; // 30 days
    pub const MAX_UNLOCK_REQUESTS: u256 = 100;

    pub fn strk_address() -> ContractAddress {
        0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d.try_into().unwrap()
    }
}
