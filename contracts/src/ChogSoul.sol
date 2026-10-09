// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Public, onchain Soul of each Chog (see CONTEXT.md). Written daily by one server wallet (ADR 0002).
contract ChogSoul {
    struct Soul {
        uint8 nightOwl;
        uint8 grinder;
        uint8 social;
        uint8 creator;
        uint32 level;
        uint16 ownerCount;
    }

    address public immutable admin;
    address public writer;
    mapping(uint256 => Soul) private souls;

    event SoulUpdated(uint256 indexed tokenId, Soul soul);
    event WriterChanged(address writer);

    error NotWriter();
    error NotAdmin();
    error LengthMismatch();
    error AxisOutOfRange();
    error ZeroAddress();

    constructor(address writer_) {
        if (writer_ == address(0)) revert ZeroAddress();
        admin = msg.sender;
        writer = writer_;
    }

    function setWriter(address w) external {
        if (msg.sender != admin) revert NotAdmin();
        if (w == address(0)) revert ZeroAddress();
        writer = w;
        emit WriterChanged(w);
    }

    function batchSet(uint256[] calldata ids, Soul[] calldata s) external {
        if (msg.sender != writer) revert NotWriter();
        if (ids.length != s.length) revert LengthMismatch();
        for (uint256 i; i < ids.length; i++) {
            Soul calldata x = s[i];
            if (x.nightOwl > 100 || x.grinder > 100 || x.social > 100 || x.creator > 100) revert AxisOutOfRange();
            souls[ids[i]] = x;
            emit SoulUpdated(ids[i], x);
        }
    }

    function getSoul(uint256 id) external view returns (Soul memory) {
        return souls[id];
    }
}
