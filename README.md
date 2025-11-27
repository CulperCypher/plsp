Private Liquid Staking Protocol

Built a spSTRK.cairo contract with function to interact with noir circuits. 

One route for the user is to stake via a privacy circuit.  Save a note and can later either withdraw a liquid asset of spSTRK or thye can choose to unstake their funds by requesting an unlock, waiting a period, and then claiming the unlock.  The withdrawals can go to any wallet.  The user could withdraw to a wallet with no history for mor eprivacy. 

There is also a standard publi facing set of functions where user can interact with a walelt int he normal fashion.  

There is validator logic and functions for autostaking to validator pools and maintaning 10% contract liquidity.  

The rewards from the pool are claimed from the contract and added to the contract increasing the share value of spSTRK holders.  

The contract is upgradeable and ownable.  It is erc20:erc4626.  

It has variables that can be set for a dev fee a dao fee on rewards with a fee cap o 10%.  These are accounted for and withdrawable by owner. 

The deployed contract is at 0x05efc624f4f0afb75bd6a57b35a0d2fb270c6eb0cea0e3f7dc36aefe9681e509

