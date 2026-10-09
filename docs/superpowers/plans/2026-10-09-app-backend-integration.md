# App ↔ Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the local Pet into an owned Pet. That covers:
- wallet sign-in from the app
- a Chog picker gated by real ownership, plus a labelled Judge Mode
- daily Activity upload and the private Diary
- ownership re-checks
- GitHub and calendar Triggers
- LLM-flavoured Reaction lines, from free providers only

**Architecture:**
- The Electron main process gets a typed backend client (`api.ts`), a loopback sign-in receiver (`signin.ts`), and pure decision modules: startup choice, upload timing, ownership loss, trigger parsing.
- The web app gets one page, `/connect`, where the owner signs a SIWE message with their browser wallet. The page posts the session token back to the app's loopback port.
- Everything works without the backend except sign-in, upload and the ownership check. Judge Mode, local chat, local Diary fallback and the Triggers all run offline.

**Tech Stack:** Electron, TypeScript, vitest, Node `http` (loopback), Next.js App Router + viem/siwe (web page), Ollama / Gemini free tier via the chat providers. No new dependencies.

**Spec:** `docs/designs/chog-buddy.md`, specifically:
- Decisions: Ownership, Judge mode, Diary, Integrations
- API (v1)
- Platform notes: SIWE return path, Ownership check

Also `docs/adr/0001` (privacy), `CONTEXT.md`, and the chat design in `docs/superpowers/plans/2026-10-09-chat-box.md`.

**Depends on:**
- The `chat-box` branch must be merged first. This plan uses `createOllama`, `createGemini`, `pickProvider`, `Settings.chat` and `safeStorage` key handling.
- The backend plan `docs/superpowers/plans/2026-10-07-soul-backend.md` (teammate) provides `/api/auth/nonce`, `/api/auth/verify`, `/api/me/chogs`, `/api/chog/[id]`, `/api/activity` and `/api/diary`, and the `web/` app. Tasks 1, 2, 5, 6, 8 and 9 are buildable and testable before the backend exists. Task 3 (the web page) needs the teammate's Tasks 4–5 merged. Live end-to-end checks need the deployed backend.

## Global Constraints
- **Cost and dependencies:** $0. No new npm dependencies. No OAuth apps. Google Calendar uses the owner's private iCal URL, not OAuth.
- **Data that leaves the machine (ADR 0001):** only Category minutes. Diary text comes back from the server and is stored ONLY locally, in `userData/diary.json`. The server never stores it.
- **Secrets:**
  - Session token, GitHub token and calendar URL are all stored `safeStorage`-encrypted in settings.
  - They are never logged and never sent to the renderer.
  - A secret never appears in a URL query.
- **Judge Mode:**
  - It loads token #5 read-only, and the tray label says "Judge Mode (demo Chog)".
  - It never uploads Activity and never requests a Diary from the server.
- **Ownership loss:**
  - Delete `diary.json` and clear the session's active token.
  - Tell the owner in a dialog.
  - Return to the sign-in/Judge choice.
- **Backend base URL:** `settings.apiUrl`. Default `https://chog-buddy.vercel.app`, overridable by the `CHOG_API_URL` env var.
- **Loopback sign-in:**
  - Binds `127.0.0.1` on a random port.
  - Uses a random 32-hex `state`.
  - Accepts exactly one POST `/callback` and closes after it.
  - Times out after 5 minutes.
  - CORS allows only the `apiUrl` origin.
- **Timing:**
  - Upload today's totals at most hourly, plus yesterday's on day rollover.
  - Re-check ownership on launch and every 24 h.
  - GitHub polling every 5 minutes. Calendar refresh every 15 minutes. Meeting warning 5 minutes before start.
- Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Backend down or not yet deployed:**
   - The app must still start: Judge Mode, local chat and the local Diary fallback all work.
   - Sign-in shows a clear error. There are no crash loops or unhandled rejections.
   - Tests: Task 1 (client error mapping) and Task 7 (Diary fallback).
2. **Forged or stale callback on the loopback port:**
   - A wrong `state`, a second POST, a GET or a non-JSON body each get a 4xx and never resolve sign-in.
   - Test: Task 2.
3. **The owner sold the Chog while the app was closed:**
   - On launch the ownership check runs before the Pet appears, the Diary is wiped, and the owner is told.
   - Test: Task 5 (`decideOwnership`).
4. **A malformed iCal feed or GitHub API error:**
   - The Trigger simply doesn't fire. There is no crash and no spam.
   - All-day and timezone (`Z` and `TZID`) events parse.
   - Test: Task 8.
5. **An LLM flavour line that is slow, too long or off-format:**
   - Fall back to the template line within 3 s.
   - Strip quotes and markdown, and cap the line at 140 characters.
   - Test: Task 9.

---

## File Structure
```
app/src/main/api.ts            typed backend client + ApiError
app/src/main/signin.ts         loopback receiver: startSignIn()
app/src/main/secrets.ts        encrypt/decrypt helpers around safeStorage (injectable)
app/src/main/startup.ts        chooseStartup(), decideOwnership() (pure)
app/src/main/upload.ts         uploadDue(), rollover payloads (pure)
app/src/main/diary.ts          diary file store + local fallback prompt
app/src/main/triggers/github.ts   unread-count poll diff (pure + fetch)
app/src/main/triggers/ical.ts     parse VEVENT starts, nextMeetingWithin() (pure)
app/src/main/flavour.ts        flavourPrompt(), cleanFlavour(), withTimeout()
app/src/main/store.ts          + session, judgeMode, apiUrl, secrets, lastUpload, lastOwnershipCheck, yesterday
app/src/main/reactions.ts / lines.ts   + 'github' and 'meeting_soon' Triggers
app/src/main/main.ts           wiring
web/app/connect/page.tsx       wallet sign-in page (needs web/ from the backend plan)
app/test/*.test.ts
```

---

### Task 1: Backend client

**Files:**
- Create: `app/src/main/api.ts`
- Test: `app/test/api.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { constructor(message: string, readonly status: number) }`, where `status` is 0 for a network error
  - `createApi(opts: { baseUrl: string; token?: string | null; fetchImpl?: typeof fetch })`, which returns:
    - `myChogs(): Promise<number[]>` (GET `/api/me/chogs`)
    - `uploadActivity(body: { tokenId: number; day: string; totals: DailyTotals }): Promise<void>` (POST `/api/activity`)
    - `diary(body: { tokenId: number; totals: DailyTotals }): Promise<string>` (POST `/api/diary`, returns `text`)

- [ ] **Step 1: Write the failing test**

`app/test/api.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../src/main/api';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  it('sends the bearer token and parses myChogs', async () => {
    const f = vi.fn().mockResolvedValue(json({ tokenIds: [5, 9] }));
    const api = createApi({ baseUrl: 'https://x.test/', token: 'T', fetchImpl: f });
    expect(await api.myChogs()).toEqual([5, 9]);
    expect(f.mock.calls[0][0]).toBe('https://x.test/api/me/chogs');
    expect(f.mock.calls[0][1].headers.authorization).toBe('Bearer T');
  });
  it('drops non-integer ids from a sloppy response', async () => {
    const api = createApi({ baseUrl: 'https://x.test', token: 'T', fetchImpl: vi.fn().mockResolvedValue(json({ tokenIds: [5, '6', null, 7.5] })) });
    expect(await api.myChogs()).toEqual([5]);
  });
  it.each([401, 403, 500])('HTTP %i -> ApiError with status', async (status) => {
    const api = createApi({ baseUrl: 'https://x.test', token: 'T', fetchImpl: vi.fn().mockResolvedValue(json({ error: 'nope' }, status)) });
    await expect(api.myChogs()).rejects.toMatchObject({ status });
  });
  it('network failure -> ApiError status 0', async () => {
    const api = createApi({ baseUrl: 'https://x.test', fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
    const e = await api.myChogs().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(0);
  });
  it('uploadActivity posts JSON', async () => {
    const f = vi.fn().mockResolvedValue(json({ ok: true }));
    const totals = { minutes: { coding: 5 }, lateMinutes: 0, earlyMinutes: 0 } as never;
    await createApi({ baseUrl: 'https://x.test', token: 'T', fetchImpl: f }).uploadActivity({ tokenId: 5, day: '2026-10-09', totals });
    expect(f.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ tokenId: 5, day: '2026-10-09', totals });
  });
  it('diary returns text', async () => {
    const api = createApi({ baseUrl: 'https://x.test', token: 'T', fetchImpl: vi.fn().mockResolvedValue(json({ text: 'Dear diary', source: 'gemini' })) });
    expect(await api.diary({ tokenId: 5, totals: {} as never })).toBe('Dear diary');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

`app/src/main/api.ts`:
```ts
import type { DailyTotals } from '@chog/core';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApi(opts: { baseUrl: string; token?: string | null; fetchImpl?: typeof fetch }) {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ApiError(`backend unreachable: ${(e as Error).message}`, 0);
    }
    if (!res.ok) throw new ApiError(`backend HTTP ${res.status} on ${path}`, res.status);
    return (await res.json()) as T;
  }

  return {
    async myChogs(): Promise<number[]> {
      const r = await call<{ tokenIds?: unknown[] }>('/api/me/chogs');
      return (r.tokenIds ?? []).filter((x): x is number => Number.isInteger(x));
    },
    async uploadActivity(body: { tokenId: number; day: string; totals: DailyTotals }): Promise<void> {
      await call('/api/activity', { method: 'POST', body });
    },
    async diary(body: { tokenId: number; totals: DailyTotals }): Promise<string> {
      const r = await call<{ text?: unknown }>('/api/diary', { method: 'POST', body });
      if (typeof r.text !== 'string') throw new ApiError('diary: malformed response', 502);
      return r.text;
    },
  };
}
```

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/main/api.ts app/test/api.test.ts
git commit -m "feat(app): typed backend client"
```

---

### Task 2: Loopback sign-in receiver

**Files:**
- Create: `app/src/main/signin.ts`
- Test: `app/test/signin.test.ts`

**Interfaces:**
- Produces: `startSignIn(opts: { apiUrl: string; open: (url: string) => void; timeoutMs?: number }): Promise<{ token: string; address: string }>`
- Behaviour:
  1. Starts `http` on `127.0.0.1:0` and creates a random `state`.
  2. Calls `open(\`${apiUrl}/connect?port=${port}&state=${state}\`)`.
  3. Resolves on the first POST `/callback` whose JSON is `{ state, token, address }` with the matching state, and always closes the server.
  4. Answers an `OPTIONS` preflight with CORS headers for the `apiUrl` origin only.
  5. Rejects with `Error('sign-in timed out')` after `timeoutMs`, default 300 000.

- [ ] **Step 1: Write the failing test**

`app/test/signin.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { startSignIn } from '../src/main/signin';

const API = 'https://chog.test';
function begin(timeoutMs = 2000) {
  let opened = '';
  const p = startSignIn({ apiUrl: API, open: (u) => { opened = u; }, timeoutMs });
  const ready = new Promise<{ port: string; state: string }>((resolve) => {
    const t = setInterval(() => {
      if (!opened) return;
      clearInterval(t);
      const u = new URL(opened);
      resolve({ port: u.searchParams.get('port')!, state: u.searchParams.get('state')! });
    }, 5);
  });
  return { p, ready, opened: () => opened };
}
const post = (port: string, body: string, origin = API) =>
  fetch(`http://127.0.0.1:${port}/callback`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body });

describe('startSignIn', () => {
  it('opens the connect page with port and a 32-hex state', async () => {
    const s = begin();
    const { state } = await s.ready;
    expect(s.opened().startsWith(`${API}/connect?port=`)).toBe(true);
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    s.p.catch(() => {});
  });
  it('resolves on a matching callback and returns CORS for the api origin', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    const res = await post(port, JSON.stringify({ state, token: 'tok', address: '0xabc' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(API);
    await expect(s.p).resolves.toEqual({ token: 'tok', address: '0xabc' });
  });
  it('rejects a wrong state with 403 and keeps waiting', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    expect((await post(port, JSON.stringify({ state: 'f'.repeat(32), token: 't', address: 'a' }))).status).toBe(403);
    expect((await post(port, 'not json')).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${port}/callback`)).status).toBe(405);
    await post(port, JSON.stringify({ state, token: 'ok', address: '0x1' }));
    await expect(s.p).resolves.toMatchObject({ token: 'ok' });
  });
  it('times out', async () => {
    const s = begin(50);
    await s.ready;
    await expect(s.p).rejects.toThrow('sign-in timed out');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

`app/src/main/signin.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export function startSignIn(opts: { apiUrl: string; open: (url: string) => void; timeoutMs?: number }): Promise<{ token: string; address: string }> {
  const origin = new URL(opts.apiUrl).origin;
  const state = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    let done = false;
    const cors = (res: ServerResponse) => {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
    };
    const finish = (err: Error | null, value?: { token: string; address: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      if (err) reject(err);
      else resolve(value!);
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      cors(res);
      if (req.url !== '/callback') return void res.writeHead(404).end();
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      if (req.method !== 'POST') return void res.writeHead(405).end();
      let raw = '';
      req.on('data', (c) => {
        raw += c;
        if (raw.length > 10_000) req.destroy();
      });
      req.on('end', () => {
        let body: { state?: unknown; token?: unknown; address?: unknown };
        try {
          body = JSON.parse(raw);
        } catch {
          return void res.writeHead(400).end();
        }
        if (body.state !== state) return void res.writeHead(403).end();
        if (typeof body.token !== 'string' || typeof body.address !== 'string') return void res.writeHead(400).end();
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        finish(null, { token: body.token, address: body.address });
      });
    });
    const timer = setTimeout(() => finish(new Error('sign-in timed out')), opts.timeoutMs ?? 300_000);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      opts.open(`${opts.apiUrl.replace(/\/+$/, '')}/connect?port=${port}&state=${state}`);
    });
  });
}
```

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/main/signin.ts app/test/signin.test.ts
git commit -m "feat(app): loopback receiver for wallet sign-in"
```

---

### Task 3: `/connect` wallet sign-in page (web)

**Prerequisite:** the backend plan's Tasks 4–5 are merged, so `web/`, `/api/auth/nonce` and `/api/auth/verify` exist. If not, skip this task and mark it blocked in the ledger.

**Files:**
- Create: `web/app/connect/page.tsx`

**Interfaces:**
- Consumes: the `?port=&state=` query, `POST /api/auth/nonce` returning `{nonce}`, and `POST /api/auth/verify` taking `{message, signature}` and returning `{token, address}`.
- Produces: a POST to `http://127.0.0.1:<port>/callback` with `{ state, token, address }`.

- [ ] **Step 1: Implement the page**

`web/app/connect/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { createWalletClient, custom, getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';

declare global {
  interface Window { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }
}

export default function Connect() {
  const [status, setStatus] = useState('Connect the wallet that holds your Chog.');
  const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  const port = params?.get('port') ?? '';
  const state = params?.get('state') ?? '';
  const valid = /^\d{2,5}$/.test(port) && /^[0-9a-f]{32}$/.test(state);

  async function signIn() {
    try {
      if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask, Rabby or Backpack.');
      const wallet = createWalletClient({ transport: custom(window.ethereum) });
      const [raw] = await wallet.requestAddresses();
      const address = getAddress(raw);
      setStatus('Sign the message in your wallet…');
      const { nonce } = await (await fetch('/api/auth/nonce', { method: 'POST' })).json();
      const message = createSiweMessage({
        address, chainId: 143, domain: window.location.host, nonce, uri: window.location.origin, version: '1', issuedAt: new Date(),
        statement: 'Sign in to Chog Buddy. This does not cost gas.',
      });
      const signature = await wallet.signMessage({ account: address, message });
      const r = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }) });
      if (!r.ok) throw new Error('Sign-in was rejected. Try again.');
      const { token } = await r.json();
      const cb = await fetch(`http://127.0.0.1:${port}/callback`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, token, address }),
      });
      if (!cb.ok) throw new Error('Could not reach the Chog Buddy app. Is it still open?');
      setStatus('Done! Go back to your desktop — your Chog is waking up.');
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '80px auto', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1>Chog Buddy</h1>
      <p>{valid ? status : 'Open this page from the Chog Buddy app.'}</p>
      {valid && <button onClick={signIn} style={{ padding: '10px 20px', fontSize: 16 }}>Connect wallet</button>}
    </main>
  );
}
```

`SIWE_DOMAIN` on the server must equal this page's host. It is set in the backend plan's env.

- [ ] **Step 2: Build**

Run: `npm run build -w web`
Expected: the build succeeds and `/connect` is listed.

- [ ] **Step 3: Manual check (recorded in the report)**

1. Run `npm run dev -w web`.
2. Open `http://localhost:3000/connect`. It should say "Open this page from the Chog Buddy app."
3. Open `/connect?port=12345&state=` followed by 32 hex characters. The button appears.

- [ ] **Step 4: Commit**
```bash
git add web/app/connect
git commit -m "feat(web): wallet sign-in page that hands the session to the app"
```

---

### Task 4: Settings: session, judge, secrets

**Files:**
- Create: `app/src/main/secrets.ts`
- Modify: `app/src/main/store.ts`
- Test: `app/test/store.test.ts`, `app/test/secrets.test.ts`

**Interfaces:**
- Produces:
  - `Settings` gains these fields:
    - `apiUrl: string`
    - `judgeMode: boolean`
    - `session: { tokenEnc: string; address: string } | null`
    - `secrets: { githubEnc: string | null; icalEnc: string | null }`
    - `lastUpload: number`
    - `lastOwnershipCheck: number`
    - `yesterday: { day: string; totals: DailyTotals } | null`
  - `type Cipher = { available(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string }`
  - `seal(c: Cipher, plain: string): string | null` (base64, or null when the cipher is unavailable)
  - `unseal(c: Cipher, sealed: string | null): string | null` (null on any failure)

- [ ] **Step 1: Write the failing tests**

`app/test/secrets.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { seal, unseal, type Cipher } from '../src/main/secrets';

const rot: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from([...s].reverse().join('')),
  decrypt: (b) => [...b.toString()].reverse().join(''),
};

describe('seal/unseal', () => {
  it('round-trips', () => expect(unseal(rot, seal(rot, 'secret'))).toBe('secret'));
  it('returns null when encryption is unavailable', () => expect(seal({ ...rot, available: () => false }, 'x')).toBeNull());
  it('returns null for missing or corrupt input instead of throwing', () => {
    expect(unseal(rot, null)).toBeNull();
    expect(unseal({ ...rot, decrypt: () => { throw new Error('bad'); } }, 'AAAA')).toBeNull();
  });
});
```

Append to `app/test/store.test.ts`:
```ts
  it('fills integration defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    const s = loadSettings(dir);
    expect(s).toMatchObject({ apiUrl: 'https://chog-buddy.vercel.app', judgeMode: false, session: null, lastUpload: 0, lastOwnershipCheck: 0, yesterday: null });
    expect(s.secrets).toEqual({ githubEnc: null, icalEnc: null });
  });
  it('keeps saved secrets and fills missing secret fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ secrets: { githubEnc: 'abc' } }));
    expect(loadSettings(dir).secrets).toEqual({ githubEnc: 'abc', icalEnc: null });
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -w chog-buddy-app`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/secrets.ts`:
```ts
export type Cipher = { available(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string };

export function seal(c: Cipher, plain: string): string | null {
  if (!c.available()) return null;
  return c.encrypt(plain).toString('base64');
}

export function unseal(c: Cipher, sealed: string | null): string | null {
  if (!sealed || !c.available()) return null;
  try {
    return c.decrypt(Buffer.from(sealed, 'base64'));
  } catch {
    return null;
  }
}
```

In `app/src/main/store.ts`, extend the `Settings` type with the fields listed under Interfaces, and the defaults with:
```ts
apiUrl: 'https://chog-buddy.vercel.app', judgeMode: false, session: null,
secrets: { githubEnc: null, icalEnc: null }, lastUpload: 0, lastOwnershipCheck: 0, yesterday: null,
```
In the merge, add `secrets: { ...defaults.secrets, ...(saved?.secrets ?? {}) }` next to `chat`.

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/main/secrets.ts app/src/main/store.ts app/test/secrets.test.ts app/test/store.test.ts
git commit -m "feat(app): settings for session, Judge Mode and sealed secrets"
```

---

### Task 5: Startup choice and ownership decisions

**Files:**
- Create: `app/src/main/startup.ts`
- Test: `app/test/startup.test.ts`

**Interfaces:**
- Produces:
  - `JUDGE_TOKEN_ID = 5`, `OWNERSHIP_CHECK_MS = 86_400_000`
  - `type Startup = { kind: 'pet'; tokenId: number; judge: boolean } | { kind: 'pick'; tokenIds: number[] } | { kind: 'choose' } | { kind: 'no-chog' }`
  - `chooseStartup(i: { envTokenId?: number; judgeMode: boolean; signedIn: boolean; owned: number[] | null; savedTokenId: number | null }): Startup`
    - `owned === null` means the ownership check could not run (backend down).
    - `envTokenId` is the developer override.
  - `decideOwnership(activeTokenId: number, owned: number[] | null): 'keep' | 'lost' | 'unknown'`
  - `ownershipCheckDue(last: number, now: number): boolean`

- [ ] **Step 1: Write the failing test**

`app/test/startup.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { JUDGE_TOKEN_ID, OWNERSHIP_CHECK_MS, chooseStartup, decideOwnership, ownershipCheckDue } from '../src/main/startup';

const base = { judgeMode: false, signedIn: true, owned: [5, 9] as number[] | null, savedTokenId: 9 as number | null };

describe('chooseStartup', () => {
  it('dev env override wins', () => expect(chooseStartup({ ...base, envTokenId: 1200 })).toEqual({ kind: 'pet', tokenId: 1200, judge: false }));
  it('judge mode loads the demo Chog read-only', () =>
    expect(chooseStartup({ ...base, judgeMode: true, signedIn: false, owned: null })).toEqual({ kind: 'pet', tokenId: JUDGE_TOKEN_ID, judge: true }));
  it('not signed in and not judge -> choose', () => expect(chooseStartup({ ...base, signedIn: false, owned: null })).toEqual({ kind: 'choose' }));
  it('saved Chog still owned -> pet', () => expect(chooseStartup(base)).toEqual({ kind: 'pet', tokenId: 9, judge: false }));
  it('saved Chog no longer owned -> pick from what is owned', () => expect(chooseStartup({ ...base, savedTokenId: 77 })).toEqual({ kind: 'pick', tokenIds: [5, 9] }));
  it('exactly one owned -> pet directly', () => expect(chooseStartup({ ...base, owned: [5], savedTokenId: null })).toEqual({ kind: 'pet', tokenId: 5, judge: false }));
  it('owns none -> no-chog', () => expect(chooseStartup({ ...base, owned: [] })).toEqual({ kind: 'no-chog' }));
  it('backend down but a saved Chog exists -> keep showing it', () =>
    expect(chooseStartup({ ...base, owned: null })).toEqual({ kind: 'pet', tokenId: 9, judge: false }));
  it('backend down and nothing saved -> choose', () => expect(chooseStartup({ ...base, owned: null, savedTokenId: null })).toEqual({ kind: 'choose' }));
});

describe('decideOwnership', () => {
  it.each([
    [9, [5, 9], 'keep'],
    [9, [5], 'lost'],
    [9, [], 'lost'],
    [9, null, 'unknown'],
  ] as const)('token %i with %j -> %s', (id, owned, out) => expect(decideOwnership(id, owned as number[] | null)).toBe(out));
});

describe('ownershipCheckDue', () => {
  it('is due on first run and after 24h', () => {
    expect(ownershipCheckDue(0, 1000)).toBe(true);
    expect(ownershipCheckDue(1000, 1000 + OWNERSHIP_CHECK_MS - 1)).toBe(false);
    expect(ownershipCheckDue(1000, 1000 + OWNERSHIP_CHECK_MS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/startup.ts`:
```ts
export const JUDGE_TOKEN_ID = 5;
export const OWNERSHIP_CHECK_MS = 86_400_000;

export type Startup = { kind: 'pet'; tokenId: number; judge: boolean } | { kind: 'pick'; tokenIds: number[] } | { kind: 'choose' } | { kind: 'no-chog' };

export function chooseStartup(i: { envTokenId?: number; judgeMode: boolean; signedIn: boolean; owned: number[] | null; savedTokenId: number | null }): Startup {
  if (i.envTokenId !== undefined) return { kind: 'pet', tokenId: i.envTokenId, judge: false };
  if (i.judgeMode) return { kind: 'pet', tokenId: JUDGE_TOKEN_ID, judge: true };
  if (!i.signedIn) return { kind: 'choose' };
  if (i.owned === null) return i.savedTokenId !== null ? { kind: 'pet', tokenId: i.savedTokenId, judge: false } : { kind: 'choose' };
  if (i.owned.length === 0) return { kind: 'no-chog' };
  if (i.savedTokenId !== null && i.owned.includes(i.savedTokenId)) return { kind: 'pet', tokenId: i.savedTokenId, judge: false };
  if (i.owned.length === 1) return { kind: 'pet', tokenId: i.owned[0], judge: false };
  return { kind: 'pick', tokenIds: i.owned };
}

export function decideOwnership(activeTokenId: number, owned: number[] | null): 'keep' | 'lost' | 'unknown' {
  if (owned === null) return 'unknown';
  return owned.includes(activeTokenId) ? 'keep' : 'lost';
}

export const ownershipCheckDue = (last: number, now: number) => now - last >= OWNERSHIP_CHECK_MS;
```

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/main/startup.ts app/test/startup.test.ts
git commit -m "feat(app): startup choice, Judge Mode and ownership decisions"
```

---

### Task 6: Upload timing and day rollover

**Files:**
- Create: `app/src/main/upload.ts`
- Test: `app/test/upload.test.ts`

**Interfaces:**
- Produces:
  - `UPLOAD_EVERY_MS = 3_600_000`
  - `uploadDue(last: number, now: number): boolean`
  - `rollover(today: { day: string; totals: DailyTotals }, nowDay: string): { today: { day: string; totals: DailyTotals }; yesterday: { day: string; totals: DailyTotals } | null }`
    - When the day changed, the old `today` becomes `yesterday` and a fresh day starts.
    - Otherwise nothing changes and `yesterday` is null, meaning there is nothing new to flush.
  - `uploadsFor(i: { judge: boolean; signedIn: boolean; tokenId: number; today; yesterday }): Array<{ tokenId: number; day: string; totals: DailyTotals }>`
    - Returns an empty list in Judge Mode or when signed out.
    - Otherwise returns yesterday (if any) and then today.

- [ ] **Step 1: Write the failing test**

`app/test/upload.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { UPLOAD_EVERY_MS, rollover, uploadDue, uploadsFor } from '../src/main/upload';
import { emptyTotals } from '../src/main/tally';

const day = (d: string) => ({ day: d, totals: emptyTotals() });

describe('upload timing', () => {
  it('hourly', () => {
    expect(uploadDue(0, 5)).toBe(true);
    expect(uploadDue(1000, 1000 + UPLOAD_EVERY_MS - 1)).toBe(false);
    expect(uploadDue(1000, 1000 + UPLOAD_EVERY_MS)).toBe(true);
  });
  it('rollover moves today to yesterday on a new day', () => {
    const r = rollover(day('2026-10-09'), '2026-10-10');
    expect(r.yesterday?.day).toBe('2026-10-09');
    expect(r.today.day).toBe('2026-10-10');
  });
  it('rollover is a no-op on the same day', () => {
    const t = day('2026-10-09');
    expect(rollover(t, '2026-10-09')).toEqual({ today: t, yesterday: null });
  });
  it('judge mode and signed-out never upload', () => {
    expect(uploadsFor({ judge: true, signedIn: true, tokenId: 5, today: day('a'), yesterday: day('b') })).toEqual([]);
    expect(uploadsFor({ judge: false, signedIn: false, tokenId: 5, today: day('a'), yesterday: null })).toEqual([]);
  });
  it('flushes yesterday first, then today', () => {
    expect(uploadsFor({ judge: false, signedIn: true, tokenId: 9, today: day('d2'), yesterday: day('d1') }).map((u) => u.day)).toEqual(['d1', 'd2']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/upload.ts`:
```ts
import type { DailyTotals } from '@chog/core';
import { emptyTotals } from './tally';

type Day = { day: string; totals: DailyTotals };

export const UPLOAD_EVERY_MS = 3_600_000;
export const uploadDue = (last: number, now: number) => now - last >= UPLOAD_EVERY_MS;

export function rollover(today: Day, nowDay: string): { today: Day; yesterday: Day | null } {
  if (today.day === nowDay) return { today, yesterday: null };
  return { today: { day: nowDay, totals: emptyTotals() }, yesterday: today };
}

export function uploadsFor(i: { judge: boolean; signedIn: boolean; tokenId: number; today: Day; yesterday: Day | null }) {
  if (i.judge || !i.signedIn) return [];
  return [...(i.yesterday ? [i.yesterday] : []), i.today].map((d) => ({ tokenId: i.tokenId, day: d.day, totals: d.totals }));
}
```

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/main/upload.ts app/test/upload.test.ts
git commit -m "feat(app): hourly Activity upload with day rollover"
```

---

### Task 7: Local Diary store and LLM fallback

**Files:**
- Create: `app/src/main/diary.ts`
- Test: `app/test/diary.test.ts`

**Interfaces:**
- Consumes: `ARCHETYPES` (with `voice`), `ChatProvider` (from the chat-box plan), `DailyTotals`.
- Produces:
  - `type DiaryEntry = { day: string; tokenId: number; text: string }`
  - `loadDiary(dir: string): DiaryEntry[]`, `appendDiary(dir: string, e: DiaryEntry): void` (keeps the last 30 entries), `wipeDiary(dir: string): void`
  - `localDiaryPrompt(i: { chogName: string; archetype: ArchetypeId; totals: DailyTotals }): string`
  - `writeDiary(i: { remote: () => Promise<string>; local: (() => Promise<string>) | null; template: string }): Promise<{ text: string; source: 'server' | 'local' | 'template' }>`
    - Tries remote, then local, then the template.

- [ ] **Step 1: Write the failing test**

`app/test/diary.test.ts`:
```ts
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendDiary, loadDiary, localDiaryPrompt, wipeDiary, writeDiary } from '../src/main/diary';
import { emptyTotals } from '../src/main/tally';

describe('diary store', () => {
  it('appends, caps at 30, and wipes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    expect(loadDiary(dir)).toEqual([]);
    for (let i = 0; i < 35; i++) appendDiary(dir, { day: `d${i}`, tokenId: 5, text: 't' });
    expect(loadDiary(dir)).toHaveLength(30);
    expect(loadDiary(dir)[0].day).toBe('d5');
    wipeDiary(dir);
    expect(existsSync(join(dir, 'diary.json'))).toBe(false);
    expect(loadDiary(dir)).toEqual([]);
  });
});

describe('writeDiary', () => {
  it('prefers the server', async () => {
    expect(await writeDiary({ remote: async () => 'S', local: async () => 'L', template: 'T' })).toEqual({ text: 'S', source: 'server' });
  });
  it('falls back to the local model, then the template', async () => {
    const fail = async () => { throw new Error('down'); };
    expect(await writeDiary({ remote: fail, local: async () => 'L', template: 'T' })).toEqual({ text: 'L', source: 'local' });
    expect(await writeDiary({ remote: fail, local: fail, template: 'T' })).toEqual({ text: 'T', source: 'template' });
    expect(await writeDiary({ remote: fail, local: null, template: 'T' })).toEqual({ text: 'T', source: 'template' });
  });
  it('treats an empty model reply as a failure', async () => {
    expect(await writeDiary({ remote: async () => '  ', local: null, template: 'T' })).toEqual({ text: 'T', source: 'template' });
  });
});

describe('localDiaryPrompt', () => {
  it('uses only category minutes', () => {
    const t = emptyTotals();
    t.minutes.coding = 90;
    const p = localDiaryPrompt({ chogName: 'CHOG #5', archetype: 'hype', totals: t });
    expect(p).toContain('coding: 90 min');
    expect(p).toContain('Hype Chog');
    expect(p).not.toContain('chat: 0');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/diary.ts`:
```ts
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHETYPES, type ArchetypeId, type Category, type DailyTotals } from '@chog/core';

export type DiaryEntry = { day: string; tokenId: number; text: string };
const FILE = 'diary.json';
const KEEP = 30;

export function loadDiary(dir: string): DiaryEntry[] {
  try {
    const v = JSON.parse(readFileSync(join(dir, FILE), 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function appendDiary(dir: string, e: DiaryEntry): void {
  writeFileSync(join(dir, FILE), JSON.stringify([...loadDiary(dir), e].slice(-KEEP), null, 2));
}

export function wipeDiary(dir: string): void {
  rmSync(join(dir, FILE), { force: true });
}

export function localDiaryPrompt(i: { chogName: string; archetype: ArchetypeId; totals: DailyTotals }): string {
  const a = ARCHETYPES[i.archetype];
  const day = (Object.entries(i.totals.minutes) as Array<[Category, number]>)
    .filter(([, m]) => Math.round(m) > 0)
    .map(([c, m]) => `${c}: ${Math.round(m)} min`)
    .join(', ');
  return `You are ${i.chogName}, a ${a.name} (${a.voice}). Write today's diary entry about your owner's day in first person, max 80 words, no markdown. You only know these time totals: ${day || 'no activity'}. Do not invent apps, people or events.`;
}

export async function writeDiary(i: { remote: () => Promise<string>; local: (() => Promise<string>) | null; template: string }): Promise<{ text: string; source: 'server' | 'local' | 'template' }> {
  const attempt = async (fn: () => Promise<string>) => {
    try {
      const t = (await fn()).trim();
      return t || null;
    } catch {
      return null;
    }
  };
  const s = await attempt(i.remote);
  if (s) return { text: s, source: 'server' };
  const l = i.local ? await attempt(i.local) : null;
  if (l) return { text: l, source: 'local' };
  return { text: i.template, source: 'template' };
}
```

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/main/diary.ts app/test/diary.test.ts
git commit -m "feat(app): local Diary store with server, local-model and template fallback"
```

---

### Task 8: GitHub and calendar Triggers

**Files:**
- Create: `app/src/main/triggers/github.ts`, `app/src/main/triggers/ical.ts`
- Modify: `app/src/main/reactions.ts` (the `Trigger` type), `app/src/main/lines.ts` (new lines)
- Test: `app/test/triggers.test.ts`, `app/test/reactions.test.ts` (coverage)

**Interfaces:**
- Produces:
  - `Trigger` gains `'github' | 'meeting_soon'`. `LINES` gains 3 lines per Archetype for each.
  - `fetchGithubUnread(token: string, fetchImpl?: typeof fetch): Promise<number | null>`
    - Calls GET `https://api.github.com/notifications` with `Authorization: Bearer <token>`.
    - Returns the array length, or null on any error.
  - `githubShouldFire(prev: number | null, next: number | null): boolean`
    - True only when `next > prev` and `prev` is not null. The first poll only primes.
  - `parseIcsStarts(ics: string): number[]` (epoch ms of every VEVENT DTSTART that has a time)
  - `nextMeetingWithin(starts: number[], now: number, windowMs: number, alreadyWarned: Set<number>): number | null`

- [ ] **Step 1: Write the failing tests**

`app/test/triggers.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchGithubUnread, githubShouldFire } from '../src/main/triggers/github';
import { nextMeetingWithin, parseIcsStarts } from '../src/main/triggers/ical';

describe('github', () => {
  it('counts unread notifications with a bearer token', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify([{}, {}, {}]), { status: 200 }));
    expect(await fetchGithubUnread('ghp_x', f)).toBe(3);
    expect(f.mock.calls[0][0]).toBe('https://api.github.com/notifications');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer ghp_x');
  });
  it('returns null on any error', async () => {
    expect(await fetchGithubUnread('x', vi.fn().mockResolvedValue(new Response('no', { status: 401 })))).toBeNull();
    expect(await fetchGithubUnread('x', vi.fn().mockRejectedValue(new Error('net')))).toBeNull();
  });
  it('fires only on an increase after the first poll', () => {
    expect(githubShouldFire(null, 4)).toBe(false);
    expect(githubShouldFire(4, 4)).toBe(false);
    expect(githubShouldFire(4, 2)).toBe(false);
    expect(githubShouldFire(2, 5)).toBe(true);
    expect(githubShouldFire(2, null)).toBe(false);
  });
});

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'SUMMARY:Standup', 'DTSTART:20261009T150000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;TZID=Europe/London:20261009T170000', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261010', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:garbage', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ical', () => {
  it('parses UTC and floating/TZID times, skips all-day and garbage', () => {
    const starts = parseIcsStarts(ICS);
    expect(starts).toContain(Date.UTC(2026, 9, 9, 15, 0, 0));
    expect(starts).toHaveLength(2);
  });
  it('never throws on junk', () => {
    expect(parseIcsStarts('not a calendar')).toEqual([]);
  });
  it('warns once per meeting inside the window', () => {
    const start = Date.UTC(2026, 9, 9, 15, 0, 0);
    const warned = new Set<number>();
    expect(nextMeetingWithin([start], start - 10 * 60_000, 5 * 60_000, warned)).toBeNull();
    expect(nextMeetingWithin([start], start - 4 * 60_000, 5 * 60_000, warned)).toBe(start);
    warned.add(start);
    expect(nextMeetingWithin([start], start - 3 * 60_000, 5 * 60_000, warned)).toBeNull();
    expect(nextMeetingWithin([start], start + 60_000, 5 * 60_000, new Set())).toBeNull();
  });
});
```

Append to the `pickLine` describe in `app/test/reactions.test.ts`. The existing coverage test lists its triggers, so add the two new ones to that list:
```ts
  it('has lines for the external triggers', () => {
    for (const a of ['hype', 'grump', 'lazySage', 'chaos', 'sweetheart'] as const)
      for (const t of ['github', 'meeting_soon'] as const) expect(pickLine(a, t, 'coding', () => 0.5).length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -w chog-buddy-app`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/triggers/github.ts`:
```ts
export async function fetchGithubUnread(token: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl('https://api.github.com/notifications', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const v = await res.json();
    return Array.isArray(v) ? v.length : null;
  } catch {
    return null;
  }
}

export const githubShouldFire = (prev: number | null, next: number | null) => prev !== null && next !== null && next > prev;
```

`app/src/main/triggers/ical.ts`:
```ts
// Minimal VEVENT DTSTART reader. TZID times are treated as the machine's local time
// (good enough for a 5-minute warning when owner and calendar share a timezone).
export function parseIcsStarts(ics: string): number[] {
  const out: number[] = [];
  const lines = ics.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  let inEvent = false;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') inEvent = true;
    else if (line === 'END:VEVENT') inEvent = false;
    else if (inEvent && line.startsWith('DTSTART')) {
      const value = line.slice(line.indexOf(':') + 1).trim();
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
      if (!m) continue; // all-day (DATE) or malformed
      const [, y, mo, d, h, mi, s, z] = m;
      const t = z
        ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
        : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
      if (Number.isFinite(t)) out.push(t);
    }
  }
  return out;
}

export function nextMeetingWithin(starts: number[], now: number, windowMs: number, alreadyWarned: Set<number>): number | null {
  const soon = starts.filter((t) => t > now && t - now <= windowMs && !alreadyWarned.has(t)).sort((a, b) => a - b);
  return soon[0] ?? null;
}
```

In `app/src/main/reactions.ts`, extend the type:
```ts
export type Trigger = 'category_switch' | 'long_session' | 'idle_return' | 'late_night' | 'morning' | 'focus_violation' | 'pet' | 'github' | 'meeting_soon';
```
`detectTrigger` never emits these two. Main fires them from the pollers.

In `app/src/main/lines.ts`, add `github` and `meeting_soon` arrays to every Archetype. Each array has 3 lines, in voice. For example, for hype:
```ts
    github: ['New GitHub notifications! Someone needs you, superstar!', 'Ping! GitHub is calling. Go get it!', 'More notifications? You are POPULAR.'],
    meeting_soon: ['Meeting in 5! You got this!', 'Five minutes to showtime. Water, then crush it!', 'Meeting soon. Go be legendary.'],
```
Write equivalents for grump, lazySage, chaos and sweetheart in their own voices.

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/main/triggers app/src/main/reactions.ts app/src/main/lines.ts app/test/triggers.test.ts app/test/reactions.test.ts
git commit -m "feat(app): GitHub and calendar Triggers"
```

---

### Task 9: LLM-flavoured Reaction lines

**Files:**
- Create: `app/src/main/flavour.ts`
- Test: `app/test/flavour.test.ts`

**Interfaces:**
- Consumes: `ChatProvider`, `pickProvider`, `ProviderPref` (chat-box plan), `ARCHETYPES`, `Trigger`, `Category`.
- Produces:
  - `FLAVOUR_CHANCE = 0.25`, `FLAVOUR_TIMEOUT_MS = 3000`, `MAX_FLAVOUR = 140`
  - `flavourPrompt(i: { chogName: string; archetype: ArchetypeId; trigger: Trigger; category: Category; template: string }): string`
  - `cleanFlavour(raw: string): string | null`
    - Strips surrounding quotes, markdown `*_#\``, and newlines.
    - Returns null if the result is empty or longer than `MAX_FLAVOUR`.
  - `flavourLine(i: { template: string; rand: () => number; generate: () => Promise<string> }): Promise<string>`
    - With chance `FLAVOUR_CHANCE`, races `generate` against a timeout.
    - Otherwise returns the template, or falls back to it.

- [ ] **Step 1: Write the failing test**

`app/test/flavour.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FLAVOUR_TIMEOUT_MS, MAX_FLAVOUR, cleanFlavour, flavourLine, flavourPrompt } from '../src/main/flavour';

describe('cleanFlavour', () => {
  it('strips quotes, markdown and newlines', () => expect(cleanFlavour('"**Nice** work\n buddy!"')).toBe('Nice work buddy!'));
  it('rejects empty and too-long output', () => {
    expect(cleanFlavour('  "" ')).toBeNull();
    expect(cleanFlavour('x'.repeat(MAX_FLAVOUR + 1))).toBeNull();
  });
});

describe('flavourLine', () => {
  const T = 'template line';
  it('uses the template when the dice say no', async () => {
    expect(await flavourLine({ template: T, rand: () => 0.9, generate: async () => 'gen' })).toBe(T);
  });
  it('uses a cleaned generated line when the dice say yes', async () => {
    expect(await flavourLine({ template: T, rand: () => 0.1, generate: async () => '"fresh line"' })).toBe('fresh line');
  });
  it('falls back on error, junk, or timeout', async () => {
    expect(await flavourLine({ template: T, rand: () => 0.1, generate: async () => { throw new Error('x'); } })).toBe(T);
    expect(await flavourLine({ template: T, rand: () => 0.1, generate: async () => '' })).toBe(T);
    const slow = () => new Promise<string>((r) => setTimeout(() => r('late'), FLAVOUR_TIMEOUT_MS + 500));
    const t0 = Date.now();
    expect(await flavourLine({ template: T, rand: () => 0.1, generate: slow })).toBe(T);
    expect(Date.now() - t0).toBeLessThan(FLAVOUR_TIMEOUT_MS + 400);
  }, 10_000);
});

describe('flavourPrompt', () => {
  it('names the voice, the trigger and the template as a style example', () => {
    const p = flavourPrompt({ chogName: 'CHOG #5', archetype: 'grump', trigger: 'category_switch', category: 'video', template: 'Oh, video now. Sure.' });
    expect(p).toContain('Grump Chog');
    expect(p).toContain('video');
    expect(p).toContain('Oh, video now. Sure.');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/main/flavour.ts`:
```ts
import { ARCHETYPES, type ArchetypeId, type Category } from '@chog/core';
import type { Trigger } from './reactions';

export const FLAVOUR_CHANCE = 0.25;
export const FLAVOUR_TIMEOUT_MS = 3000;
export const MAX_FLAVOUR = 140;

const WHAT: Record<Trigger, string> = {
  category_switch: 'just switched to {category}',
  long_session: 'has been doing {category} for 90 minutes straight',
  idle_return: 'just came back after a break',
  late_night: 'is still up past midnight',
  morning: 'just started their day',
  focus_violation: 'opened a distraction during Focus Mode',
  pet: 'just clicked on you',
  github: 'got new GitHub notifications',
  meeting_soon: 'has a meeting in 5 minutes',
};

export function flavourPrompt(i: { chogName: string; archetype: ArchetypeId; trigger: Trigger; category: Category; template: string }): string {
  const a = ARCHETYPES[i.archetype];
  return `You are ${i.chogName}, a ${a.name}: ${a.voice}. Your owner ${WHAT[i.trigger].replace('{category}', i.category)}. Say ONE short line (max 15 words) reacting to it, in character, no quotes, no emoji spam. Example of your style: "${i.template}"`;
}

export function cleanFlavour(raw: string): string | null {
  const s = raw.replace(/[*_#`]/g, '').replace(/\s*\n\s*/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!s || s.length > MAX_FLAVOUR) return null;
  return s;
}

export async function flavourLine(i: { template: string; rand: () => number; generate: () => Promise<string> }): Promise<string> {
  if (i.rand() >= FLAVOUR_CHANCE) return i.template;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), FLAVOUR_TIMEOUT_MS));
  const gen = i.generate().then(cleanFlavour, () => null);
  return (await Promise.race([gen, timeout])) ?? i.template;
}
```

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/main/flavour.ts app/test/flavour.test.ts
git commit -m "feat(app): occasional LLM-flavoured Reaction lines with template fallback"
```

---

### Task 10: Wire it all into main

**Files:**
- Modify: `app/src/main/main.ts`, `app/src/renderer/pet.ts` (Diary display reuses the chat bubble)

**Interfaces:**
- Consumes: everything from Tasks 1–9, plus the chat-box plan's `openChat`/`closeChat`, the `key` input mode, `createOllama`, `createGemini`, `pickProvider` and `safeStorage`.
- Changes the secret-input mode to support several secret kinds: `chat-open { mode: 'key' | 'github' | 'ical' | 'chat' }`. The renderer shows a password field with a matching placeholder. Main routes `key-submit` by the mode it opened.

- [ ] **Step 1: Cipher adapter**

Near the top of main.ts:
```ts
const cipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};
```
Replace the chat-box plan's `geminiKey()` body with `return unseal(cipher, settings.chat.geminiKeyEnc);`. Use `seal(cipher, k)` in the key handler, and show the existing error box when it returns null.

- [ ] **Step 2: Startup flow**

This runs before loading the Chog. Replace the current `const tokenId = Number(process.env.CHOG_TOKEN_ID ?? settings.tokenId)` with:
```ts
  const apiUrl = process.env.CHOG_API_URL ?? settings.apiUrl;
  const sessionToken = settings.session ? unseal(cipher, settings.session.tokenEnc) : null;
  const api = createApi({ baseUrl: apiUrl, token: sessionToken });
  const owned = sessionToken ? await api.myChogs().catch(() => null) : null;
  if (owned !== null) settings.lastOwnershipCheck = Date.now();
  const envTokenId = process.env.CHOG_TOKEN_ID ? Number(process.env.CHOG_TOKEN_ID) : undefined;
  let choice = chooseStartup({ envTokenId, judgeMode: settings.judgeMode, signedIn: !!sessionToken, owned, savedTokenId: settings.session ? settings.tokenId : null });
  if (sessionToken && owned !== null && settings.tokenId && decideOwnership(settings.tokenId, owned) === 'lost') {
    wipeDiary(app.getPath('userData'));
    await dialog.showMessageBox({ message: `Chog #${settings.tokenId} is no longer in your wallet, so its diary was cleared. Its Soul stays with the Chog.` });
  }
  choice = await resolveChoice(choice, api, apiUrl);
  if (!choice) { app.quit(); return; }
  const tokenId = choice.tokenId;
  const judge = choice.judge;
  settings.tokenId = tokenId;
  saveSettings(app.getPath('userData'), settings);
```

Add the helper `resolveChoice`. It drives the native dialogs and returns `{ tokenId, judge }` or null to quit:
```ts
async function resolveChoice(choice: Startup, api: ReturnType<typeof createApi>, apiUrl: string): Promise<{ tokenId: number; judge: boolean } | null> {
  for (;;) {
    if (choice.kind === 'pet') return { tokenId: choice.tokenId, judge: choice.judge };
    if (choice.kind === 'pick') {
      const ids = choice.tokenIds.slice(0, 8);
      const r = await dialog.showMessageBox({ message: 'Which Chog should live on your desktop?', buttons: ids.map((id) => `Chog #${id}`), cancelId: -1 });
      if (r.response < 0) return null;
      return { tokenId: ids[r.response], judge: false };
    }
    const intro = choice.kind === 'no-chog' ? 'This wallet holds no Chog Genesis NFT.' : 'Chog Buddy needs a Chog Genesis NFT.';
    const r = await dialog.showMessageBox({ message: intro, detail: 'Sign in with the wallet that holds your Chog, or try the labelled demo Chog (Judge Mode).', buttons: ['Sign in with wallet', 'Judge Mode (demo Chog)', 'Quit'], cancelId: 2 });
    if (r.response === 2) return null;
    if (r.response === 1) {
      settings.judgeMode = true;
      return { tokenId: JUDGE_TOKEN_ID, judge: true };
    }
    try {
      const s = await startSignIn({ apiUrl, open: (u) => shell.openExternal(u) });
      const tokenEnc = seal(cipher, s.token);
      if (!tokenEnc) throw new Error('Secure storage unavailable');
      settings.session = { tokenEnc, address: s.address };
      settings.judgeMode = false;
      const owned = await createApi({ baseUrl: apiUrl, token: s.token }).myChogs().catch(() => null);
      choice = owned === null ? { kind: 'choose' } : chooseStartup({ judgeMode: false, signedIn: true, owned, savedTokenId: null });
    } catch (e) {
      await dialog.showMessageBox({ type: 'warning', message: `Sign-in failed: ${(e as Error).message}` });
      choice = { kind: 'choose' };
    }
  }
}
```
Add `shell` to the electron import.

- [ ] **Step 3: Periodic jobs**

Start these after the Pet appears, and skip all of them in Judge Mode:
```ts
  const userData = app.getPath('userData');
  // Upload + rollover + ownership re-check, every 10 min tick; each job has its own due rule.
  setInterval(async () => {
    const r = rollover(settings.today, dayKey(new Date()));
    if (r.yesterday) { settings.today = r.today; settings.yesterday = r.yesterday; }
    const token = settings.session ? unseal(cipher, settings.session.tokenEnc) : null;
    const api = createApi({ baseUrl: apiUrl, token });
    if (uploadDue(settings.lastUpload, Date.now())) {
      const jobs = uploadsFor({ judge, signedIn: !!token, tokenId, today: settings.today, yesterday: settings.yesterday });
      try {
        for (const j of jobs) await api.uploadActivity(j);
        if (jobs.length) { settings.lastUpload = Date.now(); settings.yesterday = null; }
      } catch { /* retry next tick */ }
    }
    if (!judge && token && ownershipCheckDue(settings.lastOwnershipCheck, Date.now())) {
      const owned = await api.myChogs().catch(() => null);
      if (owned !== null) settings.lastOwnershipCheck = Date.now();
      if (decideOwnership(tokenId, owned) === 'lost') {
        wipeDiary(userData);
        settings.session = null;
        saveSettings(userData, settings);
        await dialog.showMessageBox({ message: `Chog #${tokenId} left your wallet. Its diary was cleared. Restart Chog Buddy to choose again.` });
        app.quit();
        return;
      }
    }
    saveSettings(userData, settings);
  }, 10 * 60_000);
```

For GitHub, poll every 5 minutes only when a token is set. Keep `let lastUnread: number | null = null`. When `githubShouldFire` is true, call `say('github')` with the normal cooldown rules: build an `Observation`-free check `Date.now() - reactions.lastSpokeAt >= COOLDOWN_MS`, and on firing set `reactions.lastSpokeAt`.

For the calendar:
- Fetch the ICS every 15 minutes when an iCal URL is set.
- Keep `starts: number[]` and `warned: Set<number>`.
- Every 60 s, check `nextMeetingWithin(starts, Date.now(), 5 * 60_000, warned)`. On a hit, add the start to `warned` and call `say('meeting_soon')`. This bypasses the cooldown, because meetings matter.

- [ ] **Step 4: Flavour in `say()`**

Make `say` async. The template stays the instant fallback:
```ts
async function say(trigger: Trigger) {
  const template = pickLine(archetype, trigger, lastCategory);
  const line = await flavourLine({
    template, rand: Math.random,
    generate: async () => {
      const p = await pickProvider(settings.chat.provider, [createOllama({ model: settings.chat.ollamaModel }), createGemini({ apiKey: geminiKey() })]);
      if (!p) throw new Error('no provider');
      return p.stream(flavourPrompt({ chogName: meta.name, archetype, trigger, category: lastCategory, template }), [{ role: 'user', content: 'React now.' }], () => {});
    },
  });
  win?.webContents.send('say', line);
  talkUntil = Date.now() + TALK_MS;
}
```
`meta` must be module-level, or `say` must close over it. Hoist `let meta: ChogMetadata` to module scope.

- [ ] **Step 5: Diary**

The trigger is the tray item "Today's diary", plus an automatic write at the first poll after 21:00 local time when today has no entry.

```ts
async function showDiary() {
  const userData = app.getPath('userData');
  const entries = loadDiary(userData).filter((e) => e.tokenId === tokenId);
  const today = dayKey(new Date());
  let entry = entries.find((e) => e.day === today);
  if (!entry) {
    const token = settings.session ? unseal(cipher, settings.session.tokenEnc) : null;
    const api = createApi({ baseUrl: apiUrl, token });
    const r = await writeDiary({
      remote: () => (judge || !token ? Promise.reject(new Error('judge/signed-out')) : api.diary({ tokenId, totals: settings.today.totals })),
      local: async () => {
        const p = await pickProvider(settings.chat.provider, [createOllama({ model: settings.chat.ollamaModel }), createGemini({ apiKey: geminiKey() })]);
        if (!p) throw new Error('no provider');
        return p.stream(localDiaryPrompt({ chogName: meta.name, archetype, totals: settings.today.totals }), [{ role: 'user', content: 'Write today\'s entry.' }], () => {});
      },
      template: pickLine(archetype, 'idle_return', lastCategory),
    });
    entry = { day: today, tokenId, text: r.text };
    appendDiary(userData, entry);
  }
  openChat('chat');
  win?.webContents.send('chat-token', `📔 ${entry.text}`);
  win?.webContents.send('chat-done', { failed: false });
}
```
The Judge Mode diary is local-only and written to the same file. That's acceptable because it is the demo Chog.

- [ ] **Step 6: Tray additions**

- The first line of the tray reads `${meta.name} · ${ARCHETYPES[archetype].name}${judge ? ' · Judge Mode (demo Chog)' : ''}`.
- Add "Today's diary" (calls `showDiary()`).
- Add a "Connections" submenu:
  - "Set GitHub token…" opens `openChat('github')`. Add a hint label: "Fine-grained token with Notifications: read".
  - "Set calendar iCal URL…" opens `openChat('ical')`. Add a hint label: "Google Calendar → Settings → Secret address in iCal format".
  - "Clear" items for both.
- Add "Sign out" (clears `settings.session`, sets `judgeMode` to false, wipes the diary, then calls `app.relaunch(); app.exit(0)`).
- In Judge Mode, also add "Sign in with wallet…", which sets `judgeMode` to false, then relaunches.

Route `key-submit` by the mode that `openChat` stored in `let secretMode`:
- `key`: Gemini
- `github`: `settings.secrets.githubEnc = seal(...)`
- `ical`: validate `/^https:\/\//`, then `settings.secrets.icalEnc = seal(...)`

In `pet.ts`, extend the placeholder map for the `github` and `ical` modes. All three secret modes use `type=password`.

- [ ] **Step 7: Verify**

Run: `npm run typecheck -w chog-buddy-app && npm test -w @chog/core -w chog-buddy-app && npm run build -w chog-buddy-app`
Expected: clean, all PASS.

Then check by launch, without a backend:
1. Launch from `app/` with no `CHOG_TOKEN_ID` and an empty `settings.json` (move the old one aside, then restore it). Expect the choice dialog: Sign in / Judge Mode / Quit.
2. Pick Judge Mode. Expect token #5 to appear, and the tray label to say Judge Mode.
3. Relaunch. Judge Mode persists.
4. Pick Sign in with an unreachable `CHOG_API_URL=http://127.0.0.1:9`. The browser opens the URL, and sign-in times out or fails gracefully.

Record all of this in the report. Kill only the processes you started, then restore `settings.json`.

- [ ] **Step 8: Commit**
```bash
git add app/src
git commit -m "feat(app): sign-in, Chog picker, Judge Mode, uploads, Diary, Triggers and flavour lines"
```

---

## Not in this plan
- A backend chat proxy for judges without a key or Ollama. This would add `/api/chat` to the backend plan later.
- Calendar timezone accuracy beyond the machine's local time. Google OAuth is out of scope.
- Owner-signed Soul updates (ADR 0002).
