#[starknet::contract]
pub mod MockERC20 {
    use starknet::ContractAddress;
    use openzeppelin_token::erc20::ERC20Component;

    component!(path: ERC20Component, storage: erc20, event: ERC20Event);

    // ERC20 Mixin - requires ImmutableConfig
    #[abi(embed_v0)]
    impl ERC20MixinImpl = ERC20Component::ERC20MixinImpl<ContractState>;
    impl ERC20InternalImpl = ERC20Component::InternalImpl<ContractState>;
    
    // Use the default config for decimals
    impl DefaultConfig = openzeppelin_token::erc20::erc20::DefaultConfig;
    
    // ERC20 Hooks - REQUIRED, must be after ImmutableConfig
    impl ERC20HooksImpl = openzeppelin_token::erc20::erc20::ERC20HooksEmptyImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc20: ERC20Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        ERC20Event: ERC20Component::Event,
    }

    #[constructor]
    pub fn constructor(ref self: ContractState, recipient: ContractAddress) {
        self.erc20.initializer("Starknet Token", "STRK");
        self.erc20.mint(recipient, 1000000000 * 1_000_000_000_000_000_000);
    }
}