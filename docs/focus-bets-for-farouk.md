# Focus Bets: handoff for Farouk

Everything you need to finish Focus Bets: the Pet side (the last piece that blocks real bets) and the design of the bet page. The contracts and the backend are done, audited and live on Monad testnet. Nothing below needs a contract change.

Read it once top to bottom; the rules in "How the server counts focus" decide whether a bet can be won at all, so please don't skip that part.

## 1. What a user experiences

1. In the Pet's tray menu they click **Bet on my focus**.
2. The bet page opens in their browser. They connect a wallet, get free test tokens, pick a goal and an amount, and stake.
3. The page hands the bet to the Pet. From then on the Pet tells the server, every 30 seconds, how many minutes the user has spent coding or designing since the stake.
4. When the goal is reached, the server settles the bet as **Won** on chain at once. The Pet celebrates. The user goes back to the page and presses **Claim**: stake back plus a bonus.
5. If the time runs out first, the server settles it as **Lost**. 10% of the stake is burned, 90% goes into the reward pot that pays future bonuses. The Pet is sad.

Goals (fixed in the contract):

| Goal | Focus needed | Time window | Bonus |
|---|---|---|---|
| Sprint | 3 minutes | 5 minutes from the stake | +5% |
| 2h | 120 minutes | until the user's local midnight | +10% |
| 4h | 240 minutes | until local midnight | +25% |
| 6h | 360 minutes | until local midnight | +50% |

Stake: 1 to 100 mCHOG. One open bet per wallet. The bonus is reserved from the pot when the bet is placed, so a win can always be paid. Testnet only, mock token, no real money.

## 2. Live addresses

- Bet page: https://chogbuddy.vercel.app/focus (the old https://chog-buddy-api.vercel.app serves the same app; keep `DEFAULT_API_URL` as it is)
- Chain: Monad testnet, chain id 10143, RPC https://testnet-rpc.monad.xyz
- `FocusPool`: `0x0ae1F74236af4767027ED5e34aFec17D97ec5007`
- `MockChog` (mCHOG, has a free 100-token faucet once a day): `0x2B75E2E55E8F1F982dD7025ff0F8994abFAE176A`
- Both verified on Sourcify. Settler wallet (server, signs settles): `0x6768b6Fb9a448e48f744eC113acC6da96a63f3Af`
- Spec with all rules: `docs/superpowers/specs/2026-10-14-focus-bets-design.md`
- Working stand-in for the Pet side: `web/scripts/fake-pet.mjs` (about 90 lines; I ran a full live Sprint with it). Read it before you start.

## 3. The whole flow, step by step

```
Pet                                 Bet page (browser)                     Server (Vercel)            Chain
---                                 ------------------                     ---------------            -----
start loopback server on
127.0.0.1:<random port>,
make random state (32 hex)
open /focus?port=P&state=S  ───────▶ page loads
                                    GET 127.0.0.1:P/focus?state=S ──▶ 200
                                    (Stake button turns on)
                                    user connects wallet, stakes:
                                      approve(pool, amount) ─────────────────────────────────────────────▶ tx
                                      stake(goal, amount, deadline,
                                            keccak256(key), minBonus) ───────────────────────────────────▶ tx, event Staked(betId)
                                    POST 127.0.0.1:P/focus
                                      {state, betId, key} ──────▶ Pet stores betId + key
every 30 s:
POST /api/focus/progress {betId, key, focusMinutes} ─────────────────────────────▶ checks key, counts focus
                                                                                    goal reached? settle(won) ──▶ tx
◀──────────────────────────────── {status: "Open" | "Won", minutes}
status Won  ▶ celebrate, stop reporting
after the time window: POST /api/focus/check {betId} ────────────────────────────▶ past deadline+grace, goal not
                                                                                    reached? settle(lost) ──────▶ tx
◀──────────────────────────────── {status: "Lost", ...}
status Lost ▶ sad, stop
```

The key is a random 32-byte secret made by the page. The contract stores only its hash, so only whoever holds the key (the Pet) can report progress for that bet.

## 4. Pet side, part 1: tray item and loopback server

Copy the pattern of `app/src/main/signin.ts`; it is the same mechanism with a different path and payload.

**Tray item.** Add **Bet on my focus** to the tray menu in `main.ts`. On click:
1. Start (or reuse, if one is already running) a loopback HTTP server: `server.listen(0, '127.0.0.1', ...)`. Never listen on `0.0.0.0`.
2. Make `state = randomBytes(16).toString('hex')`. It must be exactly 32 lowercase hex characters; the page rejects anything else.
3. Open `https://chogbuddy.vercel.app/focus?port=<port>&state=<state>` with `shell.openExternal`.
4. Keep the server running while the bet page may still need it (the user can take several minutes to get tokens and stake). A sensible rule: keep it until a key arrives or 30 minutes pass, and restart it on the next tray click.

**Routes.** Only `/focus`:

- `OPTIONS /focus` → `204`, with the CORS headers below.
- `GET /focus?state=<s>` → `200` if `s` equals your state, otherwise `403`. The page calls this before it enables the Stake button, and again when Stake is pressed. If it gets anything but 200, the page shows "Can't reach the Chog Buddy app" with a "Check again" button.
- `POST /focus` with JSON `{ "state": "<s>", "betId": "<decimal string>", "key": "0x<64 hex>" }`:
  - `403` if `state` is wrong.
  - `400` if `betId` is not digits or `key` is not `0x` + 64 hex.
  - Otherwise `200`, store `{ betId, key }` and start reporting (part 2).
  - The page may send the same bet again (it has a "Send to the app again" button). Treat a repeat of the same `betId` as a no-op.
- Anything else → `404` / `405`.

**CORS headers** on every response (the page is https and calls a local address):

- `Access-Control-Allow-Origin`: echo the request's `Origin` only if it is `https://chogbuddy.vercel.app` or `https://chog-buddy-api.vercel.app` (for local testing also `http://localhost:3000`). Otherwise leave the header out.
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: content-type`
- `Access-Control-Allow-Private-Network: true` (Chrome asks for this before an https page may call 127.0.0.1)
- `Vary: Origin`

Keep the same body-size and timeout limits as `signin.ts`. Chrome may show the user a one-time prompt to allow local network access; that is expected.

## 5. Pet side, part 2: reporting focus

**What to send.** Every 30 seconds while the bet is open:

```
POST https://chog-buddy-api.vercel.app/api/focus/progress
content-type: application/json
{ "betId": "<decimal string>", "key": "0x<64 hex>", "focusMinutes": <integer> }
```

(Use `apiUrl()`; both domains work.)

`focusMinutes` = whole minutes of **coding + design** since the moment the key arrived, as an integer (`Math.floor`). It must only ever go up. Idle and other categories don't count. You already sample the foreground app every 5 s (`POLL_MS`) and categorise it; keep a separate counter for the bet that adds 5 s each time the sample is `coding` or `design`. Don't use the daily totals: they reset at midnight and include time before the stake.

**Keep sending even when the number hasn't changed.** The server builds "focus credit" from the time between reports (next section). Send on a steady 30 s timer, starting with a report of 0 straight after the key arrives.

**Responses:**

| Status | Body | What the Pet does |
|---|---|---|
| 200 | `{ "status": "Open", "minutes": n }` | keep going (`minutes` is what the server has counted so far) |
| 200 | `{ "status": "Won", "minutes": n }` | stop reporting, celebrate (part 3) |
| 400 | `{ "error": "more focus than time since the stake" }` | your counter is ahead of the clock; this is a bug in the counter, log it |
| 400 | other `error` | malformed body; log it |
| 403 | `{ "error": "wrong progress key" }` | stop; this bet can't be reported by this app |
| 404 | `{ "error": "no such bet" }` | stop |
| 409 | `{ "error": "bet is Lost" }` / `"bet is Claimed"` / `"bet deadline has passed"` | stop, then call `/api/focus/check` to show the result |
| 429 | `{ "error": "too many reports, wait 20 seconds" }` | normal if two reports overlap; just carry on with the next tick |
| network error / 5xx | | carry on; the next tick retries |

**Learning the result without a report.** `POST /api/focus/check` with `{ "betId": "<decimal string>" }` (no key needed) returns `{ "status": "Open" | "Won" | "Lost" | "Claimed" | "Refunded", "minutes": n, "deadline": <unix seconds>, "goal": 0..3 }`. When it's past the deadline plus the grace period and the goal wasn't reached, this call also settles the bet as Lost. Call it:
- once right after the key arrives, to learn `deadline` and `goal` (for the countdown and for knowing when to stop);
- after `deadline` + grace (Sprint 2 min, hour goals 15 min), to get the final result.

**Surviving a restart.** A 2h to 6h bet lasts many hours; the app may be closed and reopened. Persist `{ betId, key, focus counter, startedAt }` (store the key with `safeStorage`, like the session token) and resume reporting on launch if `/api/focus/check` says the bet is still `Open`. Missed time can be caught up only slowly (next section), so a long gap can cost the bet; that is by design.

**Never** log the key, send it anywhere except our API, or reuse it for another bet. One key per bet.

## 6. How the server counts focus (read this)

Focus is self-reported, so the server only lets it grow as fast as real time:

1. **Never more minutes than time since the stake.** If `focusMinutes × 60 s` is more than the time from the stake to now (or to the deadline, whichever is earlier), the report is rejected with 400.
2. **Each minute needs credit.** Credit builds at one minute per real minute from the stake and can bank at most **2 minutes**. Each report can only add as many minutes as there is credit; a bigger jump is not rejected, it is **clamped** (the server keeps the extra for nothing). So:
   - an app that reports every 30 s keeps up exactly;
   - an app that was offline for an hour and then reports 60 more minutes gets +2, then +1 per minute after that; it catches up only at the speed of the clock, and only while there is time left;
   - one fake report at the end wins nothing. A win needs reports through the whole bet.
3. **Time after the deadline builds no credit.** The grace period (2 min Sprint, 15 min hour goals) is only for late uploads of focus that happened before the deadline.

In practice: start reporting the moment the key arrives, report every 30 s, never stop while the bet is open, and the user wins exactly when they really reached the goal.

The rules live in `web/lib/focus.ts` (`decideProgress`) with tests in `web/test/focus.test.ts`, including one that simulates an app whose timer fires every 29.9 s.

## 7. Pet side, part 3: reacting to the result

- **Won:** play the `celebrate` row (`AnimName` already has it in `packages/core/src/sprite/atlas.ts`), say a line in the Chog's voice ("You did it! Claim your bonus."), and show a notification whose click opens `https://chogbuddy.vercel.app/focus` so they can press Claim.
- **Lost:** play the `sad` row and a kind line ("We'll get the next one.").
- While a bet is open, a small status in the tray menu helps ("Focus bet: 12 / 120 min, 1h 40m left"), from your counter and the `deadline`.

## 8. Web side: design of the bet page

The bet page works but is plain HTML. Please restyle it in the sticker-sheet style you used for the landing page, `/connect` and Chog Park (`web/app/ui/sticker.module.css`, `page.module.css`, `connect.module.css`).

File: `web/app/focus/page.tsx`. Change the JSX and add a `focus.module.css`; please leave the logic alone. These pieces are security and money logic that the audits checked, and the comments in the file say why:

- `fromApp` and `appAnswers` / `pingApp`: Stake stays off until the Pet answers on its port.
- `saveBet(a, { betId: '0', key })` **before** the stake transaction: if the tab closes mid-stake, the key is not lost.
- The approve-then-stake flow, `minBonusFor(estimatedBonus(...))` and reading `betId` from the `Staked` event.
- `keyForBet` in `connect()`: finds the key of an open bet after a reload.
- `canPickGoal` (hour goals need enough of the day left), the `amountOk` check, `poll`, `claim`, `refund`.

What the page shows, so the design covers every state:

1. Not opened from the app: a note to use the tray item.
2. Opened from the app but the app doesn't answer: "Can't reach the Chog Buddy app" + **Check again**.
3. Not connected: **Connect wallet**.
4. Connected, no bet: MON balance (+ link to the Monad faucet), mCHOG balance (+ **Get 100 test $CHOG**), reward pot, goal picker (4 goals; hour goals disabled late in the day), amount (1-100), "Win and you get your stake back plus about X mCHOG", **Stake**.
5. Bet open: "Focus n / goal min", countdown, "Send to the app again" button, and a Refund button if the server never settled (rare).
6. Won: **Claim**. Lost: "10% was burned, 90% went to the reward pot". Claimed: "Nice focus". Then **New bet**.
7. Status line while a wallet prompt is open, and links to every transaction on MonadVision.

Nice to have: animate the Chog on the page for Won / Lost (same sprite rows), and show the goal table from section 1 so judges understand the odds at a glance.

**Landing page.** Add a "Bet on your focus" card next to the Chog Park link: one line on what it is (stake test $CHOG that you'll focus; win a bonus, or most of it feeds the reward pot), the goal table, and "Start a bet from your Chog's tray menu". A bet started from the web page alone can't win, so the card should send people to the Pet, not straight to `/focus`.

## 9. Testing

**Without the real Pet** (to check the page design): in PowerShell, from the repo root, `node web/scripts/fake-pet.mjs` (add `http://localhost:3000` as an argument when you run the web app locally). Open the printed link, stake a Sprint, and the script reports "focused the whole time"; it prints `Won` after about 3 minutes.

**With the real Pet:**
1. Tray → Bet on my focus. The page opens; Stake should be enabled (no "Can't reach" line).
2. Get MON from the faucet link and 100 mCHOG from the page, stake 10 on a Sprint.
3. Code or design for 3 minutes. Your log should show a report every 30 s with the server's `minutes` going 0, 1, 2, 3 and then `status: Won`.
4. Celebrate plays; Claim on the page pays 10.5.
5. Second run: stake a Sprint and do something else (browse). After 7 minutes, `/api/focus/check` says Lost and the Pet is sad.
6. Third run: stake, quit the app after a minute, reopen it: reporting must resume.

Please add unit tests for the counter and the response handling the way `signin` and `tally` are tested.

## 10. Things that will look wrong but are fine

- **MetaMask warnings.** MetaMask's scanner (Blockaid) flags our new Vercel address as "malicious" (scam sites use the Chog name, e.g. `chog.digital`). Haikeys reported it as a false positive. The page no longer asks for a permit signature, which was the "high-risk request" warning; staking is now a normal approve + stake.
- **Gas.** Monad charges the gas limit, not gas used, so transactions cost a bit more than they "use".
- **Settle takes a second or two.** After the winning report the server sends the settle transaction and waits for it; the response comes back with `Won` once it is mined.

## 11. Checklist

- [ ] Tray item "Bet on my focus"
- [ ] Loopback server: `GET` / `POST` / `OPTIONS /focus`, state check, CORS + private-network header, 127.0.0.1 only
- [ ] Per-bet focus counter (coding + design, from the stake), persisted with the key in `safeStorage`
- [ ] Report every 30 s from the moment the key arrives; handle every response in section 5
- [ ] `/api/focus/check` at start and after deadline + grace
- [ ] Resume after restart
- [ ] Celebrate / sad + lines + notification
- [ ] Tests for the counter and response handling
- [ ] Bet page restyle (logic untouched)
- [ ] Landing card
- [ ] Full Sprint win and loss with the real Pet

Questions: ask Haikeys. The backend and contracts are his; the rules above are enforced there, so if something in the app seems to need a rule change, raise it before working around it.
