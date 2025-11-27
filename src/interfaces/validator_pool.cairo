use starknet::ContractAddress;

#[starknet::interface]
pub trait IValidatorPool<TContractState> {
    // Enter delegation pool (first time staking to this validator)
    fn enter_delegation_pool(
        ref self: TContractState,
        reward_address: ContractAddress,
        amount: u128
    );
    
    // Add more stake (already a pool member)
    fn add_to_delegation_pool(
        ref self: TContractState,
        pool_member: ContractAddress,
        amount: u128
    ) -> u128;
    
    // Request to exit (start unbonding)          request unlock by protocol
    fn exit_delegation_pool_intent(
        ref self: TContractState,
        amount: u128
    );
    
    // Complete exit (after unbonding period)      claim unlock by protocol
    fn exit_delegation_pool_action(
        ref self: TContractState,
        pool_member: ContractAddress
    ) -> u128;
    
    // Claim rewards                                add rewards
    fn claim_rewards(
        ref self: TContractState,
        pool_member: ContractAddress
    ) -> u128;
}