// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title FocusPool
/// @notice Focus Bets: stake on a focus goal, win stake + bonus from the reward pot, or lose most of it to the pot.
/// @dev The settler (server) judges each bet; the contract never needs the server to return a stake (see `refund`).
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
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token;
    address public settler;

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

    error ZeroAddress();
    error AmountOutOfRange();
    error BadDeadline();
    error AlreadyHasOpenBet();
    error PotTooLow();
    error NotSettler();
    error NotOpen();
    error TooEarly();
    error NotBettor();
    error NotWon();

    constructor(IERC20 token_, address settler_, address owner_) Ownable(owner_) {
        if (address(token_) == address(0) || settler_ == address(0)) revert ZeroAddress();
        token = token_;
        settler = settler_;
    }

    function goalParams(Goal g) public pure returns (uint16 focusMinutes, uint16 bonusBps) {
        if (g == Goal.Sprint) return (3, 500);
        if (g == Goal.TwoHours) return (120, 1000);
        if (g == Goal.FourHours) return (240, 2500);
        return (360, 5000);
    }

    /// @notice Stake on a goal. For `Sprint` the deadline argument is ignored (always 5 minutes from now).
    function stake(Goal goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash) external nonReentrant returns (uint256) {
        return _stake(goal, amount, deadline, progressKeyHash);
    }

    /// @notice `stake` with an EIP-2612 permit, so approve + stake is one transaction.
    /// @dev A failed permit is ignored: if someone already used the signature, the allowance is in place anyway.
    function stakeWithPermit(
        Goal goal,
        uint96 amount,
        uint40 deadline,
        bytes32 progressKeyHash,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256) {
        try IERC20Permit(address(token)).permit(msg.sender, address(this), amount, permitDeadline, v, r, s) {} catch {}
        return _stake(goal, amount, deadline, progressKeyHash);
    }

    /// @notice Settler records the result. A win may be settled any time while open; a loss only once the deadline has passed.
    /// @dev A loss burns 10% of the stake and adds 90% to the pot; the reserved bonus is released either way.
    function settle(uint256 betId, bool won) external {
        if (msg.sender != settler) revert NotSettler();
        Bet storage b = bets[betId];
        if (b.status != Status.Open) revert NotOpen();
        openBetOf[b.bettor] = 0;
        if (won) {
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

    /// @notice Safety valve: take your stake back if the bet is still unsettled 2 days after its deadline.
    function refund(uint256 betId) external nonReentrant {
        Bet storage b = bets[betId];
        if (b.bettor != msg.sender) revert NotBettor();
        if (b.status != Status.Open) revert NotOpen();
        if (block.timestamp <= uint256(b.deadline) + REFUND_DELAY) revert TooEarly();
        b.status = Status.Refunded;
        openBetOf[msg.sender] = 0;
        reserved -= b.bonus;
        emit Refunded(betId);
        token.safeTransfer(msg.sender, b.amount);
    }

    function setSettler(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        settler = s;
        emit SettlerChanged(s);
    }

    function fund(uint256 amount) external {
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

    function _stake(Goal goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash) internal returns (uint256 betId) {
        if (amount < MIN_STAKE || amount > MAX_STAKE) revert AmountOutOfRange();
        if (openBetOf[msg.sender] != 0) revert AlreadyHasOpenBet();
        (uint16 focusMinutes, uint16 bonusBps) = goalParams(goal);
        uint40 start = uint40(block.timestamp);
        if (goal == Goal.Sprint) {
            deadline = uint40(start + SPRINT_WINDOW);
        } else if (deadline < start + uint256(focusMinutes) * 60 || deadline > start + MAX_WINDOW) {
            revert BadDeadline();
        }
        uint96 bonus = uint96(uint256(amount) * bonusBps / 10_000);
        if (pot - reserved < bonus) revert PotTooLow();

        reserved += bonus;
        betId = nextBetId++;
        openBetOf[msg.sender] = betId;
        bets[betId] = Bet(msg.sender, amount, start, deadline, bonus, goal, Status.Open, progressKeyHash);
        emit Staked(betId, msg.sender, goal, amount, deadline, bonus, progressKeyHash);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }
}
