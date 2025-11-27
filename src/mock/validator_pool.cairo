#[starknet::contract]
pub mod MockValidatorPool {
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use sp_strk::interfaces::validator_pool::IValidatorPool;

    #[storage]
    struct Storage {
        total_staked: u128,
        rewards_pool: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.total_staked.write(0);
        self.rewards_pool.write(0);
    }

    #[abi(embed_v0)]
    impl MockValidatorPoolImpl of IValidatorPool<ContractState> {
        fn enter_delegation_pool(
            ref self: ContractState,
            reward_address: ContractAddress,
            amount: u128
        ) {
            // Mock: Track staking
            let current = self.total_staked.read();
            self.total_staked.write(current + amount);
        }

        fn add_to_delegation_pool(
            ref self: ContractState,
            pool_member: ContractAddress,
            amount: u128
        ) -> u128 {
            // Mock: Track additional staking
            let current = self.total_staked.read();
            self.total_staked.write(current + amount);
            amount
        }

        fn exit_delegation_pool_intent(
            ref self: ContractState,
            amount: u128
        ) {
            // Mock: Start unbonding (no-op for mock)
        }

        fn exit_delegation_pool_action(
            ref self: ContractState,
            pool_member: ContractAddress
        ) -> u128 {
            // Mock: Return some unbonded amount
            let amount: u128 = 100;
            let current = self.total_staked.read();
            if current >= amount {
                self.total_staked.write(current - amount);
            }
            amount
        }

        fn claim_rewards(
            ref self: ContractState,
            pool_member: ContractAddress
        ) -> u128 {
            // Mock: Return rewards from pool
            let rewards = self.rewards_pool.read();
            self.rewards_pool.write(0);
            rewards
        }
    }

    // Helper function for tests to set mock rewards
    #[generate_trait]
    #[abi(per_item)]
    impl TestHelpersImpl of TestHelpersTrait {
        #[external(v0)]
        fn set_rewards(ref self: ContractState, amount: u128) {
            self.rewards_pool.write(amount);
        }

        #[external(v0)]
        fn get_total_staked(self: @ContractState) -> u128 {
            self.total_staked.read()
        }
    }
}