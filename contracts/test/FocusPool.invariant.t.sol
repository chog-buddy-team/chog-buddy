// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockChog} from "../src/MockChog.sol";
import {FocusPool} from "../src/FocusPool.sol";

contract Handler is Test {
    MockChog token;
    FocusPool pool;
    address settler;
    address[] public actors;
    uint256[] public betIds;

    constructor(MockChog token_, FocusPool pool_, address settler_, address owner) {
        token = token_;
        pool = pool_;
        settler = settler_;
        for (uint256 i; i < 4; i++) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(a);
            vm.prank(owner);
            token.mint(a, 10_000e18);
            vm.prank(a);
            token.approve(address(pool), type(uint256).max);
        }
    }

    function stake(uint256 actorSeed, uint8 goalSeed, uint96 amount, uint40 window) external {
        address a = actors[actorSeed % actors.length];
        if (pool.openBetOf(a) != 0) return;
        FocusPool.Goal goal = FocusPool.Goal(goalSeed % 4);
        amount = uint96(bound(amount, 1e18, 100e18));
        (uint16 minutes_,) = pool.goalParams(goal);
        uint40 deadline = uint40(block.timestamp + bound(window, uint256(minutes_) * 60, 24 hours));
        vm.prank(a);
        try pool.stake(goal, amount, deadline, keccak256(abi.encode(a, amount))) returns (uint256 id) {
            betIds.push(id);
        } catch {}
    }

    function settle(uint256 seed, bool won) external {
        if (betIds.length == 0) return;
        uint256 id = betIds[seed % betIds.length];
        vm.prank(settler);
        try pool.settle(id, won) {} catch {}
    }

    function claim(uint256 seed) external {
        if (betIds.length == 0) return;
        uint256 id = betIds[seed % betIds.length];
        vm.prank(pool.getBet(id).bettor);
        try pool.claim(id) {} catch {}
    }

    function refund(uint256 seed) external {
        if (betIds.length == 0) return;
        uint256 id = betIds[seed % betIds.length];
        vm.prank(pool.getBet(id).bettor);
        try pool.refund(id) {} catch {}
    }

    function releaseBonus(uint256 seed) external {
        if (betIds.length == 0) return;
        try pool.releaseBonus(betIds[seed % betIds.length]) {} catch {}
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 40 days));
    }

    function betCount() external view returns (uint256) {
        return betIds.length;
    }
}

contract FocusPoolInvariantTest is Test {
    MockChog token;
    FocusPool pool;
    Handler handler;

    function setUp() public {
        address owner = address(0xA11CE0);
        address settler = address(0x5E77);
        token = new MockChog(owner);
        pool = new FocusPool(IERC20(address(token)), settler, owner);
        vm.startPrank(owner);
        token.mint(owner, 1_000e18);
        token.approve(address(pool), type(uint256).max);
        pool.fund(1_000e18);
        vm.stopPrank();
        handler = new Handler(token, pool, settler, owner);
        targetContract(address(handler));
    }

    function invariant_balanceMatchesPotPlusLiveStakes() public view {
        uint256 live;
        for (uint256 i; i < handler.betCount(); i++) {
            FocusPool.Bet memory b = pool.getBet(handler.betIds(i));
            if (b.status == FocusPool.Status.Open || b.status == FocusPool.Status.Won) live += b.amount;
        }
        assertEq(token.balanceOf(address(pool)), pool.pot() + live);
        assertLe(pool.reserved(), pool.pot());
    }
}
