// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChogSoul} from "../src/ChogSoul.sol";

contract ChogSoulTest is Test {
    ChogSoul soul;
    address writer = address(0xBEEF);

    function setUp() public {
        soul = new ChogSoul(writer);
    }

    function _one(uint256 id, uint8 v) internal pure returns (uint256[] memory ids, ChogSoul.Soul[] memory s) {
        ids = new uint256[](1);
        ids[0] = id;
        s = new ChogSoul.Soul[](1);
        s[0] = ChogSoul.Soul(v, v, v, v, 3, 1);
    }

    function test_writerCanBatchSet() public {
        (uint256[] memory ids, ChogSoul.Soul[] memory s) = _one(5, 60);
        vm.prank(writer);
        soul.batchSet(ids, s);
        ChogSoul.Soul memory got = soul.getSoul(5);
        assertEq(got.nightOwl, 60);
        assertEq(got.level, 3);
        assertEq(got.ownerCount, 1);
    }

    function test_unsetSoulIsZero() public view {
        assertEq(soul.getSoul(1).level, 0);
    }

    function test_nonWriterReverts() public {
        (uint256[] memory ids, ChogSoul.Soul[] memory s) = _one(5, 60);
        vm.expectRevert(ChogSoul.NotWriter.selector);
        soul.batchSet(ids, s);
    }

    function test_lengthMismatchReverts() public {
        (uint256[] memory ids,) = _one(5, 60);
        ChogSoul.Soul[] memory none = new ChogSoul.Soul[](0);
        vm.prank(writer);
        vm.expectRevert(ChogSoul.LengthMismatch.selector);
        soul.batchSet(ids, none);
    }

    function test_axisAbove100Reverts() public {
        (uint256[] memory ids, ChogSoul.Soul[] memory s) = _one(5, 101);
        vm.prank(writer);
        vm.expectRevert(ChogSoul.AxisOutOfRange.selector);
        soul.batchSet(ids, s);
    }

    function test_emitsSoulUpdated() public {
        (uint256[] memory ids, ChogSoul.Soul[] memory s) = _one(7, 50);
        vm.expectEmit(true, false, false, true);
        emit ChogSoul.SoulUpdated(7, s[0]);
        vm.prank(writer);
        soul.batchSet(ids, s);
    }

    function test_adminRotatesWriter() public {
        soul.setWriter(address(0xCAFE));
        assertEq(soul.writer(), address(0xCAFE));
        vm.prank(address(0xBAD));
        vm.expectRevert(ChogSoul.NotAdmin.selector);
        soul.setWriter(address(0xBAD));
    }

    function test_constructorRejectsZeroWriter() public {
        vm.expectRevert(ChogSoul.ZeroAddress.selector);
        new ChogSoul(address(0));
    }

    function test_setWriterRejectsZero() public {
        vm.expectRevert(ChogSoul.ZeroAddress.selector);
        soul.setWriter(address(0));
    }

    function test_batchOf100Fits() public {
        uint256[] memory ids = new uint256[](100);
        ChogSoul.Soul[] memory s = new ChogSoul.Soul[](100);
        for (uint256 i; i < 100; i++) {
            ids[i] = i + 1;
            s[i] = ChogSoul.Soul(50, 50, 50, 50, 1, 1);
        }
        vm.prank(writer);
        soul.batchSet(ids, s);
        assertEq(soul.getSoul(100).level, 1);
    }
}
