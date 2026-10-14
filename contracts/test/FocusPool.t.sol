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


    // ---- settle / claim / refund ----

    function test_winAnytimeThenClaim() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.warp(block.timestamp + 10);
        vm.expectEmit(true, false, false, true);
        emit FocusPool.Settled(id, true);
        vm.prank(settler);
        pool.settle(id, true);
        assertEq(pool.openBetOf(alice), 0);
        vm.expectEmit(true, false, false, true);
        emit FocusPool.Claimed(id, 10.5e18);
        vm.prank(alice);
        pool.claim(id);
        assertEq(token.balanceOf(alice), 100.5e18);
        assertEq(pool.pot(), 10_000e18 - 0.5e18);
        assertEq(pool.reserved(), 0);
        assertEq(uint8(pool.getBet(id).status), uint8(FocusPool.Status.Claimed));
    }

    function test_winInsideGraceAfterDeadline() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.warp(pool.getBet(id).deadline + 60);
        vm.prank(settler);
        pool.settle(id, true);
        assertEq(uint8(pool.getBet(id).status), uint8(FocusPool.Status.Won));
    }

    function test_lossOnlyAfterDeadline() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.prank(settler);
        vm.expectRevert(FocusPool.TooEarly.selector);
        pool.settle(id, false);
        vm.warp(pool.getBet(id).deadline);
        vm.prank(settler);
        pool.settle(id, false);
        assertEq(token.balanceOf(pool.DEAD()), 1e18);
        assertEq(pool.pot(), 10_000e18 + 9e18);
        assertEq(pool.reserved(), 0);
        assertEq(pool.openBetOf(alice), 0);
        assertEq(uint8(pool.getBet(id).status), uint8(FocusPool.Status.Lost));
    }

    function test_onlySettler() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.prank(alice);
        vm.expectRevert(FocusPool.NotSettler.selector);
        pool.settle(id, true);
    }

    function test_onlyBettorClaims() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.prank(settler);
        pool.settle(id, true);
        vm.prank(settler);
        vm.expectRevert(FocusPool.NotBettor.selector);
        pool.claim(id);
    }

    function test_claimTwice() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.prank(settler);
        pool.settle(id, true);
        vm.startPrank(alice);
        pool.claim(id);
        vm.expectRevert(FocusPool.NotWon.selector);
        pool.claim(id);
        vm.stopPrank();
    }

    function test_claimLost() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.warp(pool.getBet(id).deadline);
        vm.prank(settler);
        pool.settle(id, false);
        vm.prank(alice);
        vm.expectRevert(FocusPool.NotWon.selector);
        pool.claim(id);
    }

    function test_refundTooEarly() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.warp(pool.getBet(id).deadline + 2 days);
        vm.prank(alice);
        vm.expectRevert(FocusPool.TooEarly.selector);
        pool.refund(id);
    }

    function test_refundAfterDelay() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.warp(pool.getBet(id).deadline + 2 days + 1);
        vm.prank(settler);
        vm.expectRevert(FocusPool.NotBettor.selector);
        pool.refund(id);
        vm.expectEmit(true, false, false, false);
        emit FocusPool.Refunded(id);
        vm.prank(alice);
        pool.refund(id);
        assertEq(token.balanceOf(alice), 100e18);
        assertEq(pool.reserved(), 0);
        assertEq(pool.openBetOf(alice), 0);
    }

    function test_settleAfterRefundReverts() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.warp(pool.getBet(id).deadline + 2 days + 1);
        vm.prank(alice);
        pool.refund(id);
        vm.prank(settler);
        vm.expectRevert(FocusPool.NotOpen.selector);
        pool.settle(id, true);
    }

    function test_refundAfterSettleReverts() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.warp(pool.getBet(id).deadline + 2 days + 1);
        vm.prank(settler);
        pool.settle(id, false);
        vm.prank(alice);
        vm.expectRevert(FocusPool.NotOpen.selector);
        pool.refund(id);
    }

    function test_newBetAfterSettle() public {
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, 10e18, 0);
        vm.prank(settler);
        pool.settle(id, true);
        uint256 id2 = _approveAndStake(FocusPool.Goal.Sprint, 1e18, 0);
        assertEq(id2, 2);
    }

    function test_setSettler() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.setSettler(alice);
        vm.prank(owner);
        vm.expectRevert(FocusPool.ZeroAddress.selector);
        pool.setSettler(address(0));
        vm.expectEmit(false, false, false, true);
        emit FocusPool.SettlerChanged(address(0xBEEF));
        vm.prank(owner);
        pool.setSettler(address(0xBEEF));
        assertEq(pool.settler(), address(0xBEEF));
    }

    function testFuzz_lossAccounting(uint96 amount) public {
        amount = uint96(bound(amount, 1e18, 100e18));
        vm.prank(owner);
        token.mint(alice, 100e18);
        uint256 id = _approveAndStake(FocusPool.Goal.Sprint, amount, 0);
        uint256 potBefore = pool.pot();
        vm.warp(pool.getBet(id).deadline);
        vm.prank(settler);
        pool.settle(id, false);
        assertEq(token.balanceOf(pool.DEAD()) + (pool.pot() - potBefore), amount);
        assertEq(token.balanceOf(address(pool)), pool.pot());
    }

    // ---- gas budgets (measured + 10%; fail if a change makes users pay more) ----

    uint256 constant BUDGET_STAKE_WITH_PERMIT = 226_000;
    uint256 constant BUDGET_STAKE = 141_000;
    uint256 constant BUDGET_SETTLE_LOSS = 36_000;
    uint256 constant BUDGET_CLAIM = 17_500;
    uint256 constant BUDGET_REFUND = 13_500;

    function _used(uint256 before) internal view returns (uint256) {
        return before - gasleft();
    }

    function test_gasBudgets() public {
        uint256 pd = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(10e18, pd);
        vm.prank(alice);
        uint256 g = gasleft();
        uint256 id = pool.stakeWithPermit(FocusPool.Goal.Sprint, 10e18, 0, H, pd, v, r, s);
        uint256 gPermit = _used(g);

        vm.prank(settler);
        pool.settle(id, true);
        vm.prank(alice);
        g = gasleft();
        pool.claim(id);
        uint256 gClaim = _used(g);

        address b = _fresh("b");
        vm.prank(b);
        token.approve(address(pool), 10e18);
        vm.prank(b);
        g = gasleft();
        uint256 id2 = pool.stake(FocusPool.Goal.Sprint, 10e18, 0, H);
        uint256 gStake = _used(g);
        vm.warp(pool.getBet(id2).deadline);
        vm.prank(settler);
        g = gasleft();
        pool.settle(id2, false);
        uint256 gLoss = _used(g);

        address c = _fresh("c");
        uint256 id3 = _stakeAs(c, FocusPool.Goal.Sprint, 10e18, 0);
        vm.warp(pool.getBet(id3).deadline + 2 days + 1);
        vm.prank(c);
        g = gasleft();
        pool.refund(id3);
        uint256 gRefund = _used(g);

        emit log_named_uint("stakeWithPermit", gPermit);
        emit log_named_uint("stake", gStake);
        emit log_named_uint("settle(loss)", gLoss);
        emit log_named_uint("claim", gClaim);
        emit log_named_uint("refund", gRefund);
        assertLe(gPermit, BUDGET_STAKE_WITH_PERMIT);
        assertLe(gStake, BUDGET_STAKE);
        assertLe(gLoss, BUDGET_SETTLE_LOSS);
        assertLe(gClaim, BUDGET_CLAIM);
        assertLe(gRefund, BUDGET_REFUND);
    }
}
