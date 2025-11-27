// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts for Cairo 3.0.0-alpha.3

#[starknet::contract]
pub mod WithdrawalQueueNFT {
    use starknet::storage::StoragePathEntry;
use openzeppelin_token::erc721::ERC721Component;
    use openzeppelin_introspection::src5::SRC5Component;
    use starknet::ContractAddress;
    use starknet::storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;

    use sp_strk::interfaces::sp_strk::UnlockRequest;
    use sp_strk::interfaces::withdrawal_queue::IWithdrawalQueueNFT;

    // Both components needed
    component!(path: ERC721Component, storage: erc721, event: ERC721Event);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    // ERC721 Configuration
    impl ERC721HooksImpl = openzeppelin_token::erc721::ERC721HooksEmptyImpl<ContractState>;

    // ERC721 Mixin
    #[abi(embed_v0)]
    impl ERC721MixinImpl = ERC721Component::ERC721MixinImpl<ContractState>;
    impl ERC721InternalImpl = ERC721Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        vault_address: ContractAddress,
        next_token_id: u256,
        requests: Map<u256, UnlockRequest>,
        #[substorage(v0)]
        erc721: ERC721Component::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        RequestMinted: RequestMinted,
        RequestBurned: RequestBurned,
        #[flat]
        ERC721Event: ERC721Component::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct RequestMinted {
        #[key]
        token_id: u256,
        #[key]
        owner: ContractAddress,
        sp_strk_amount: u256,
        strk_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct RequestBurned {
        #[key]
        token_id: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, vault_address: ContractAddress) {
        self.erc721.initializer("spSTRK Withdrawal Request", "spWR", "");
        self.vault_address.write(vault_address);
        self.next_token_id.write(1);
    }

    #[abi(embed_v0)]
    impl WithdrawalQueueNFTImpl of IWithdrawalQueueNFT<ContractState> {
        fn mint_request(
            ref self: ContractState,
            owner: ContractAddress,
            request_data: UnlockRequest,
        ) -> u256 {
            assert(get_caller_address() == self.vault_address.read(), 'Only vault');
            
            let token_id = self.next_token_id.read();
            self.requests.entry(token_id).write(request_data);
            self.erc721.mint(owner, token_id);
            self.next_token_id.write(token_id + 1);
            
            self.emit(RequestMinted {
                token_id,
                owner,
                sp_strk_amount: request_data.sp_strk_amount,
                strk_amount: request_data.strk_amount,
            });
            
            token_id
        }
        
        fn burn_request(ref self: ContractState, token_id: u256) {
            assert(get_caller_address() == self.vault_address.read(), 'Only vault');
            self.erc721.burn(token_id);
            self.emit(RequestBurned { token_id });
        }
        
        fn get_request(self: @ContractState, token_id: u256) -> UnlockRequest {
            self.requests.entry(token_id).read()
        }
        
        fn is_claimable(self: @ContractState, token_id: u256) -> bool {
            let request = self.requests.entry(token_id).read();
            let now = get_block_timestamp();
            now >= request.unlock_time && now < request.expiry_time
        }

        fn is_expired(self: @ContractState, token_id: u256) -> bool {
        let request = self.requests.entry(token_id).read();
        let now = get_block_timestamp();
        now >= request.expiry_time
    }
    }
}