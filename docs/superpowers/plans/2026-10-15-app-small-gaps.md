# App Small Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the known gaps in the desktop app:
- recurring calendar meetings
- feedback while slow things run
- an instant poke
- a past-days Diary view, plus a history window that updates live
- data-safety edge cases from the final review
- macOS focus return
- a tray link to Chog Park

**Architecture:**
- Pure logic goes in small modules with vitest tests: RRULE expansion in `triggers/ical.ts`, and a wipe "epoch" guard in `wipe.ts`.
- Wiring goes in `main.ts`, `preload.ts` and the history window, verified by build, launch smoke and code reading. GUI clicks are a human checklist.

**Tech Stack:** Electron 44, TypeScript, esbuild, vitest. No new dependencies.

**Spec:** Final review minors (`.superpowers/sdd/2026-10-09-app-backend-integration/progress.md`, PR #18 "Still open"), plus the user's request 2026-10-15 to "fix all the small gaps".

## Global Constraints
- $0. No new npm dependencies.
- Secrets (session token, GitHub token, iCal URL, Gemini key) are never logged, never sent to a renderer and never shown in UI text.
- Diary text and chat history stay local (ADR 0001). The history window renders with `textContent` only.
- Keep every existing guard in `main.ts`:
  - single-instance lock and `start().catch`
  - navigation guards
  - IPC sender checks
  - poll `inFlight` guard and save throttle
  - chat guards
  - atomic writes
- Commits end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
- A weekly standup created months ago (RRULE, DTSTART in the past) must warn 5 minutes before today's occurrence (Task 1 test).
- An EXDATE-cancelled occurrence or an ended series (UNTIL/COUNT) must not warn (Task 1 test).
- Ownership is lost while a chat reply is streaming: the reply must not recreate the wiped chat log (Task 3 test).
- Today's upload gets a 400 while yesterday is fine: yesterday must still clear and today must not be retried forever (Task 3).
- The history window open while the user chats: the new turn appears without reopening it (Task 4, manual).

---

### Task 1: Recurring calendar events (RRULE DAILY/WEEKLY)

**Files:**
- Modify: `app/src/main/triggers/ical.ts`
- Test: `app/test/triggers.test.ts` (append)

**Interfaces:**
- Produces: `parseIcsStarts(ics: string, now?: number): number[]`. The signature gains an optional `now`, which defaults to `Date.now()`. It returns one-off starts plus every recurring occurrence in `[now - 1h, now + 48h]`.
- Supported:
  - `FREQ=DAILY|WEEKLY`, `INTERVAL`, `COUNT`, `UNTIL`
  - `BYDAY` for WEEKLY, as `MO,TU,…` without numeric prefixes
  - `EXDATE` lines inside the event (comma lists allowed)
- Anything else (MONTHLY, YEARLY, BYSETPOS…) falls back to DTSTART only.
- Times keep the existing rule: `Z` means UTC, otherwise machine-local.

- [ ] **Step 1: Write the failing tests** (append to `triggers.test.ts`):

```ts
const ev = (...lines: string[]) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const now = Date.UTC(2026, 9, 15, 8, 0, 0); // Thu 2026-10-15 08:00Z

describe('ical recurrence', () => {
  it('expands a weekly standup created months ago', () => {
    const s = parseIcsStarts(ev('DTSTART:20260105T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH'), now); // started on a Monday
    expect(s).toContain(Date.UTC(2026, 9, 15, 9, 0, 0)); // Thu today
    expect(s).not.toContain(Date.UTC(2026, 9, 16, 9, 0, 0)); // Friday is not in BYDAY
  });
  it('expands daily with interval', () => {
    const s = parseIcsStarts(ev('DTSTART:20261013T100000Z', 'RRULE:FREQ=DAILY;INTERVAL=2'), now);
    expect(s).toContain(Date.UTC(2026, 9, 15, 10, 0, 0));
    expect(s).not.toContain(Date.UTC(2026, 9, 16, 10, 0, 0));
  });
  it('respects UNTIL, COUNT and EXDATE', () => {
    expect(parseIcsStarts(ev('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY;UNTIL=20261010T000000Z'), now).filter((t) => t > now)).toEqual([]);
    expect(parseIcsStarts(ev('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY;COUNT=3'), now).filter((t) => t > now)).toEqual([]);
    const s = parseIcsStarts(ev('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY', 'EXDATE:20261013T090000Z,20261015T090000Z'), now);
    expect(s).not.toContain(Date.UTC(2026, 9, 15, 9, 0, 0)); // cancelled
    expect(s).toContain(Date.UTC(2026, 9, 16, 9, 0, 0)); // next one still warns
  });
  it('unsupported FREQ keeps just DTSTART and never throws', () => {
    expect(parseIcsStarts(ev('DTSTART:20261020T090000Z', 'RRULE:FREQ=MONTHLY;BYSETPOS=-1'), now)).toEqual([Date.UTC(2026, 9, 20, 9, 0, 0)]);
    expect(() => parseIcsStarts(ev('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY;INTERVAL=0'), now)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm failure.** Run `npm test -w chog-buddy-app`. Expected: the recurrence tests FAIL.

- [ ] **Step 3: Implement.** Refactor `parseIcsStarts` to collect per-event `{ dtstart: number | null; rrule: string | null; exdates: Set<number> }`, reusing the existing DTSTART time parser as a helper `parseIcsTime(value): number | null`.

```ts
const DAY_MS = 86_400_000;
const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// ponytail: DAILY/WEEKLY only; MONTHLY/YEARLY/BYSETPOS keep DTSTART. Steps one day at a time for at most ~2 years.
function expand(start: number, rule: string, exdates: Set<number>, now: number): number[] {
  const p = Object.fromEntries(rule.split(';').map((kv) => kv.split('=') as [string, string]));
  if (p.FREQ !== 'DAILY' && p.FREQ !== 'WEEKLY') return [start];
  const interval = Math.max(1, Number(p.INTERVAL) || 1);
  const until = p.UNTIL ? parseIcsTime(p.UNTIL) ?? Infinity : Infinity;
  const count = p.COUNT ? Number(p.COUNT) : Infinity;
  const days = p.FREQ === 'WEEKLY' && p.BYDAY ? p.BYDAY.split(',').map((d) => BYDAY[d.slice(-2)]).filter((d) => d !== undefined) : null;
  const from = now - 3600_000, to = now + 48 * 3600_000;
  const out: number[] = [];
  let n = 0;
  for (let i = 0; i < 800; i++) {
    const t = start + i * DAY_MS;
    if (t > until || t > to || n >= count) break;
    const dayIndex = Math.floor((t - start) / DAY_MS);
    const ok = p.FREQ === 'DAILY'
      ? dayIndex % interval === 0
      : Math.floor(dayIndex / 7) % interval === 0 && (days ? days.includes(new Date(t).getUTCDay()) : dayIndex % 7 === 0);
    if (!ok) continue;
    n++;
    if (t >= from && !exdates.has(t)) out.push(t);
  }
  return out;
}
```

- Events with an RRULE contribute `expand(...)`. Events without one contribute `dtstart` as before.
- For local-time (non-Z) starts, `getUTCDay` is acceptable. Document this in the `ponytail:` comment ("BYDAY uses UTC weekday; owners far from UTC may see edge-day misses").
- Collect `EXDATE` values (split on commas) through `parseIcsTime`.
- Update the existing caller in `main.ts` (`refreshCalendar`): no change needed, since `now` defaults. Re-parse on every 60 s meeting check is not needed; the 15-minute refresh plus the 48 h window covers it.

- [ ] **Step 4: Run** `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(app): calendar warnings for recurring daily and weekly meetings`

---

### Task 2: Feedback while slow, instant poke, macOS focus, Chog Park link

**Files:**
- Modify: `app/src/main/main.ts`

**Interfaces:**
- Consumes: existing `say`, `poke`, `showDiary`, `closeChat`, `resolveChoice`, `apiUrl()`.

- [ ] **Step 1: Instant poke.** In `say(trigger)`, skip flavour for `'pet'`: when `trigger === 'pet'`, send the template immediately (no `flavourLine`). Keep the async signature so every call site stays the same.

- [ ] **Step 2: Diary "working" line.** At the start of `showDiary()`:
  - open the chat as now
  - immediately send `chat-replace` with `📔 Writing my diary…`
  - when `ensureDiary()` resolves, replace it with the entry, as today
  - on failure, keep the existing error line

- [ ] **Step 3: Sign-in "waiting" note.** In `resolveChoice`, right before `startSignIn(...)`, show a non-blocking Electron `Notification` when `Notification.isSupported()`:
  - title `Chog Buddy`
  - body `Finish signing in in your browser. This window waits up to 5 minutes.`
  - import `Notification` from `electron`
  - never include the URL or state in the text.

- [ ] **Step 4: macOS focus return.** In `closeChat()`, after `win.setFocusable(false); win.blur();`, add this, so the previously active app gets focus back (accessory app, no Dock icon):

```ts
if (process.platform === 'darwin') { app.hide(); win.showInactive(); }
```

  Add a `ponytail:` comment: "app.hide returns focus to the previous app; showInactive keeps the pet visible. Revisit if a flicker shows."

- [ ] **Step 5: Chog Park tray item.** Under "Today's diary", add `{ label: 'Open Chog Park', click: () => void shell.openExternal(`${apiUrl()}/park`).catch(() => {}) }`.

- [ ] **Step 6: Verify.**
  - Run `npm run typecheck -w chog-buddy-app && npm test -w chog-buddy-app && npm run build -w chog-buddy-app`.
  - Launch smoke: 15 s with a temp `--user-data-dir` containing `{"judgeMode":true}` and `CHOG_API_URL=http://127.0.0.1:9`. Expect no crash.
  - Kill only your own process. Never open a browser.
- [ ] **Step 7: Commit.** `feat(app): instant poke, diary and sign-in progress, macOS focus return, Chog Park link`

---

### Task 3: Data-safety edge cases (wipe vs in-flight writes, split upload errors, one local-model helper)

**Files:**
- Create: `app/src/main/wipe.ts`
- Modify: `app/src/main/main.ts`
- Test: `app/test/wipe.test.ts`

**Interfaces:**
- Produces:
  - `createWipeGuard(): { epoch(): number; bump(): void; stale(startedAt: number): boolean }`
  - `bump()` is called on every wipe. A write captures `epoch()` when it starts and skips if `stale(captured)` is true.

- [ ] **Step 1: Write the failing test** (`app/test/wipe.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { createWipeGuard } from '../src/main/wipe';

describe('wipe guard', () => {
  it('marks writes that started before a wipe as stale', () => {
    const g = createWipeGuard();
    const started = g.epoch();
    expect(g.stale(started)).toBe(false);
    g.bump();
    expect(g.stale(started)).toBe(true);
    expect(g.stale(g.epoch())).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure.** Run `npm test -w chog-buddy-app`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `wipe.ts`.**

```ts
// A wipe (sign-out, lost ownership, Clear chat history) must not be undone by a write that started before it.
export function createWipeGuard() {
  let n = 0;
  return { epoch: () => n, bump: () => void n++, stale: (startedAt: number) => startedAt !== n };
}
```

- [ ] **Step 4: Wire it in `main.ts`.**
  - Create one module-level `const wipes = createWipeGuard();`.
  - Call `wipes.bump()` right before every `wipeDiary`/`wipeChatLog` call (including `checkLost` and "Clear chat history").
  - In the `chat-send` handler, capture `const e0 = wipes.epoch()` before streaming, and skip `appendChatLog` when `wipes.stale(e0)`.
  - In `ensureDiary`, capture before generating, and skip `appendDiary` (still return the entry) when stale.

- [ ] **Step 5: Split upload errors.** In the 10-minute job, upload yesterday and today as separate try blocks, in order:

```ts
for (const j of jobs) {
  try {
    await api.uploadActivity(j);
    if (j.day === settings.yesterday?.day) settings.yesterday = null;
    else settings.lastUpload = Date.now();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { await expireSession(); return; }
    if (e instanceof ApiError && e.status === 403) { settings.lastOwnershipCheck = 0; break; }
    if (e instanceof ApiError && e.status === 400) {
      if (j.day === settings.yesterday?.day) settings.yesterday = null; // too old: can never be sent
      else settings.lastUpload = Date.now(); // bad today payload: wait for the next hourly slot instead of hammering
      continue;
    }
    break; // network/5xx: retry next tick
  }
}
```

  Remove the old single try/catch around the loop. Keep the `uploadsFor` call.

- [ ] **Step 6: One local-model helper.** Replace the two duplicated "pick Ollama/Gemini, throw if none, stream" blocks (in `say`'s `generate` and in `ensureDiary`'s `local`) with:

```ts
async function localLine(system: string, user: string): Promise<string> {
  const p = await pickProvider(settings.chat.provider, [createOllama({ model: settings.chat.ollamaModel }), createGemini({ apiKey: geminiKey() })]);
  if (!p) throw new Error('no provider');
  return p.stream(system, [{ role: 'user', content: user }], () => {});
}
```

- [ ] **Step 7: Run** `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app && npm run build -w chog-buddy-app`. Expected: PASS.
- [ ] **Step 8: Commit.** `fix(app): wipes beat in-flight writes; upload errors handled per day`

---

### Task 4: Past-days Diary view and a live history window

**Files:**
- Modify: `app/src/main/main.ts` (`openHistory`, `chat-send` append, `ensureDiary` append), `app/src/preload.ts` (`onHistory` payload type), `app/src/renderer/history.ts`, `app/src/renderer/history.html`

**Interfaces:**
- Produces: the `history-data` payload becomes `{ name: string; messages: Array<{ role: string; content: string; at: number }>; diary: Array<{ day: string; text: string }> }`. `diary` is the Chog's entries, newest first.

- [ ] **Step 1: Main side.**
  - Extract `sendHistory()`. When `historyWin` exists, it sends `history-data` with:
    - `name`
    - `messages: forToken(loadChatLog(userData, cipher), tokenId)`
    - `diary: loadDiary(userData).filter(e => e.tokenId === tokenId).map(({ day, text }) => ({ day, text })).reverse()`
  - Call it on `did-finish-load` (replacing the inline send), after every successful `appendChatLog`, after every `appendDiary`, and after "Clear chat history" if the window stays open.
  - Rename the tray item to "Chat history & diary…".
- [ ] **Step 2: Preload type.** Extend the `onHistory` callback payload type with `diary: Array<{ day: string; text: string }>`.
- [ ] **Step 3: Renderer.** In `history.html`, add two tab buttons above the list: `Chats` and `Diary`. Use the existing CSP and no inline script. In `history.ts`:
  - keep the last payload
  - render the active tab
  - the Diary tab shows one card per entry, a date heading (`new Date(day + 'T12:00').toLocaleDateString(...)`) plus text
  - empty state `No diary entries yet. Your Chog writes one each evening.`
  - `textContent` only
  - only scroll to the bottom on the Chats tab
  - re-render on every `history-data`, keeping the selected tab
- [ ] **Step 4: Verify.** Run typecheck, tests and build. Load the built `history.html` in a hidden window with a sample payload (the same technique as the Task 11 report) and confirm:
  - both tabs render
  - HTML in text shows as text
  - no console errors
- [ ] **Step 5: Commit.** `feat(app): diary tab with past days; history window updates live`

---

## Human checklist (after all tasks)
1. Tray → "Today's diary": the bubble shows "Writing my diary…", then the entry.
2. Poke the Chog: a line appears instantly.
3. On macOS, open the chat (Ctrl+Shift+Space), press Esc: typing goes back to the previous app.
4. Tray → "Chat history & diary…" while chatting: new turns appear. The Diary tab lists past days.
5. Tray → "Open Chog Park": the browser opens `/park`.
