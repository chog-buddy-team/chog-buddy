// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockChog} from "../src/MockChog.sol";
import {FocusPool} from "../src/FocusPool.sol";

/// Deploys MockChog + FocusPool, seeds the reward pot with 100,000 mCHOG. Owner = the broadcasting account.
contract DeployFocus is Script {
    uint256 constant SEED = 100_000e18;

    function run() external returns (MockChog token, FocusPool pool) {
        address settler = vm.envAddress("SETTLER_ADDRESS");
        vm.startBroadcast();
        address owner = msg.sender;
        token = new MockChog(owner);
        pool = new FocusPool(IERC20(address(token)), settler, owner);
        token.mint(owner, SEED);
        token.approve(address(pool), SEED);
        pool.fund(SEED);
        vm.stopBroadcast();
        console.log("MOCK_CHOG ", address(token));
        console.log("FOCUS_POOL", address(pool));
    }
}
