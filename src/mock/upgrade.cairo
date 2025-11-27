#[starknet::interface]
pub trait INewspSTRK<TContractState> {
    fn new_function(self: @TContractState) -> u8;
}

#[starknet::contract]
pub mod NewspSTRK {
    use openzeppelin_access::ownable::OwnableComponent;
    use openzeppelin_interfaces::upgrades::IUpgradeable;
    use openzeppelin_security::pausable::PausableComponent;
    use openzeppelin_security::reentrancyguard::ReentrancyGuardComponent;
    use openzeppelin_token::erc20::ERC20Component;
    use openzeppelin_upgrades::UpgradeableComponent;
    use sp_strk::interfaces::sp_strk::UnlockRequest;
    use sp_strk::types::init::InitParams;
    use starknet::storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ClassHash, ContractAddress};
    use super::INewspSTRK;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);
    component!(path: PausableComponent, storage: pausable, event: PausableEvent);
    component!(
        path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent,
    );

    // ERC20 Configuration
    impl ERC20ImmutableConfigImpl of ERC20Component::ImmutableConfig {
        const DECIMALS: u8 = 18;
    }

    // ERC20 Implementations
    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;
    impl ERC20HooksImpl = openzeppelin_token::erc20::ERC20HooksEmptyImpl<ContractState>;

    // Ownable
    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    // Upgradeable
    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;

    // Pausable
    #[abi(embed_v0)]
    impl PausableImpl = PausableComponent::PausableImpl<ContractState>;
    impl PausableInternalImpl = PausableComponent::InternalImpl<ContractState>;

    // ReentrancyGuard
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        strk_token: ContractAddress,
        unlock_requests: Map<(ContractAddress, u256), UnlockRequest>,
        unlock_request_count: Map<ContractAddress, u256>,
        accumulated_dao_fees: u256,
        accumulated_dev_fees: u256,
        min_stake_amount: u256,
        total_pooled_STRK: u256,
        claim_window: u64,
        unlock_period: u64,
        dao_fee_basis_points: u16,
        dev_fee_basis_points: u16,
        total_locked_in_unlocks: u256,
        validator_pool: ContractAddress,
        total_delegated_to_validator: u256,
        pending_validator_unbonding: u256,
        validator_unbond_time: u64,
        withdrawal_queue_nft: ContractAddress,
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
        #[substorage(v0)]
        pausable: PausableComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        UpgradeableEvent: UpgradeableComponent::Event,
        #[flat]
        PausableEvent: PausableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, params: InitParams) {
        self.ownable.initializer(params.owner);
        self.erc20.initializer("Sparrow Staked STRK", "spSTRK");

        self.strk_token.write(params.strk_token);
        self.validator_pool.write(params.validator_pool);
        self.withdrawal_queue_nft.write(params.withdrawal_queue_nft);
        self.dao_fee_basis_points.write(params.dao_fee_basis_points);
        self.dev_fee_basis_points.write(params.dev_fee_basis_points);
        self.min_stake_amount.write(params.min_stake_amount);
        self.unlock_period.write(params.unlock_period);
        self.claim_window.write(params.claim_window);
    }

    #[abi(embed_v0)]
    impl UpgradeableImpl of IUpgradeable<ContractState> {
        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            self.ownable.assert_only_owner();
            self.upgradeable.upgrade(new_class_hash);
        }
    }

    #[abi(embed_v0)]
    impl NewspSTRKImpl of INewspSTRK<ContractState> {
        fn new_function(self: @ContractState) -> u8 {
            10
        }
    }
}
