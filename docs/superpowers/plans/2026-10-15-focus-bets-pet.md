# Focus Bets: Pet Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop Pet takes part in Focus Bets. It:
- opens the bet page from the tray
- receives the bet key on a loopback server
- counts coding + design minutes since the key arrived
- reports every 30 s
- learns the result
- celebrates or mourns
- survives restarts

**Architecture:**
- **`focusbet.ts`, pure logic and loopback server, tested:**
  - the loopback server (modelled on `signin.ts`)
  - the counter and persisted bet shape
  - the response decision table
  - the tray status text
- **`main.ts` wiring:** tray item, reporter timer, resume on launch, mood animation, notification.
- **`animState.ts`:** gains a timed `mood` (celebrate/sad) override.

**Tech Stack:** Electron 44 main process, Node `http`, global `fetch`, vitest. No new dependencies.

**Spec:**
- `docs/focus-bets-for-farouk.md` (sections 4, 5, 6, 7, 9, 11). It wins on any detail.
- `docs/superpowers/specs/2026-10-14-focus-bets-design.md`
- Server rules: `web/lib/focus.ts` (`decideProgress`).
- Loopback reference: `web/scripts/fake-pet.mjs`.

## Global Constraints
- **Loopback server:**
  - Listens on `127.0.0.1` only.
  - Requires `state` to be exactly 32 lowercase hex characters (`randomBytes(16).toString('hex')`).
  - Uses the same body-size and timeout limits as `signin.ts`.
- **CORS on every response:**
  - Echo `Origin` only when it is `https://chogbuddy.vercel.app`, `https://chog-buddy-api.vercel.app` or `http://localhost:3000`.
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: content-type`
  - `Access-Control-Allow-Private-Network: true`
  - `Vary: Origin`
- **Bet page URL:** `${FOCUS_SITE}/focus?port=<p>&state=<s>`, where `FOCUS_SITE = 'https://chogbuddy.vercel.app'`. API calls use `apiUrl()`; keep `DEFAULT_API_URL` unchanged.
- **The progress key:**
  - Stored only `safeStorage`-sealed, via `seal`/`unseal`.
  - Never logged, never sent to the renderer.
  - Sent only to `${apiUrl()}/api/focus/progress`.
  - One key per bet.
- **`focusMinutes`:**
  - `Math.floor(focusMs / 60000)` of coding + design samples counted since the key arrived. It never goes down.
  - Each poll sample whose category is `coding` or `design` adds `POLL_MS`.
  - The daily totals are never used.
- **Reporting:**
  - Report 0 right after the key arrives, then every 30 s while the bet is Open, even when the number is unchanged.
  - Call `POST /api/focus/check {betId}` once after the key arrives (to learn `deadline` and `goal`), on launch when resuming, and after `deadline` + grace (Sprint 2 min, hour goals 15 min).
- **Judge Mode:** the tray item still works there, since Focus Bets are testnet and wallet-based.
- **Backend rules are Haikeys'.** Never work around a server rule. Log and stop instead.
- Commits end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
- The page sends the same `{betId, key}` twice ("Send to the app again"). The second POST returns 200 and changes nothing (Task 1 test).
- A wrong `state` on GET or POST gets 403. A malformed `betId` or `key` gets 400. Any other path gets 404, any other method 405 (Task 1 tests).
- 429 and network errors/5xx carry on. 403 and 404 stop for good. 409 stops reporting and calls check. 400 "more focus than time" is logged as a counter bug, and reporting carries on (Task 2 table test).
- The app quits mid-bet and relaunches: reporting resumes from the persisted counter if check says Open; otherwise the result is shown once (Task 3, verified by reading code plus a smoke launch).
- A key arrives while a different bet is still open: the old bet is kept and the new one is refused with 409, because the contract allows one open bet per wallet (Task 1 test).

---

### Task 1: `focusbet.ts`: loopback server, counter, decision table, status text

**Files:**
- Create: `app/src/main/focusbet.ts`
- Modify: `app/src/main/config.ts` (add `FOCUS_SITE`)
- Test: `app/test/focusbet.test.ts`

**Interfaces (Produces):**
```ts
export const FOCUS_SITE = 'https://chogbuddy.vercel.app'; // in config.ts
export const REPORT_EVERY_MS = 30_000;
export const GRACE_MS = [120_000, 900_000, 900_000, 900_000] as const; // by goal id
export type FocusBet = { betId: string; keyEnc: string; focusMs: number; startedAt: number; deadline: number | null; goal: 0 | 1 | 2 | 3 | null; goalMinutes: number | null };
export const focusMinutes = (b: { focusMs: number }) => Math.floor(b.focusMs / 60_000);
export function addFocusSample(b: FocusBet, category: Category, ms: number): FocusBet; // +ms only for coding/design
export type ProgressOutcome = 'continue' | 'won' | 'stop' | 'check';
export function decideReport(status: number, body: { status?: string; error?: string }): ProgressOutcome;
export function focusStatusLine(b: FocusBet, nowMs: number): string; // "Focus bet: 12 / 120 min, 1h 40m left"
export function startFocusLoopback(opts: {
  onBet: (bet: { betId: string; key: string }) => 'ok' | 'busy'; // 'busy' = another bet is open -> 409
  timeoutMs?: number; // default 30 min; server closes after a key arrives (+5 s grace for repeat POSTs) or at timeout
}): Promise<{ port: number; state: string; close: () => void }>;
```

`decideReport` table, which must match `docs/focus-bets-for-farouk.md` section 5:

| status | body | outcome |
|---|---|---|
| 200 | `status: 'Open'` | `continue` |
| 200 | `status: 'Won'` | `won` |
| 200 | other status | `check` |
| 400 | any | `continue` (the caller logs the error string, never the key) |
| 403, 404 | any | `stop` |
| 409 | any | `check` |
| 429, 0 (network), ≥500 | any | `continue` |

- [ ] **Step 1: Write failing tests** (`app/test/focusbet.test.ts`):
  - **Loopback, modelled on `app/test/signin.test.ts`:**
    - GET with the right state returns 200; with a wrong state, 403.
    - OPTIONS returns 204, the CORS headers are present, and `Access-Control-Allow-Origin` is echoed only for an allowed origin.
    - POST with a good body returns 200 and calls `onBet` once. A repeat of the same body returns 200 and does not call `onBet` again.
    - POST with a bad key returns 400; a wrong state, 403; when `onBet` answers `'busy'`, 409.
    - Another path returns 404; another method, 405.
    - The server binds `127.0.0.1`.
  - **Counter:** coding and design samples add, others don't; `focusMinutes` floors.
  - **Decision table:** one test per row above, using `it.each`.
  - **`focusStatusLine`:**
    - with a deadline: `"Focus bet: 12 / 120 min, 1h 40m left"`
    - without a deadline yet: `"Focus bet: 0 min so far"`
    - past the deadline: `"Focus bet: waiting for the result"`
- [ ] **Step 2:** Run `npm test -w chog-buddy-app` and confirm the new tests fail.
- [ ] **Step 3: Implement.**
  - Copy the `signin.ts` structure: the `cors()` helper, `finish()`, the body cap and 413, content-type check 415, the timeouts, `closeAllConnections`.
  - Paths: GET, POST and OPTIONS `/focus` only.
  - Validation: `betId` must match `/^\d+$/`; `key` must match `/^0x[0-9a-fA-F]{64}$/`.
- [ ] **Step 4:** Run `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app` and confirm both pass.
- [ ] **Step 5: Commit:** `feat(app): Focus Bets loopback server, focus counter and report rules`

---

### Task 2: Mood animation row

**Files:**
- Modify: `app/src/main/animState.ts`
- Test: `app/test/animState.test.ts` (append)

**Interfaces:** `AnimInput` gains `mood?: 'celebrate' | 'sad' | null` and `moodUntil?: number`. When `mood` is set and `now < moodUntil`, `chooseAnimation` returns `{ anim: mood, paused: false, canWalk: false }`. The check comes right after `dragging`, before react and sleep.

- [ ] **Step 1:** Write tests:
  - celebrate wins over walk, talk and sleep while the mood is active
  - it expires at `moodUntil`
  - dragging still wins
- [ ] **Step 2:** Confirm they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests and typecheck.
- [ ] **Step 5: Commit:** `feat(app): celebrate and sad moods override the animation for a while`

---

### Task 3: Wire Focus Bets into `main.ts`

**Files:**
- Modify: `app/src/main/main.ts`, `app/src/main/store.ts` (add `Settings.focusBet: FocusBet | null`, default null; a non-object saved value becomes null), `app/test/store.test.ts` (append one defaults test)

**Steps:**
1. **Tray.** Under "Open Chog Park", add "Bet on my focus".
   - On click: if a bet is open, open `${FOCUS_SITE}/focus` (no port, so the user can see or claim the bet).
   - Otherwise: start or reuse a `startFocusLoopback` server, then `shell.openExternal(`${FOCUS_SITE}/focus?port=${port}&state=${state}`)`.
   - While a bet is open, a disabled status line appears above the item, `focusStatusLine(...)`, refreshed every report.
2. **onBet.**
   - If `settings.focusBet` exists with a different `betId`, return `'busy'`. The same `betId` cannot reach here, because the server dedupes.
   - Otherwise seal the key. If `seal` returns null, show the existing error box and return `'busy'`.
   - Set `settings.focusBet = { betId, keyEnc, focusMs: 0, startedAt: Date.now(), deadline: null, goal: null, goalMinutes: null }`, save, and say a short line ("Bet's on! Let's focus.").
   - Report 0 immediately, call check once, start the 30 s timer.
3. **Counter.** In the existing poll loop, after `category` is known (same place as `addSample` for today's totals), set `settings.focusBet = addFocusSample(settings.focusBet, category, POLL_MS)` when a bet is open.
   - The poll loop skips samples while the user is idle; that is fine, because idle time is not focus.
   - Settings saves through the existing 60 s throttle. Also save after every report.
4. **Reporter.** Every `REPORT_EVERY_MS` while a bet exists:
   - POST `${apiUrl()}/api/focus/progress` `{ betId, key: unseal(...), focusMinutes }` with `AbortSignal.timeout(15_000)`.
   - Network errors count as status 0.
   - Map the response through `decideReport`:
     - `won`: call `finishBet('Won')`.
     - `stop`: log `Chog Buddy: focus bet stopped (<status>)`, with no key and no body echo, then clear the bet.
     - `check`: call check.
     - `continue`: keep going.
   - After `deadline + GRACE_MS[goal]` (once both are known), also call check on each tick.
   - Guard with an in-flight flag so reports never overlap.
5. **Check.**
   - POST `${apiUrl()}/api/focus/check` `{ betId }`, then store `deadline` (unix seconds × 1000), `goal` and `goalMinutes`. Goal minutes are `[3, 120, 240, 360][goal]`.
   - On `Won`, call `finishBet('Won')`. On `Lost`, `finishBet('Lost')`. On `Claimed` or `Refunded`, clear quietly. On `Open`, continue.
6. **finishBet.**
   - Clear `settings.focusBet` and save, then stop the timer.
   - Won: mood `celebrate` for 6 s, say "You did it! Claim your bonus.", and show a `Notification` (title Chog Buddy, body "Focus bet won! Click to claim your bonus.") whose click opens `${FOCUS_SITE}/focus`.
   - Lost: mood `sad` for 6 s, say "We'll get the next one.".
   - Lines go through the existing `say`/bubble path: send the text directly with the `say` channel and set `talkUntil`, the same way other fixed lines are shown. Respect the `chatOpen`/`inFlightChat` guard: if chat is open, skip the bubble but still play the mood.
7. **Resume on launch.** After the Pet loads, if `settings.focusBet` exists, call check: when it says `Open`, start the timer and report at once; otherwise run the result path.
8. **Sign-out.** Clear `focusBet` too (it belongs to that user).

**Verify:**
- `npm run typecheck -w chog-buddy-app && npm test -w @chog/core -w chog-buddy-app && npm run build -w chog-buddy-app`
- Launch smoke for 15 s: a temp `--user-data-dir` with `{"judgeMode":true}`, plus `CHOG_API_URL=http://127.0.0.1:9`. Expect no crash.
- Loopback smoke with a small Node script against a running `startFocusLoopback` (no Electron): `curl` OPTIONS, GET and POST, checking the status codes and CORS headers, with output in the report.
- Never open a browser. Kill only your own processes.

**Commit:** `feat(app): Bet on my focus: tray item, 30 s progress reports, resume, celebrate or sad`

## Human checklist (real Sprint, after merge)
These follow `docs/focus-bets-for-farouk.md` section 9, "With the real Pet":
1. **Win:**
   1. Tray, then Bet on my focus. Stake is enabled.
   2. Get MON and mCHOG, stake 10 on a Sprint.
   3. Code for 3 minutes.
   4. The log shows minutes 0, 1, 2, 3, then Won; the Chog celebrates; Claim pays 10.5.
2. **Loss:** stake a Sprint and browse instead. After about 7 minutes the bet is Lost and the Chog is sad.
3. **Restart:** stake, quit after 1 minute, reopen. Reporting resumes.
