# Focus Bets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners stake mock $CHOG on a focus goal; the Pet reports focus; the server settles; winners claim stake + bonus from a reward pot.

**Architecture:** Two contracts in `contracts/` (`MockChog` ERC-20 with permit and a faucet, `FocusPool` holding stakes and a reward pot). The server (`web/`) only judges: it checks app progress reports against an onchain key hash and calls `settle`. A small bet page in `web/app/focus` lets a wallet stake in one transaction.

**Tech Stack:** Foundry, Solidity 0.8.24, OpenZeppelin Contracts v5 (pinned submodule); Next.js 16, viem, Neon, vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-focus-bets-design.md`

## Global Constraints

- Monad testnet (chain 10143) only. Mock token only.
- OpenZeppelin v5 for token logic: `ERC20`, `ERC20Permit`, `SafeERC20`, `ReentrancyGuard`, `Ownable2Step`.
- Goals (id, focus minutes, window, bonus): `0 Sprint` 3 min, fixed 5 min window, 500 bps; `1 TwoHours` 120 min, 1000 bps; `2 FourHours` 240 min, 2500 bps; `3 SixHours` 360 min, 5000 bps.
- Stake 1 to 100 mCHOG (`1e18` to `100e18`). One open bet per wallet.
- Hour-goal deadline: `deadline >= now + minutes*60` and `deadline <= now + 24 hours`.
- Loss: 10% (1000 bps) to `0x000000000000000000000000000000000000dEaD`, 90% to the pot. Bonus reserved at stake time. Refund allowed `deadline + 2 days` after an unsettled deadline.
- No loops in contracts. Pull payouts.
- `settle(betId, true)` is allowed whenever the bet is `Open` (a report sent before the deadline may arrive inside the grace period); `settle(betId, false)` only at or after the deadline. The server rejects reports after deadline + grace.
- Keys: Foundry keystores only (`chog-deployer`, new `chog-settler`). Server settler key only in Vercel Sensitive env `SETTLER_KEY`.
- Build and deploy contracts from WSL forge only (Windows forge breaks the cache). Every command handed to the owner is dry-run in WSL first.
- NatSpec only on contracts and non-obvious functions. No AI attribution in commits or PRs.

## Review Focus

1. **Permit front-run:** someone submits the user's permit signature first, so `permit` reverts. `stakeWithPermit` must still succeed when the allowance is already enough (OpenZeppelin's try/catch pattern). Test in Task 2.
2. **Boundary deadlines:** `deadline == now + minutes*60` and `deadline == now + 24h` accepted; one second outside either rejected. Test in Task 2.
3. **Settle/refund race:** after a refund, `settle` must revert `NotOpen`; after a settle, `refund` must revert `NotOpen`. Test in Task 3.
4. **Impossible progress:** reports with more focus minutes than minutes elapsed since the stake, negative numbers or non-integers are rejected (400), and a lower number than already stored never replaces it. Test in Task 5.
5. **Odd amounts:** a stake like `1e18 + 1` must keep the accounting invariant exact (no wei lost to rounding). Covered by the fuzz + invariant tests in Task 3.

---

## File Structure

```
contracts/
  lib/openzeppelin-contracts/        submodule, pinned v5 tag
  remappings.txt                     @openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
  src/MockChog.sol                   mock token + faucet
  src/FocusPool.sol                  stakes, reward pot, settle/claim/refund
  test/MockChog.t.sol
  test/FocusPool.t.sol               unit + fuzz
  test/FocusPool.invariant.t.sol     balance invariant with a handler
  script/DeployFocus.s.sol
  .gas-snapshot                      committed gas budgets
web/
  lib/focus.ts                       pure rules: goals, body parsing, decisions
  lib/focus-chain.ts                 ABI, readBet, settleBet, nextBetId
  lib/focus-sweep.ts                 daily sweep of expired open bets
  lib/focus-page.ts                  pure helpers for the bet page
  app/api/focus/progress/route.ts
  app/api/focus/check/route.ts
  app/focus/page.tsx                 bet page (client)
  test/focus.test.ts, test/focus-page.test.ts
  db/schema.sql                      + focus_progress
```

---

### Task 1: OpenZeppelin + MockChog

**Files:**
- Create: `contracts/remappings.txt`, `contracts/src/MockChog.sol`, `contracts/test/MockChog.t.sol`
- Modify: `.gitmodules` (new submodule)

**Interfaces:**
- Produces: `contract MockChog is ERC20, ERC20Permit, Ownable2Step` with `constructor(address owner_)`, `uint256 public constant FAUCET_AMOUNT = 100e18`, `uint256 public constant FAUCET_COOLDOWN = 1 days`, `mapping(address => uint256) public lastFaucet`, `function faucet() external`, `function mint(address to, uint256 amount) external onlyOwner`, `error FaucetCooldown(uint256 nextAt)`. Name `"Mock CHOG"`, symbol `"mCHOG"`, 18 decimals.

- [ ] **Step 1: Add OpenZeppelin** (from the repo root, WSL)

```bash
git submodule add --depth 1 https://github.com/OpenZeppelin/openzeppelin-contracts contracts/lib/openzeppelin-contracts
cd contracts/lib/openzeppelin-contracts && git fetch --depth 1 origin tag v5.4.0 && git checkout v5.4.0
```
If `v5.4.0` is not the newest v5 tag at execution time, use the newest `v5.x.y` and note it in the commit. Write `contracts/remappings.txt` with the one line from File Structure.

- [ ] **Step 2: Write failing tests** in `contracts/test/MockChog.t.sol`:
  - `test_metadata`: name `"Mock CHOG"`, symbol `"mCHOG"`, decimals 18.
  - `test_faucetMints100`: `vm.prank(alice); token.faucet();` → `balanceOf(alice) == 100e18`.
  - `test_faucetCooldown`: second call within `1 days` reverts `abi.encodeWithSelector(MockChog.FaucetCooldown.selector, t0 + 1 days)`; after `vm.warp(t0 + 1 days)` it succeeds (balance 200e18).
  - `test_ownerMint` / `test_strangerCannotMint`: owner mints 1000e18; non-owner reverts `OwnableUnauthorizedAccount`.
  - `test_permitSetsAllowance`: sign an EIP-2612 permit with `vm.sign` for alice's key; `permit(...)` → `allowance(alice, spender) == 5e18`.

- [ ] **Step 3: Run** `cd contracts && forge test --match-contract MockChogTest` → FAIL (MockChog not found).

- [ ] **Step 4: Implement `contracts/src/MockChog.sol`.** First faucet call is always allowed (`lastFaucet == 0`). One NatSpec `@notice` on the contract saying it is a testnet mock.

- [ ] **Step 5: Run** `forge test --match-contract MockChogTest` → all PASS.

- [ ] **Step 6: Commit** `feat(contracts): MockChog test token with faucet and permit` (include `.gitmodules`, the submodule and `remappings.txt`).

---

### Task 2: FocusPool staking

**Files:**
- Create: `contracts/src/FocusPool.sol`, `contracts/test/FocusPool.t.sol`

**Interfaces:**
- Consumes: `MockChog` (Task 1) as the test token.
- Produces:
  - `enum Goal { Sprint, TwoHours, FourHours, SixHours }`
  - `enum Status { None, Open, Won, Lost, Claimed, Refunded }`
  - `struct Bet { address bettor; uint96 amount; uint40 start; uint40 deadline; uint96 bonus; Goal goal; Status status; bytes32 progressKeyHash; }` (field order fixed: two packed slots + the hash)
  - constants `MIN_STAKE = 1e18`, `MAX_STAKE = 100e18`, `BURN_BPS = 1000`, `REFUND_DELAY = 2 days`, `SPRINT_WINDOW = 5 minutes`, `MAX_WINDOW = 24 hours`, `DEAD = 0x000000000000000000000000000000000000dEaD`
  - `function goalParams(Goal g) public pure returns (uint16 focusMinutes, uint16 bonusBps)`, values from Global Constraints
  - `constructor(IERC20 token_, address settler_, address owner_)`, `IERC20 public immutable token`, `address public settler`
  - `uint256 public pot; uint256 public reserved; uint256 public nextBetId = 1;` `mapping(address => uint256) public openBetOf;`
  - `function stake(Goal goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash) external returns (uint256 betId)`
  - `function stakeWithPermit(Goal goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s) external returns (uint256 betId)`
  - `function fund(uint256 amount) external`, `function potAvailable() external view returns (uint256)`, `function getBet(uint256 betId) external view returns (Bet memory)`
  - events `Staked(uint256 indexed betId, address indexed bettor, Goal goal, uint96 amount, uint40 deadline, uint96 bonus, bytes32 progressKeyHash)`, `Funded(address indexed from, uint256 amount)`
  - errors `ZeroAddress()`, `AmountOutOfRange()`, `BadDeadline()`, `AlreadyHasOpenBet()`, `PotTooLow()`
  - For `Goal.Sprint` the `deadline` argument is ignored and set to `block.timestamp + SPRINT_WINDOW`.

- [ ] **Step 1: Write failing tests** (setUp: deploy token + pool, owner mints and `fund(10_000e18)`, alice gets 100e18 via faucet):
  - `test_stakeSprint`: alice approves + `stake(Sprint, 10e18, 0, h)` → betId 1, `getBet(1)` has deadline `now + 300`, bonus `0.5e18`, status `Open`; `reserved == 0.5e18`; `openBetOf(alice) == 1`; pool balance `10_010e18`.
  - `test_stakeWithPermit`: same through a permit signature, no prior `approve`.
  - `test_permitFrontRunStillStakes` (Review Focus 1): call `token.permit(...)` with alice's signature first, then `stakeWithPermit` with the same signature → succeeds.
  - `test_hourGoalDeadlineBounds` (Review Focus 2): `TwoHours` accepts `now + 7200` and `now + 86400`; reverts `BadDeadline` at `now + 7199` and `now + 86401`.
  - `test_amountBounds`: `1e18` and `100e18` accepted; `1e18 - 1` and `100e18 + 1` revert `AmountOutOfRange`.
  - `test_oneOpenBet`: second stake while open reverts `AlreadyHasOpenBet`.
  - `test_potTooLow`: fresh pool with `fund(1e18)`; `SixHours` 10e18 (bonus 5e18) reverts `PotTooLow`.
  - `test_fundAddsToPot`: `fund(5e18)` → `pot` +5e18, emits `Funded`.
  - `testFuzz_hourDeadline(uint40 offset)`: for `TwoHours`, `stake` succeeds iff `7200 <= offset <= 86400`, else reverts `BadDeadline`.
  - `test_constructorRejectsZero`: zero token, settler or owner reverts `ZeroAddress`.

- [ ] **Step 2: Run** `forge test --match-contract FocusPoolTest` → FAIL.

- [ ] **Step 3: Implement staking in `FocusPool.sol`.** `bonus = amount * bonusBps / 10_000`; require `pot - reserved >= bonus`; `reserved += bonus`; transfer in with `safeTransferFrom` after the effects (checks-effects-interactions); `nonReentrant` on both stake functions. `stakeWithPermit` wraps `IERC20Permit(address(token)).permit` in `try/catch` and continues (the allowance check in `transferFrom` is the real guard).

- [ ] **Step 4: Run** → all PASS.

- [ ] **Step 5: Commit** `feat(contracts): FocusPool staking with reserved bonus`.

---

### Task 3: Settle, claim, refund, accounting, gas budgets

**Files:**
- Modify: `contracts/src/FocusPool.sol`, `contracts/test/FocusPool.t.sol`
- Create: `contracts/test/FocusPool.invariant.t.sol`, `contracts/.gas-snapshot`

**Interfaces:**
- Produces: `function settle(uint256 betId, bool won) external` (settler only), `function claim(uint256 betId) external`, `function refund(uint256 betId) external`, `function setSettler(address s) external onlyOwner`; events `Settled(uint256 indexed betId, bool won)`, `Claimed(uint256 indexed betId, uint256 payout)`, `Refunded(uint256 indexed betId)`, `SettlerChanged(address settler)`; errors `NotSettler()`, `NotOpen()`, `TooEarly()`, `NotBettor()`, `NotWon()`.

Accounting (exact):
- win: `status = Won`, `openBetOf[bettor] = 0`. On `claim`: `pot -= bonus; reserved -= bonus; status = Claimed`; pay `amount + bonus`.
- loss (only `block.timestamp >= deadline`): `reserved -= bonus; burn = amount * BURN_BPS / 10_000; pot += amount - burn; status = Lost; openBetOf = 0`; send `burn` to `DEAD`.
- refund (bettor, `Open`, `block.timestamp > deadline + REFUND_DELAY`): `reserved -= bonus; status = Refunded; openBetOf = 0`; pay `amount`.

- [ ] **Step 1: Write failing tests:**
  - `test_winAnytimeThenClaim`: settler `settle(1, true)` 10 s after stake; alice `claim(1)` → +10.5e18; `pot` −0.5e18; `reserved == 0`; status `Claimed`.
  - `test_lossOnlyAfterDeadline`: `settle(1, false)` before deadline reverts `TooEarly`; after `vm.warp(deadline)` succeeds; `DEAD` balance +1e18; `pot` +9e18; `reserved == 0`.
  - `test_onlySettler`, `test_onlyBettorClaims` (`NotBettor`), `test_claimTwice` (`NotWon`), `test_claimLost` (`NotWon`).
  - `test_refundTooEarly` reverts `TooEarly` at `deadline + 2 days`; `test_refundAfterDelay` succeeds at `deadline + 2 days + 1`, returns 10e18, `reserved == 0`.
  - `test_settleAfterRefundReverts` and `test_refundAfterSettleReverts` (Review Focus 3): both `NotOpen`.
  - `test_newBetAfterSettle`: after a settle, alice can stake again.
  - `test_setSettler`: owner sets; zero reverts `ZeroAddress`; stranger reverts.
  - `testFuzz_lossAccounting(uint96 amount)`: bound to `[MIN_STAKE, MAX_STAKE]` (includes `1e18 + 1`, Review Focus 5); after a loss `burn + potDelta == amount` exactly.
  - Invariant (`FocusPool.invariant.t.sol`, handler that stakes/settles/claims/refunds/warps with random actors): `token.balanceOf(pool) == pool.pot() + sumOpenAndWonStakes` and `pool.reserved() <= pool.pot()`.

- [ ] **Step 2: Run** `forge test` → new tests FAIL.

- [ ] **Step 3: Implement** the three functions + `setSettler` with the accounting above. `nonReentrant` on `claim` and `refund`. No loops.

- [ ] **Step 4: Run** `forge test` → all PASS (unit, fuzz, invariant).

- [ ] **Step 5: Gas budget.** Run `forge snapshot` and commit `.gas-snapshot`. From then on `forge snapshot --check --tolerance 10` must pass in every later change.

- [ ] **Step 6: Commit** `feat(contracts): FocusPool settle, claim, refund with gas snapshot`.

---

### Task 4: Deploy script and testnet deploy

**Files:**
- Create: `contracts/script/DeployFocus.s.sol`
- Modify: `contracts/DEPLOYMENTS.md`, `contracts/.env.example`

**Interfaces:**
- Consumes: `MockChog(owner)`, `FocusPool(token, settler, owner)`.
- Produces: deployed `MOCK_CHOG` and `FOCUS_POOL` addresses on chain 10143.

- [ ] **Step 1: Script.** `run()` reads `SETTLER_ADDRESS` with `vm.envAddress`, uses `msg.sender` as owner, deploys both, mints `100_000e18` to the owner, approves and `fund(100_000e18)`, logs both addresses.

- [ ] **Step 2: Local dry run** against anvil (`--chain-id 10143`) with anvil's public dev key: script succeeds, `pot() == 100_000e18`.

- [ ] **Step 3: Owner creates the settler wallet** (owner runs, WSL): `cast wallet new`, then `cast wallet import chog-settler --interactive`; funds it from https://faucet.monad.xyz/. Add `SETTLER_ADDRESS` to `contracts/.env.example`.

- [ ] **Step 4: Owner deploys** (WSL, dry-run the exact line first without `--broadcast`):
```bash
SETTLER_ADDRESS=<settler> ~/.foundry/bin/forge script script/DeployFocus.s.sol --rpc-url monad_testnet --account chog-deployer --broadcast
```

- [ ] **Step 5: Verify** both on Sourcify (`forge verify-contract ... --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/`). Expected `exact_match` for both. Record addresses in `DEPLOYMENTS.md`.

- [ ] **Step 6: Commit** `chore(contracts): deploy MockChog and FocusPool to Monad testnet`.

---

### Task 5: Backend rules (pure)

**Files:**
- Create: `web/lib/focus.ts`, `web/test/focus.test.ts`

**Interfaces:**
- Produces:
  - `GOALS: readonly { id: 0|1|2|3; name: 'sprint'|'2h'|'4h'|'6h'; focusMinutes: number; bonusBps: number; graceMs: number }[]` (grace 120_000 ms for sprint, 900_000 for hour goals)
  - `type OnchainBet = { betId: bigint; bettor: Address; amount: bigint; start: number; deadline: number; bonus: bigint; goal: 0|1|2|3; status: 'None'|'Open'|'Won'|'Lost'|'Claimed'|'Refunded'; progressKeyHash: Hex }`
  - `keyHashOf(key: Hex): Hex` (keccak256 of the 32 bytes)
  - `parseProgressBody(x: unknown): { betId: bigint; key: Hex; focusMinutes: number }` (throws `TypeError`)
  - `decideProgress(bet: OnchainBet, report: { key: Hex; focusMinutes: number }, storedMinutes: number | null, nowMs: number): { action: 'reject'; status: 403|409|400; error: string } | { action: 'store' | 'win'; minutes: number }`
  - `decideCheck(bet: OnchainBet, storedMinutes: number | null, nowMs: number): 'lose' | 'wait' | 'done'`

- [ ] **Step 1: Write failing tests:**
  - `parseProgressBody` accepts `{ betId: '12', key: 0x+64 hex, focusMinutes: 2 }`; rejects non-integer, negative, missing key, key not 32 bytes.
  - `decideProgress`: wrong key → 403; bet not `Open` → 409; `focusMinutes` > minutes since `start` (+1 rounding) → 400 (Review Focus 4); report at or above goal → `win`; below goal → `store` with `max(stored, reported)` (Review Focus 4); report after `deadline + grace` → 409.
  - `decideCheck`: open + now ≥ deadline + grace + stored < goal → `lose`; before that → `wait`; not open → `done`; stored ≥ goal (win not yet settled) → `wait`.

- [ ] **Step 2: Run** `npm test -w web` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(web): Focus Bet rules`.

---

### Task 6: Backend chain access, routes, sweep

**Files:**
- Create: `web/lib/focus-chain.ts`, `web/lib/focus-sweep.ts`, `web/app/api/focus/progress/route.ts`, `web/app/api/focus/check/route.ts`
- Modify: `web/app/api/cron/soul/route.ts` (call the sweep, never blocking the Soul job), `web/db/schema.sql`, `web/.env.example`

**Interfaces:**
- Consumes: Task 5 functions; `sql` (`web/lib/db.ts`).
- Produces:
  - `focusPoolAbi` (parseAbi of the Task 2/3 functions and `Bet` struct)
  - `readBet(betId: bigint): Promise<OnchainBet>`, `nextBetId(): Promise<bigint>`, `settleBet(betId: bigint, won: boolean): Promise<Hex>` (waits for the receipt)
  - `sweepExpiredBets(nowMs?: number): Promise<{ checked: number; lost: number }>`: walks bet ids from the lowest still-open id it remembers (table `focus_cursor`) to `nextBetId - 1`, at most 300 per run, settling `lose` decisions
  - `POST /api/focus/progress` → `{ status, minutes }`; `POST /api/focus/check { betId }` → `{ status }`
  - Env: `FOCUS_POOL`, `SETTLER_KEY`, optional `FOCUS_RPC_URL` (local anvil); chain `monadTestnet`.
  - Tables: `focus_progress (bet_id bigint primary key, minutes int not null, reported_at timestamptz not null default now())` and `focus_cursor (id int primary key default 1, next_open bigint not null)`.

- [ ] **Step 1:** Write `focus-chain.ts` and both routes as thin wrappers: parse → `readBet` → decide (Task 5) → write `focus_progress` / `settleBet` → respond. Progress: at most one accepted report per bet per 20 s (`reported_at`), otherwise 429.
- [ ] **Step 2:** Add the schema and apply it to Neon (all `if not exists`).
- [ ] **Step 3: End to end on anvil** (chain 10143, contracts from the Task 4 script, `FOCUS_RPC_URL=http://127.0.0.1:8545`, dev server):
  - sprint stake by a test wallet → progress 1 min `store` → progress 3 min → `Won` onchain within one request; claim works.
  - second sprint, progress 1 min, `vm`/anvil `evm_increaseTime` past deadline + 2 min → `/check` returns `Lost`; `DEAD` +10%.
  - wrong key → 403; too-fast report → 429; report claiming 5 min after 1 min elapsed → 400.
  - cron call → sweep settles a third expired bet.
  - Clean up the test rows.
- [ ] **Step 4:** `npm test -w web` and `npm run build -w web` pass.
- [ ] **Step 5: Commit** `feat(web): Focus Bet progress, check and daily sweep`.

---

### Task 7: Bet page

**Files:**
- Create: `web/lib/focus-page.ts`, `web/test/focus-page.test.ts`, `web/app/focus/page.tsx`
- Modify: `web/.env.example` (`NEXT_PUBLIC_FOCUS_POOL`, `NEXT_PUBLIC_MOCK_CHOG`)

**Interfaces:**
- Consumes: deployed addresses (Task 4), `/api/focus/check` (Task 6), `GOALS` (Task 5).
- Produces:
  - `localMidnightDeadline(now: Date): number` (unix seconds of the next local midnight)
  - `canPickGoal(goalId: 0|1|2|3, now: Date): boolean` (sprint always; hour goal only if `localMidnightDeadline(now) - now >= focusMinutes*60`)
  - `newProgressKey(): Hex` (32 random bytes via `crypto.getRandomValues`)
  - Page at `/focus?port=<loopback>&state=<32 hex>` (same parameters and validation as `/connect`).

- [ ] **Step 1: Failing tests** for the three helpers: midnight from 23:30 local is 30 min away; `canPickGoal(1, 23:00)` false, `canPickGoal(1, 20:00)` true, `canPickGoal(0, 23:59)` true; key is `0x` + 64 hex and two calls differ.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement helpers.** **Step 4: Run** → PASS.
- [ ] **Step 5: Page.** Connect injected wallet (viem), `wallet_switchEthereumChain` / `wallet_addEthereumChain` to 10143; show MON balance + faucet link `https://faucet.monad.xyz/`, mCHOG balance + "Get 100 test $CHOG" (`faucet()`), `potAvailable`; goal buttons (disabled per `canPickGoal`) and an amount field (1-100); stake = sign permit (EIP-712 typed data for the token) + `stakeWithPermit` with `keyHashOf(key)`; then POST `{ state, betId, key }` to `http://127.0.0.1:<port>/focus`; then poll `/api/focus/check` every 10 s showing countdown and status; "Claim" button when `Won`. Every tx hash links to `https://testnet.monadvision.com/tx/<hash>`. Plain styling like `/connect`.
- [ ] **Step 6: Manual check** on anvil + a browser wallet: full sprint win and claim; buttons disabled correctly near midnight.
- [ ] **Step 7: Commit** `feat(web): Focus Bet page`.

---

### Task 8: Go live and hand off

**Files:**
- Modify: `README.md` (Focus Bets section: how it works, "fun anti-cheat on testnet, not security"), `docs/designs/chog-buddy.md` (point the Later-phase paragraph at the spec)

- [ ] **Step 1:** Owner adds `SETTLER_KEY` (Sensitive) in Vercel. I add `FOCUS_POOL`, `MOCK_CHOG`, `NEXT_PUBLIC_FOCUS_POOL`, `NEXT_PUBLIC_MOCK_CHOG`, then deploy from the git-archive export.
- [ ] **Step 2: Live sprint** with the owner's wallet on the production page: stake → report progress via a scripted reporter using the progress key → `Won` → claim. All transactions visible on MonadVision.
- [ ] **Step 3: Farouk handoff** in the PR: tray item "Bet on my focus" opens `/focus?port&state`; app receives `{ state, betId, key }` on `POST /focus` at its loopback; while the bet is open it posts `/api/focus/progress` every 30 s with coding + design minutes since the stake; plays celebrate/sad sprite rows on `Won`/`Lost` (poll `/api/focus/check`).
- [ ] **Step 4: Commit** `docs: Focus Bets live` and open the PR.
