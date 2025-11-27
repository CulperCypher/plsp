use starknet::ContractAddress;

// Import from sp_strk instead of redefining
use super::sp_strk::UnlockRequest;

#[starknet::interface]
pub trait IWithdrawalQueueNFT<TContractState> {
    fn mint_request(
        ref self: TContractState,
        owner: ContractAddress,
        request_data: UnlockRequest,
    ) -> u256;
    
    fn burn_request(ref self: TContractState, token_id: u256);
    
    fn get_request(self: @TContractState, token_id: u256) -> UnlockRequest;
    fn is_claimable(self: @TContractState, token_id: u256) -> bool;
    fn is_expired(self: @TContractState, token_id: u256) -> bool;
}