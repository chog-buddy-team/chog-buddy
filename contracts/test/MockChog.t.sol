// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockChog} from "../src/MockChog.sol";

contract MockChogTest is Test {
    MockChog token;
    address owner = address(0xA11CE0);
    uint256 aliceKey = 0xA11CE;
    address alice;
    address spender = address(0x5BE);

    function setUp() public {
        alice = vm.addr(aliceKey);
        token = new MockChog(owner);
    }

    function test_metadata() public view {
        assertEq(token.name(), "Mock CHOG");
        assertEq(token.symbol(), "mCHOG");
        assertEq(token.decimals(), 18);
    }

    function test_faucetMints100() public {
        vm.prank(alice);
        token.faucet();
        assertEq(token.balanceOf(alice), 100e18);
    }

    function test_faucetCooldown() public {
        uint256 t0 = block.timestamp;
        vm.prank(alice);
        token.faucet();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MockChog.FaucetCooldown.selector, t0 + 1 days));
        token.faucet();
        vm.warp(t0 + 1 days);
        vm.prank(alice);
        token.faucet();
        assertEq(token.balanceOf(alice), 200e18);
    }

    function test_ownerMint() public {
        vm.prank(owner);
        token.mint(alice, 1000e18);
        assertEq(token.balanceOf(alice), 1000e18);
    }

    function test_strangerCannotMint() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.mint(alice, 1);
    }

    function test_permitSetsAllowance() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                alice,
                spender,
                5e18,
                token.nonces(alice),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        token.permit(alice, spender, 5e18, deadline, v, r, s);
        assertEq(token.allowance(alice, spender), 5e18);
    }
}
