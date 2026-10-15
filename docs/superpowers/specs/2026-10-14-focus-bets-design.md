# Focus Bets: design

Date: 2026-10-14. Status: draft for review. Owner: backend/contracts track.
Replaces the "Focus bets" paragraph in `docs/designs/chog-buddy.md` (Later phase).

## Goal

Owners stake mock $CHOG that they will focus for a set time. The Pet watches; hit the goal and you win your stake back plus a bonus; miss it and most of your stake funds future winners. It earns the $CHOG judging bonus and gives a daily reason to open the app (Retention).

Success:
- A judge can do a full cycle in about 6 minutes on Monad testnet: get tokens, stake on a 5-minute sprint (3 focus minutes needed), focus, see the result, claim. Every step is a real transaction they can open on the explorer.
- No real money: testnet and a mock token only.
- The contract never depends on the server to give users their tokens back (see Refund).

## Decisions (agreed 2026-10-14)

- **Mock $CHOG on Monad testnet.** Token address is a constructor argument, so the pool could point at another ERC-20 later.
- **Users send their own transaction** from a browser wallet. No gas sponsoring. The bet page links the Monad faucet (https://faucet.monad.xyz/) and has a "Get 100 test $CHOG" button.
- **Every bet is a personal challenge with its own clock.** No shared daily pool, no timezone lag. A win settles as soon as the goal is reached.
- **Focus = coding + design minutes**, measured by the Pet (idle time never counts).
- **OpenZeppelin v5** for all token logic, pinned as a git submodule.
- **Gas** is a first-class requirement (see Gas).

## Goals

| Goal | Focus needed | Window | Bonus on win |
|---|---|---|---|
| Sprint | 3 min | 5 min from stake (fixed) | +5% |
| 2h | 120 min | until the deadline the user picks | +10% |
| 4h | 240 min | until the deadline the user picks | +25% |
| 6h | 360 min | until the deadline the user picks | +50% |

For the hour goals the bet page sets the deadline to the owner's local midnight. The contract only checks it is achievable and bounded: `deadline >= now + focus minutes` and `deadline <= now + 24h`.

Stake per bet: 1 to 100 mock $CHOG. One open bet per wallet at a time.

## Money rules

- **Win:** stake back + bonus (`stake * bonusBps / 10000`, capped at 1% of the free pot per bet, so a crowd of faucet wallets can't reserve the whole pot). The bettor passes `minBonus`; the stake reverts with `BonusTooLow` if other stakes shrank the pot so the bonus fell below it (the page sends 95% of its estimate).
- **Lose:** 10% of the stake goes to `0x000000000000000000000000000000000000dEaD` (burned), 90% goes into the reward pot.
- **The bonus is reserved from the pot at stake time.** If the pot cannot cover it, the stake reverts with `PotTooLow`. A settled win can therefore always be paid in full.
- On a loss or refund the reserved bonus is released back to the pot.
- The team seeds the pot with mock $CHOG at launch. Anyone can add more with `fund`.
- **Refund (safety valve):** if a bet is still open 2 days after its deadline **and** the settler has sent nothing for 2 days (server down), the bettor can take their stake back. Their tokens can never be stuck, and a loser can't race a late loss settle while the server is alive.
- **Unclaimed wins:** 30 days after the deadline anyone can call `releaseBonus`, which returns the reserved bonus to the pot (the stake stays claimable).
- **Owner:** `withdrawUnreserved` takes out only what no bet has reserved. Ownership can't be renounced, so a leaked settler can always be replaced.

## Contracts (`contracts/`)

### `MockChog` (`src/MockChog.sol`)
- OpenZeppelin `ERC20("Mock CHOG", "mCHOG")` + `ERC20Permit` + `Ownable2Step`.
- `faucet()`: mints 100 mCHOG to the caller, at most once per 24h per address.
- `mint(to, amount)`: owner only, to seed the pot.

### `FocusPool` (`src/FocusPool.sol`)
- Uses OpenZeppelin `SafeERC20`, `ReentrancyGuard`, `Ownable2Step`.
- Immutable `token`. Mutable `settler` (owner sets it; zero address rejected).
- Goals are compile-time constants (no storage reads).

Bet storage, 2 slots per bet:
```
slot 1: address bettor | uint96 amount
slot 2: uint40 start | uint40 deadline | uint96 bonus | uint8 goal | uint8 status
plus:   bytes32 progressKeyHash   (fingerprint of the app's private progress key)
```
Status: `Open`, `Won`, `Lost`, `Claimed`, `Refunded`.

Functions:
- `stakeWithPermit(goal, amount, deadline, progressKeyHash, minBonus, permitDeadline, v, r, s) returns (betId)`: the permit and the transfer happen in one transaction (one transaction, two wallet prompts: sign permit, send tx). `stake(...)` without permit is also provided for wallets that already approved.
- `settle(betId, won)`: settler only, bet must be `Open`. A win only after `start + goal minutes` (so a server bug can't pay early), including a late report inside the grace period. A loss only after the deadline.
- `claim(betId)`: bettor only, bet must be `Won`. Pays stake + bonus.
- `refund(betId)`: bettor only, bet `Open` and `block.timestamp > deadline + 2 days`. Returns the stake.
- `fund(amount)`: anyone adds to the pot.
- `releaseBonus(betId)`, `withdrawUnreserved(to, amount)`: see Money rules.
- `setSettler(address)`: owner only.
- Views: `getBet(betId)`, `potAvailable()` (pot minus reserved bonuses), `openBetOf(address)`, `canRefund(betId)`.
- The token must be a plain 18-decimal ERC20 with no transfer fee; the constructor rejects other decimals.

Events: `Staked`, `Settled(betId, won)`, `Claimed`, `Refunded`, `Funded`, `SettlerChanged`.
Custom errors throughout. NatSpec only on the contract and on functions with non-obvious rules.

### Gas
- Monad charges the gas limit, so every function is kept small and predictable.
- Packed bet struct (above), immutable token, constant goal table, custom errors, `unchecked` where overflow is impossible.
- No loops anywhere. Settlement is one bet at a time; payouts are pull (`claim`).
- `forge snapshot` is committed. Budgets are set from the first snapshot + 10%, and a test fails if `stakeWithPermit`, `settle`, `claim` or `refund` goes over.

## Proving focus

The app, not the server, measures focus (it already tallies activity locally).

1. On stake, the bet page generates a random 32-byte **progress key**, puts `keccak256(key)` into the stake transaction, and hands the key to the Pet app through the app's loopback page (same mechanism as sign-in).
2. While the bet is open, the app posts `POST /api/focus/progress { betId, key, focusMinutes }` every 30 seconds, where `focusMinutes` is coding + design minutes since the stake.
3. The server reads the bet from chain, checks `keccak256(key) == progressKeyHash`, stores the latest minutes, and when `focusMinutes >= goal minutes` it calls `settle(betId, true)` at once.

Nobody else can report progress for your bet (they don't have the key), and this does not require owning a Chog, so judges in Judge Mode can bet.

The server bounds every report by real time:
- Total minutes never exceed the time from the stake to now, or to the deadline. Time after the deadline never counts; the grace period is only for late uploads of focus done before it.
- Each minute needs credit. Credit builds one minute per real minute from the stake, up to 2 minutes, and a report spends only the minutes it adds. A bigger jump is clamped to the credit (not rejected), so a Pet that was offline catches up. One forged report at the end gains 2 minutes, so a win needs reports through the whole bet.
- Report times come from the app server's clock only.

**Residual risk (accepted, from the 2026-10-15 audits):** progress is still self-reported. Someone who holds their own key and runs a script that posts on time through the whole bet wins every bet. Fixing this needs trusted hardware or a trusted measurer, which we don't have. Damage is bounded: mock tokens only, 100 per stake, bonus at most 1% of the free pot per bet. Labeled as such in the README.

## Backend (`web/`)

- `POST /api/focus/progress`: as above. 400 on bad input or more focus than time allows, 403 on wrong key, 409 if the bet is not open or past deadline + grace. Rate limit: one accepted report per bet per 20s (429).
- `POST /api/focus/check { betId }`: anyone may call. If the bet is open, the deadline + grace has passed and the goal was not reached, the server calls `settle(betId, false)`. Returns the bet's current status. The bet page calls it when the timer ends, so a lost sprint shows its result within seconds. Grace: 2 min for sprints, 15 min for hour goals (late uploads).
- Daily cron: also sweeps open bets past deadline + grace and settles them lost. It runs next to the Soul job (different wallets), on a 30 s budget, waits at most 15 s for each settle receipt, and saves a cursor, so it never hits the 60 s limit. A failed read or settle skips that bet until the next run.
- Only one settle transaction per bet is in flight at a time (`focus_settling` lock, taken over after 2 minutes), so parallel `check` calls can't burn settler gas. A reverted settle counts as a failure.
- `GET /focus`: the bet page (below).
- Tables `focus_reports` (minutes, credited_at, reported_at), `focus_sweep_cursor`, `focus_settling`, all keyed by the pool address, so a redeployed pool never sees an old pool's rows. Bet details are read from chain, never duplicated.
- New settler wallet `chog-settler` (testnet only), separate from the Soul writer so one leaked key cannot touch the other contract. Key in a Vercel Sensitive env var `SETTLER_KEY`, as approved for the writer.
- Env: `FOCUS_POOL`, `MOCK_CHOG`, `SETTLER_KEY`.

## Bet page (`web/app/focus`)

One page, served by our backend, opened by the Pet ("Bet on my focus" in the tray).
- Connect wallet (injected wallet via viem), switch to Monad testnet.
- Shows MON balance with the faucet link, mCHOG balance with "Get 100 test $CHOG", and the pot size.
- Pick goal + amount, see the expected bonus, then stake (permit signature + transaction). Staking only works when the page was opened from the app, since only the app can report focus.
- The progress key is saved in this browser **before** the stake is sent (matched to the bet later by its onchain hash), so a failed receipt wait or a closed tab can't lose it. The page can send it to the app again at any time and can find a Won bet for Claim later. The bet id comes from the `Staked` event.
- A Refund button shows when `canRefund` is true.
- Live status: countdown, focus minutes from the server, then "You won! Claim" or "Missed it".
- Every transaction links to MonadVision.
- Plain, small, readable. No design system work.

## What Farouk's app needs to do

- Tray item "Bet on my focus" opens `https://chog-buddy-api.vercel.app/focus`.
- Receive the progress key from the page on the loopback server.
- While a bet is open: post progress every 30 s (coding + design minutes since stake).
- On result: play the sprite kit's celebrate row (win) or sad row (loss).

## Deployment

- `forge script` deploys `MockChog` then `FocusPool(token)` with the `chog-deployer` keystore, sets the settler, mints and funds the pot (100,000 mCHOG).
- Verified on MonadVision (Sourcify). Addresses recorded in `contracts/DEPLOYMENTS.md`.

## Testing

- Foundry unit tests for every function and every revert, including: permit stake, pot too low, win before deadline, loss before deadline rejected, double claim, claim by stranger, refund too early, refund after 2 days, burn + pot accounting, reserved bonus released.
- Invariant test: the pool's token balance always equals `pot + sum(stakes of Open and Won bets)`, and `reserved <= pot`, where `pot` includes the reserved bonuses and `potAvailable = pot - reserved`.
- Fuzz amounts and deadlines.
- Backend: vitest for key checking, progress rules and settle decisions (pure functions), plus a local anvil end-to-end run like the Soul job.

## Out of scope

- Real $CHOG, mainnet, gas sponsoring.
- Shared daily pools, leaderboards (Chog Park may show results later).
- GitHub-commit bets, poke checks.
