// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title MockChog
/// @notice Testnet stand-in for $CHOG used by Focus Bets. No value; anyone can take 100 a day from the faucet.
contract MockChog is ERC20, ERC20Permit, Ownable2Step {
    uint256 public constant FAUCET_AMOUNT = 100e18;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastFaucet;

    error FaucetCooldown(uint256 nextAt);

    constructor(address owner_) ERC20("Mock CHOG", "mCHOG") ERC20Permit("Mock CHOG") Ownable(owner_) {}

    function faucet() external {
        uint256 last = lastFaucet[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
