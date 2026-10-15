// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title FocusPool
/// @notice Focus Bets: stake on a focus goal, win stake + bonus from the reward pot, or lose most of it to the pot.
/// @dev The settler (server) judges each bet; the contract never needs the server to return a stake (see `refund`).
///      The token must be a plain 18-decimal ERC-20 with no transfer fee and no transfer restrictions.
contract FocusPool is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    enum Goal {
        Sprint,
        TwoHours,
        FourHours,
        SixHours
    }

    enum Status {
        None,
        Open,
        Won,
        Lost,
        Claimed,
        Refunded
    }

    // Packed: slot 1 = bettor + amount, slot 2 = start + deadline + bonus + goal + status, slot 3 = key hash.
    struct Bet {
        address bettor;
        uint96 amount;
        uint40 start;
        uint40 deadline;
        uint96 bonus;
        Goal goal;
        Status status;
        bytes32 progressKeyHash;
    }

    uint256 public constant MIN_STAKE = 1e18;
    uint256 public constant MAX_STAKE = 100e18;
    uint256 public constant BURN_BPS = 1000;
    uint256 public constant REFUND_DELAY = 2 days;
    uint256 public constant SPRINT_WINDOW = 5 minutes;
    uint256 public constant MAX_WINDOW = 24 hours;
    uint256 public constant CLAIM_WINDOW = 30 days;
    /// @notice One bet reserves at most 1% of the available pot, so no group of bets can lock all of it.
    uint256 public constant MAX_BONUS_SHARE_BPS = 100;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token;
    address public settler;
    /// @notice Last time the settler acted; refunds open only after the settler has been silent for REFUND_DELAY.
    uint256 public lastSettlerActivity;

    /// @notice Reward pot, including bonuses already reserved for open bets.
    uint256 public pot;
    uint256 public reserved;
    uint256 public nextBetId = 1;
    mapping(address => uint256) public openBetOf;
    mapping(uint256 => Bet) private bets;

    event Staked(
        uint256 indexed betId, address indexed bettor, Goal goal, uint96 amount, uint40 deadline, uint96 bonus, bytes32 progressKeyHash
    );
    event Funded(address indexed from, uint256 amount);
    event Settled(uint256 indexed betId, bool won);
    event Claimed(uint256 indexed betId, uint256 payout);
    event Refunded(uint256 indexed betId);
    event SettlerChanged(address settler);
    event BonusReleased(uint256 indexed betId);
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error AmountOutOfRange();
    error BadDeadline();
    error AlreadyHasOpenBet();
    error PotTooLow();
    error BonusTooLow();
    error NotSettler();
    error NotOpen();
    error TooEarly();
    error NotBettor();
    error NotWon();
    error RenounceDisabled();
    error UnsupportedToken();

    constructor(IERC20 token_, address settler_, address owner_) Ownable(owner_) {
        if (address(token_) == address(0) || settler_ == address(0)) revert ZeroAddress();
        if (IERC20Metadata(address(token_)).decimals() != 18) revert UnsupportedToken();
        token = token_;
        settler = settler_;
        lastSettlerActivity = block.timestamp;
    }

    function goalParams(Goal g) public pure returns (uint16 focusMinutes, uint16 bonusBps) {
        if (g == Goal.Sprint) return (3, 500);
        if (g == Goal.TwoHours) return (120, 1000);
        if (g == Goal.FourHours) return (240, 2500);
        return (360, 5000);
    }

    /// @notice Stake on a goal. For `Sprint` the deadline argument is ignored (always 5 minutes from now).
    /// @dev Reverts with BonusTooLow if other stakes shrank the free pot so the bonus fell below `minBonus`.
    function stake(Goal goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash, uint96 minBonus)
        external
        nonReentrant
        returns (uint256)
    {
        return _stake(goal, amount, deadline, progressKeyHash, minBonus);
    }

    /// @notice `stake` with an EIP-2612 permit, so approve + stake is one transaction.
    /// @dev A failed permit is ignored: if someone already used the signature, the allowance is in place anyway.
    function stakeWithPermit(
        Goal goal,
        uint96 amount,
        uint40 deadline,
        bytes32 progressKeyHash,
        uint96 minBonus,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256) {
        try IERC20Permit(address(token)).permit(msg.sender, address(this), amount, permitDeadline, v, r, s) {} catch {}
        return _stake(goal, amount, deadline, progressKeyHash, minBonus);
    }

    /// @notice Settler records the result. A win needs the goal time to have passed since the stake; a loss needs the deadline.
    /// @dev A loss burns 10% of the stake and adds 90% to the pot; the reserved bonus is released either way.
    function settle(uint256 betId, bool won) external nonReentrant {
        if (msg.sender != settler) revert NotSettler();
        Bet storage b = bets[betId];
        if (b.status != Status.Open) revert NotOpen();
        lastSettlerActivity = block.timestamp;
        openBetOf[b.bettor] = 0;
        if (won) {
            (uint16 focusMinutes,) = goalParams(b.goal);
            if (block.timestamp < uint256(b.start) + uint256(focusMinutes) * 60) revert TooEarly();
            b.status = Status.Won;
            emit Settled(betId, true);
            return;
        }
        if (block.timestamp < b.deadline) revert TooEarly();
        b.status = Status.Lost;
        reserved -= b.bonus;
        uint256 burn = uint256(b.amount) * BURN_BPS / 10_000;
        pot += b.amount - burn;
        emit Settled(betId, false);
        token.safeTransfer(DEAD, burn);
    }

    function claim(uint256 betId) external nonReentrant {
        Bet storage b = bets[betId];
        if (b.bettor != msg.sender) revert NotBettor();
        if (b.status != Status.Won) revert NotWon();
        b.status = Status.Claimed;
        pot -= b.bonus;
        reserved -= b.bonus;
        uint256 payout = uint256(b.amount) + b.bonus;
        emit Claimed(betId, payout);
        token.safeTransfer(msg.sender, payout);
    }

    /// @notice Safety valve: take your stake back when the bet is unsettled 2 days after its deadline
    ///         and the settler has been silent for 2 days (server down). A busy settler never opens it.
    function refund(uint256 betId) external nonReentrant {
        Bet storage b = bets[betId];
        if (b.bettor != msg.sender) revert NotBettor();
        if (b.status != Status.Open) revert NotOpen();
        if (!_refundOpen(b)) revert TooEarly();
        b.status = Status.Refunded;
        openBetOf[msg.sender] = 0;
        reserved -= b.bonus;
        emit Refunded(betId);
        token.safeTransfer(msg.sender, b.amount);
    }

    function setSettler(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        settler = s;
        lastSettlerActivity = block.timestamp;
        emit SettlerChanged(s);
    }

    /// @notice After CLAIM_WINDOW, anyone can return an unclaimed win's bonus to the pot; the winner keeps the stake.
    function releaseBonus(uint256 betId) external {
        Bet storage b = bets[betId];
        if (b.status != Status.Won) revert NotWon();
        if (block.timestamp <= uint256(b.deadline) + CLAIM_WINDOW) revert TooEarly();
        reserved -= b.bonus;
        b.bonus = 0;
        emit BonusReleased(betId);
    }

    /// @notice Owner takes unreserved pot tokens out (e.g. to move to a new pool). Stakes and reserved bonuses stay.
    function withdrawUnreserved(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > pot - reserved) revert AmountOutOfRange();
        pot -= amount;
        emit Withdrawn(to, amount);
        token.safeTransfer(to, amount);
    }

    /// @dev Without an owner nobody could replace a leaked settler key.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function fund(uint256 amount) external nonReentrant {
        pot += amount;
        emit Funded(msg.sender, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function potAvailable() external view returns (uint256) {
        return pot - reserved;
    }

    function getBet(uint256 betId) external view returns (Bet memory) {
        return bets[betId];
    }

    function canRefund(uint256 betId) external view returns (bool) {
        Bet storage b = bets[betId];
        return b.status == Status.Open && _refundOpen(b);
    }

    function _refundOpen(Bet storage b) internal view returns (bool) {
        return block.timestamp > uint256(b.deadline) + REFUND_DELAY && block.timestamp > lastSettlerActivity + REFUND_DELAY;
    }

    function _stake(Goal goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash, uint96 minBonus)
        internal
        returns (uint256 betId)
    {
        if (amount < MIN_STAKE || amount > MAX_STAKE) revert AmountOutOfRange();
        if (openBetOf[msg.sender] != 0) revert AlreadyHasOpenBet();
        (uint16 focusMinutes, uint16 bonusBps) = goalParams(goal);
        uint40 start = uint40(block.timestamp);
        if (goal == Goal.Sprint) {
            deadline = uint40(start + SPRINT_WINDOW);
        } else if (deadline < start + uint256(focusMinutes) * 60 || deadline > start + MAX_WINDOW) {
            revert BadDeadline();
        }
        uint256 available = pot - reserved;
        uint256 bonus = uint256(amount) * bonusBps / 10_000;
        uint256 cap = available * MAX_BONUS_SHARE_BPS / 10_000;
        if (bonus > cap) bonus = cap;
        if (bonus == 0) revert PotTooLow();
        if (bonus < minBonus) revert BonusTooLow();

        reserved += bonus;
        betId = nextBetId++;
        openBetOf[msg.sender] = betId;
        bets[betId] = Bet(msg.sender, amount, start, deadline, uint96(bonus), goal, Status.Open, progressKeyHash);
        emit Staked(betId, msg.sender, goal, amount, deadline, uint96(bonus), progressKeyHash);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }
}
