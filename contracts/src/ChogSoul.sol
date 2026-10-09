// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChogSoul
/// @notice Public, onchain Soul of each Chog (see CONTEXT.md). Written daily by one server wallet (ADR 0002).
/// @dev Souls are keyed by Chog Genesis token ID, so a Soul stays with the token when it changes hands.
contract ChogSoul {
    /// @notice A Chog's Soul. Axes are 0-100; level and ownerCount only grow.
    /// @dev Packs into one storage slot (4x uint8 + uint32 + uint16 = 80 bits).
    struct Soul {
        uint8 nightOwl;
        uint8 grinder;
        uint8 social;
        uint8 creator;
        uint32 level;
        uint16 ownerCount;
    }

    /// @notice Deployer; the only account that can change the writer.
    address public immutable admin;
    /// @notice Server wallet allowed to write Souls.
    address public writer;
    mapping(uint256 => Soul) private souls;

    /// @notice Emitted for every Soul written in a batch.
    event SoulUpdated(uint256 indexed tokenId, Soul soul);
    /// @notice Emitted when the admin rotates the writer key.
    event WriterChanged(address writer);

    error NotWriter();
    error NotAdmin();
    error LengthMismatch();
    error AxisOutOfRange();
    error ZeroAddress();

    /// @param writer_ Initial writer; must not be the zero address.
    constructor(address writer_) {
        if (writer_ == address(0)) revert ZeroAddress();
        admin = msg.sender;
        writer = writer_;
    }

    /// @notice Replace the writer, e.g. after a key leak. Admin only.
    /// @param w New writer; must not be the zero address.
    function setWriter(address w) external {
        if (msg.sender != admin) revert NotAdmin();
        if (w == address(0)) revert ZeroAddress();
        writer = w;
        emit WriterChanged(w);
    }

    /// @notice Write many Souls in one transaction. Writer only.
    /// @dev Overwrites whole Souls; Drift rules are enforced off-chain by the server (packages/core).
    /// @param ids Chog token IDs.
    /// @param s Souls, same order and length as `ids`.
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

    /// @notice Read a Chog's Soul. Returns all zeros if it was never written (level 0 = no Soul yet).
    function getSoul(uint256 id) external view returns (Soul memory) {
        return souls[id];
    }
}
