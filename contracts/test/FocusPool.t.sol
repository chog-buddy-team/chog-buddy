// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockChog} from "../src/MockChog.sol";
import {FocusPool} from "../src/FocusPool.sol";

contract FocusPoolTest is Test {
    MockChog token;
    FocusPool pool;
    address owner = address(0xA11CE0);
    address settler = address(0x5E77);
    uint256 aliceKey = 0xA11CE;
    address alice;
    bytes32 constant H = keccak256("progress-key");

    function setUp() public {
        alice = vm.addr(aliceKey);
        token = new MockChog(owner);
        pool = new FocusPool(IERC20(address(token)), settler, owner);
        vm.startPrank(owner);
        token.mint(owner, 10_000e18);
        token.approve(address(pool), type(uint256).max);
        pool.fund(10_000e18);
        vm.stopPrank();
        vm.prank(alice);
        token.faucet();
    }

    // ---- helpers ----

    function _approveAndStake(FocusPool.Goal goal, uint96 amount, uint40 deadline) internal returns (uint256) {
        return _stakeAs(alice, goal, amount, deadline);
    }

    // A fresh wallet with 100 mCHOG from the faucet.
    function _fresh(string memory name) internal returns (address who) {
        who = makeAddr(name);
        vm.prank(who);
        token.faucet();
    }

    function _stakeAs(address who, FocusPool.Goal goal, uint96 amount, uint40 deadline) internal returns (uint256) {
        vm.startPrank(who);
        token.approve(address(pool), amount);
        uint256 id = pool.stake(goal, amount, deadline, H);
        vm.stopPrank();
        return id;
    }

    function _permitSig(uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                alice,
                address(pool),
                value,
                token.nonces(alice),
                deadline
            )
        );
        (v, r, s) = vm.sign(aliceKey, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
    }

    // ---- staking ----

    function test_stakeSprint() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        assertEq(id, 1);
        FocusPool.Bet memory b = pool.getBet(1);
        assertEq(b.bettor, alice);
        assertEq(b.amount, 10e18);
        assertEq(b.deadline, block.timestamp + 300);
        assertEq(b.bonus, 0.5e18);
        assertEq(uint8(b.status), uint8(FocusPool.Status.Open));
        assertEq(b.progressKeyHash, H);
        assertEq(pool.reserved(), 0.5e18);
        assertEq(pool.potAvailable(), 10_000e18 - 0.5e18);
        assertEq(pool.openBetOf(alice), 1);
        assertEq(token.balanceOf(address(pool)), 10_010e18);
    }

    function test_stakeWithPermit() public {
        uint256 pd = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(10e18, pd);
        vm.prank(alice);
        uint256 id = pool.stakeWithPermit(FocusPool.Goal.Sprint, 10e18, 0, H, pd, v, r, s);
        assertEq(pool.getBet(id).amount, 10e18);
        assertEq(token.balanceOf(alice), 90e18);
    }

    function test_permitFrontRunStillStakes() public {
        uint256 pd = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(10e18, pd);
        token.permit(alice, address(pool), 10e18, pd, v, r, s); // someone else uses the signature first
        vm.prank(alice);
        uint256 id = pool.stakeWithPermit(FocusPool.Goal.Sprint, 10e18, 0, H, pd, v, r, s);
        assertEq(pool.getBet(id).amount, 10e18);
    }

    function test_hourGoalDeadlineBounds() public {
        uint40 t = uint40(block.timestamp);
        _stakeAs(_fresh("a"), FocusPool.Goal.TwoHours, 1e18, t + 7200);
        _stakeAs(_fresh("b"), FocusPool.Goal.TwoHours, 1e18, t + 86400);
        vm.startPrank(alice);
        token.approve(address(pool), 1e18);
        vm.expectRevert(FocusPool.BadDeadline.selector);
        pool.stake(FocusPool.Goal.TwoHours, 1e18, t + 7199, H);
        vm.expectRevert(FocusPool.BadDeadline.selector);
        pool.stake(FocusPool.Goal.TwoHours, 1e18, t + 86401, H);
        vm.stopPrank();
    }

    function testFuzz_hourDeadline(uint40 offset) public {
        offset = uint40(bound(offset, 0, 200_000));
        vm.startPrank(alice);
        token.approve(address(pool), 1e18);
        if (offset >= 7200 && offset <= 86400) {
            pool.stake(FocusPool.Goal.TwoHours, 1e18, uint40(block.timestamp) + offset, H);
        } else {
            vm.expectRevert(FocusPool.BadDeadline.selector);
            pool.stake(FocusPool.Goal.TwoHours, 1e18, uint40(block.timestamp) + offset, H);
        }
        vm.stopPrank();
    }

    function test_amountBounds() public {
        _stakeAs(_fresh("a"), FocusPool.Goal.Sprint, 1e18, 0);
        vm.startPrank(alice);
        token.approve(address(pool), type(uint256).max);
        vm.expectRevert(FocusPool.AmountOutOfRange.selector);
        pool.stake(FocusPool.Goal.Sprint, 1e18 - 1, 0, H);
        vm.expectRevert(FocusPool.AmountOutOfRange.selector);
        pool.stake(FocusPool.Goal.Sprint, 100e18 + 1, 0, H);
        vm.stopPrank();
    }

    function test_maxStakeAccepted() public {
        vm.prank(owner);
        token.mint(alice, 100e18);
        _approveAndStake(FocusPool.Goal.Sprint, 100e18, 0);
        assertEq(pool.getBet(1).amount, 100e18);
    }

    function test_oneOpenBet() public {
        _approveAndStake(FocusPool.Goal.Sprint, 1e18, 0);
        vm.startPrank(alice);
        token.approve(address(pool), 1e18);
        vm.expectRevert(FocusPool.AlreadyHasOpenBet.selector);
        pool.stake(FocusPool.Goal.Sprint, 1e18, 0, H);
        vm.stopPrank();
    }

    function test_potTooLow() public {
        FocusPool small = new FocusPool(IERC20(address(token)), settler, owner);
        vm.startPrank(owner);
        token.mint(owner, 1e18);
        token.approve(address(small), 1e18);
        small.fund(1e18);
        vm.stopPrank();
        vm.startPrank(alice);
        token.approve(address(small), 10e18);
        vm.expectRevert(FocusPool.PotTooLow.selector);
        small.stake(FocusPool.Goal.SixHours, 10e18, uint40(block.timestamp) + 6 hours, H);
        vm.stopPrank();
    }

    function test_fundAddsToPot() public {
        vm.prank(owner);
        token.mint(alice, 5e18);
        vm.startPrank(alice);
        token.approve(address(pool), 5e18);
        vm.expectEmit(true, false, false, true);
        emit FocusPool.Funded(alice, 5e18);
        pool.fund(5e18);
        vm.stopPrank();
        assertEq(pool.pot(), 10_005e18);
    }

    function test_constructorRejectsZero() public {
        vm.expectRevert(FocusPool.ZeroAddress.selector);
        new FocusPool(IERC20(address(0)), settler, owner);
        vm.expectRevert(FocusPool.ZeroAddress.selector);
        new FocusPool(IERC20(address(token)), address(0), owner);
        vm.expectRevert(); // OpenZeppelin Ownable rejects a zero owner with its own error
        new FocusPool(IERC20(address(token)), settler, address(0));
    }

    function test_goalParams() public view {
        (uint16 m, uint16 b) = pool.goalParams(FocusPool.Goal.Sprint);
        assertEq(m, 3);
        assertEq(b, 500);
        (m, b) = pool.goalParams(FocusPool.Goal.TwoHours);
        assertEq(m, 120);
        assertEq(b, 1000);
        (m, b) = pool.goalParams(FocusPool.Goal.FourHours);
        assertEq(m, 240);
        assertEq(b, 2500);
        (m, b) = pool.goalParams(FocusPool.Goal.SixHours);
        assertEq(m, 360);
        assertEq(b, 5000);
    }

}
