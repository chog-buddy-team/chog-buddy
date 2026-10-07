# Chog Buddy Soul + Backend Implementation Plan (Track B: backend/contracts teammate)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the onchain Soul and the API that feeds it: a `ChogSoul` contract on Monad testnet, plus a Next.js backend. The backend handles sign-in (SIWE), ownership checks, Activity upload, the daily Soul Drift job and Diary generation.

**Architecture:** `contracts/` is a Foundry project with one contract. Only one server wallet can write to it, and it writes in batches (ADR 0002). `web/` is a Next.js App Router app on Vercel with Neon Postgres. Every rule that can be pure lives in `packages/core` (Drift) or `web/lib/*` and is unit-tested. Route handlers only parse, authorize, call a lib function, and respond.

**Tech Stack:** Foundry (Solidity ^0.8.24, forge), Next.js (App Router), TypeScript, viem (incl. `viem/siwe`), `@neondatabase/serverless`, vitest, Gemini REST API (free tier), Vercel Cron + GitHub Actions.

**Spec:** `docs/designs/chog-buddy.md` (plus `CONTEXT.md`, `docs/adr/`).

**Companion plan:** `docs/superpowers/plans/2026-10-07-pet-app.md` (Track A). **Tasks 3+ here need Track A Tasks 1-2 merged** (`@chog/core` workspace with types, `pickArchetype`, `fetchChogMetadata`, `monad`, `monadTestnet`, `chogAbi`, `CHOG_CONTRACT`). Tasks 1-2 here are independent, so start with them on day 1.

## Global Constraints

- Budget $0: Vercel Hobby, Neon free, Gemini free tier, Monad testnet faucet.
- Soul lives on **Monad testnet** (chain 10143). Chog ownership is read from **Monad mainnet** (chain 143).
- The server stores no Diary text, window titles or raw Activity. It stores only per-token daily Category minutes (ADR 0001).
- Soul Axes are integers 0-100. Drift is at most ±3 per Axis per day.
- Only one writer key can write Souls. It's a testnet-only key, kept in Vercel env (ADR 0002).
- Contract interface uses a struct array, `batchSet(uint256[] ids, Soul[] souls)`. This replaces the "bytes32 packed" wording in the design doc.
- Every API route except `/api/auth/*` and `/api/cron/*` requires `Authorization: Bearer <session token>`.

## Review Focus

1. **Forged or wild Activity totals** (negative minutes, 5,000 minutes in a day, missing Categories, strings): expect a 400 and nothing stored. Test in Task 3 (`parseDailyTotals`).
2. **Cron missed or run twice** (Vercel skipped a day; GitHub backup also fires): each day's Activity must apply exactly once and in day order. Test in Task 7 (`computeSoulUpdates`).
3. **Replay of a SIWE signature** or a message for another domain: expect 401. Nonces are single-use. Test in Task 5 (`verifyLogin`) and enforced by `DELETE ... RETURNING` in the route.
4. **Uploading Activity for a Chog you don't own** (or one sold since): expect 403. Ownership is checked against mainnet `ownerOf` on every upload. Test in Task 6 (route test with stubbed owner).
5. **Gemini quota/outage**: the Diary endpoint must still return a template Diary with HTTP 200, not a 500. Test in Task 8.

---

## File Structure

```
contracts/
  foundry.toml
  src/ChogSoul.sol
  test/ChogSoul.t.sol
packages/core/src/soul.ts          driftAxes, nextSoul, parseDailyTotals (shared with app)
packages/core/test/soul.test.ts
web/                               create-next-app output, plus:
  next.config.ts                   transpilePackages @chog/core
  vercel.json                      daily cron
  db/schema.sql
  lib/db.ts                        Neon client
  lib/auth.ts                      verifyLogin (pure), AuthError
  lib/session.ts                   createSession, requireSession
  lib/owner.ts                     ownerOf, listOwnedChogs (Alchemy)
  lib/activity.ts                  parseActivityBody
  lib/soul-job.ts                  computeSoulUpdates (pure), runSoulJob
  lib/soul-abi.ts
  lib/diary.ts                     buildDiaryPrompt, templateDiary, generateDiary
  app/api/auth/nonce/route.ts
  app/api/auth/verify/route.ts
  app/api/me/chogs/route.ts
  app/api/chog/[id]/route.ts
  app/api/activity/route.ts
  app/api/cron/soul/route.ts
  app/api/diary/route.ts
  test/*.test.ts
.github/workflows/soul-cron.yml    backup trigger
```

---

### Task 1: ChogSoul contract

**Files:**
- Create: `contracts/foundry.toml`, `contracts/src/ChogSoul.sol`
- Test: `contracts/test/ChogSoul.t.sol`

**Interfaces:**
- Produces (Solidity, consumed by Task 7 via ABI):
  - `struct Soul { uint8 nightOwl; uint8 grinder; uint8 social; uint8 creator; uint32 level; uint16 ownerCount; }`
  - `function batchSet(uint256[] calldata ids, Soul[] calldata souls) external` (writer only)
  - `function getSoul(uint256 id) external view returns (Soul memory)`
  - `function setWriter(address w) external` (admin only)
  - `event SoulUpdated(uint256 indexed tokenId, Soul soul)`
  - errors `NotWriter()`, `NotAdmin()`, `LengthMismatch()`, `AxisOutOfRange()`

- [ ] **Step 1: Install Foundry and init**

Run:
```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts 2>/dev/null || (forge init contracts --no-git && cd contracts)
rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
```
Expected: `forge --version` prints a version. `contracts/lib/forge-std` exists.

`contracts/foundry.toml`:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"

[rpc_endpoints]
monad_testnet = "https://testnet-rpc.monad.xyz"
```

- [ ] **Step 2: Write the failing test**

`contracts/test/ChogSoul.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChogSoul} from "../src/ChogSoul.sol";

contract ChogSoulTest is Test {
    ChogSoul soul;
    address writer = address(0xBEEF);

    function setUp() public {
        soul = new ChogSoul(writer);
    }

    function _one(uint256 id, uint8 v) internal pure returns (uint256[] memory ids, ChogSoul.Soul[] memory s) {
        ids = new uint256[](1);
        ids[0] = id;
        s = new ChogSoul.Soul[](1);
        s[0] = ChogSoul.Soul(v, v, v, v, 3, 1);
    }

    function test_writerCanBatchSet() public {
        (uint256[] memory ids, ChogSoul.Soul[] memory s) = _one(5, 60);
        vm.prank(writer);
        soul.batchSet(ids, s);
        ChogSoul.Soul memory got = soul.getSoul(5);
        assertEq(got.nightOwl, 60);
        assertEq(got.level, 3);
        assertEq(got.ownerCount, 1);
    }

    function test_unsetSoulIsZero() public view {
        assertEq(soul.getSoul(1).level, 0);
    }

    function test_nonWriterReverts() public {
        (uint256[] memory ids, ChogSoul.Soul[] memory s) = _one(5, 60);
        vm.expectRevert(ChogSoul.NotWriter.selector);
        soul.batchSet(ids, s);
    }

    function test_lengthMismatchReverts() public {
        (uint256[] memory ids,) = _one(5, 60);
        ChogSoul.Soul[] memory none = new ChogSoul.Soul[](0);
        vm.prank(writer);
        vm.expectRevert(ChogSoul.LengthMismatch.selector);
        soul.batchSet(ids, none);
    }

    function test_axisAbove100Reverts() public {
        (uint256[] memory ids, ChogSoul.Soul[] memory s) = _one(5, 101);
        vm.prank(writer);
        vm.expectRevert(ChogSoul.AxisOutOfRange.selector);
        soul.batchSet(ids, s);
    }

    function test_emitsSoulUpdated() public {
        (uint256[] memory ids, ChogSoul.Soul[] memory s) = _one(7, 50);
        vm.expectEmit(true, false, false, true);
        emit ChogSoul.SoulUpdated(7, s[0]);
        vm.prank(writer);
        soul.batchSet(ids, s);
    }

    function test_adminRotatesWriter() public {
        soul.setWriter(address(0xCAFE));
        assertEq(soul.writer(), address(0xCAFE));
        vm.prank(address(0xBAD));
        vm.expectRevert(ChogSoul.NotAdmin.selector);
        soul.setWriter(address(0xBAD));
    }

    function test_batchOf100Fits() public {
        uint256[] memory ids = new uint256[](100);
        ChogSoul.Soul[] memory s = new ChogSoul.Soul[](100);
        for (uint256 i; i < 100; i++) {
            ids[i] = i + 1;
            s[i] = ChogSoul.Soul(50, 50, 50, 50, 1, 1);
        }
        vm.prank(writer);
        soul.batchSet(ids, s);
        assertEq(soul.getSoul(100).level, 1);
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd contracts && forge test`
Expected: compile error, `ChogSoul.sol` not found.

- [ ] **Step 4: Implement**

`contracts/src/ChogSoul.sol`:
```solidity
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

    constructor(address writer_) {
        admin = msg.sender;
        writer = writer_;
    }

    function setWriter(address w) external {
        if (msg.sender != admin) revert NotAdmin();
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd contracts && forge test -vv`
Expected: 8 tests PASS. Note the gas for `test_batchOf100Fits`; it should be well under Monad's block gas limit.

- [ ] **Step 6: Commit**

```bash
git add contracts
git commit -m "feat(contracts): ChogSoul with single-writer batched updates"
```

---

### Task 2: Deploy ChogSoul to Monad testnet

**Files:**
- Create: `contracts/.env.example`, `contracts/DEPLOYMENTS.md`

**Interfaces:**
- Produces: `SOUL_CONTRACT` address (testnet). Task 7 and Chog Park read it.

- [ ] **Step 1: Create two testnet-only wallets**

Run:
```bash
cast wallet new   # deployer/admin
cast wallet new   # soul writer (goes into Vercel env later)
```
Store both private keys in a password manager. Never commit them.

`contracts/.env.example`:
```bash
DEPLOYER_KEY=0x...
WRITER_ADDRESS=0x...
```
Copy it to `contracts/.env` and fill in the values (`.env*` is gitignored; `.env.example` is allowed).

- [ ] **Step 2: Fund both from the faucet**

Open the Monad testnet faucet linked from https://docs.monad.xyz and request MON for both addresses.
Run: `cast balance <address> --rpc-url monad_testnet` from `contracts/`.
Expected: non-zero for both.

- [ ] **Step 3: Deploy**

Run:
```bash
cd contracts && source .env
forge create src/ChogSoul.sol:ChogSoul --rpc-url monad_testnet --private-key $DEPLOYER_KEY --broadcast --constructor-args $WRITER_ADDRESS
```
Expected: `Deployed to: 0x...`.

- [ ] **Step 4: Smoke-test onchain**

Run:
```bash
cast call <SOUL_CONTRACT> "writer()(address)" --rpc-url monad_testnet
cast call <SOUL_CONTRACT> "getSoul(uint256)((uint8,uint8,uint8,uint8,uint32,uint16))" 5 --rpc-url monad_testnet
```
Expected: the writer address; `(0, 0, 0, 0, 0, 0)`.

- [ ] **Step 5: Record and commit**

`contracts/DEPLOYMENTS.md`:
```md
# Deployments

| Network | Contract | Address | Writer |
|---|---|---|---|
| Monad testnet (10143) | ChogSoul | <SOUL_CONTRACT> | <WRITER_ADDRESS> |
```

```bash
git add contracts/.env.example contracts/DEPLOYMENTS.md
git commit -m "chore(contracts): deploy ChogSoul to Monad testnet"
```

---

### Task 3: Drift + Activity validation in core

**Files:**
- Create: `packages/core/src/soul.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/soul.test.ts`

**Interfaces:**
- Consumes: `Axes`, `Soul`, `DailyTotals`, `CATEGORIES`, `Category` (Track A Task 1).
- Produces:
  - `MAX_DAILY_DRIFT = 3`
  - `driftAxes(axes: Axes, t: DailyTotals): Axes`
  - `nextSoul(prev: Soul | null, base: Axes, t: DailyTotals, ownerChanged: boolean): Soul`
  - `parseDailyTotals(x: unknown): DailyTotals` (throws `TypeError`)

- [ ] **Step 1: Write the failing test**

`packages/core/test/soul.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category, type DailyTotals } from '../src/types';
import { driftAxes, nextSoul, parseDailyTotals } from '../src/soul';

const totals = (m: Partial<Record<Category, number>>, late = 0, early = 0): DailyTotals => ({
  minutes: Object.fromEntries(CATEGORIES.map((c) => [c, m[c] ?? 0])) as Record<Category, number>,
  lateMinutes: late,
  earlyMinutes: early,
});
const mid = { nightOwl: 50, grinder: 50, social: 50, creator: 50 };

describe('driftAxes', () => {
  it('no activity barely moves anything', () => {
    // social has a 60-minute baseline, so zero chat drifts it down
    expect(driftAxes(mid, totals({}))).toEqual({ nightOwl: 50, grinder: 50, social: 48, creator: 50 });
  });
  it('a big coding day pushes grinder and creator up by the cap', () => {
    const a = driftAxes(mid, totals({ coding: 480 }));
    expect(a.grinder).toBe(53);
    expect(a.creator).toBe(53);
  });
  it('late nights push nightOwl up, early mornings down', () => {
    expect(driftAxes(mid, totals({ coding: 120 }, 120, 0)).nightOwl).toBe(52);
    expect(driftAxes(mid, totals({ coding: 120 }, 0, 120)).nightOwl).toBe(48);
  });
  it('lots of video drags grinder and creator down', () => {
    const a = driftAxes(mid, totals({ video: 300 }));
    expect(a.grinder).toBe(47);
    expect(a.creator).toBe(47);
  });
  it('chatty day raises social', () => {
    expect(driftAxes(mid, totals({ chat: 180 })).social).toBe(53);
  });
  it('clamps to 0-100', () => {
    expect(driftAxes({ ...mid, grinder: 99 }, totals({ coding: 600 })).grinder).toBe(100);
    expect(driftAxes({ ...mid, grinder: 1 }, totals({ video: 600 })).grinder).toBe(0);
  });
});

describe('nextSoul', () => {
  const base = { nightOwl: 70, grinder: 20, social: 40, creator: 60 };
  it('first day starts from the archetype base, level 1, ownerCount 1', () => {
    const s = nextSoul(null, base, totals({}), false);
    expect(s).toMatchObject({ level: 1, ownerCount: 1, nightOwl: 70 });
  });
  it('increments level and keeps ownerCount for same owner', () => {
    const s = nextSoul({ ...base, level: 4, ownerCount: 2 }, base, totals({}), false);
    expect(s).toMatchObject({ level: 5, ownerCount: 2 });
  });
  it('bumps ownerCount when the owner changed', () => {
    expect(nextSoul({ ...base, level: 4, ownerCount: 2 }, base, totals({}), true).ownerCount).toBe(3);
  });
});

describe('parseDailyTotals', () => {
  const ok = { minutes: { coding: 10, chat: 5 }, lateMinutes: 0, earlyMinutes: 0 };
  it('fills missing categories with 0', () => {
    expect(parseDailyTotals(ok).minutes.video).toBe(0);
  });
  it.each([
    ['null', null],
    ['string minutes', { ...ok, minutes: { coding: '10' } }],
    ['negative', { ...ok, minutes: { coding: -1 } }],
    ['unknown category', { ...ok, minutes: { gaming: 10 } }],
    ['more than a day', { ...ok, minutes: { coding: 1000, chat: 500 } }],
    ['late > total', { ...ok, lateMinutes: 100 }],
    ['NaN', { ...ok, earlyMinutes: Number.NaN }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseDailyTotals(input)).toThrow(TypeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @chog/core`
Expected: FAIL, cannot resolve `../src/soul`.

- [ ] **Step 3: Implement**

`packages/core/src/soul.ts`:
```ts
import { CATEGORIES, type Axes, type Category, type DailyTotals, type Soul } from './types';

export const MAX_DAILY_DRIFT = 3;
const MINUTES_PER_DAY = 1440;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const step = (raw: number) => clamp(Math.round(raw), -MAX_DAILY_DRIFT, MAX_DAILY_DRIFT);

export function driftAxes(a: Axes, t: DailyTotals): Axes {
  const m = t.minutes;
  return {
    nightOwl: clamp(a.nightOwl + step((t.lateMinutes - t.earlyMinutes) / 60), 0, 100),
    grinder: clamp(a.grinder + step((m.coding + m.design + m.meeting - m.video - m.idle) / 60), 0, 100),
    social: clamp(a.social + step((m.chat + m.meeting - 60) / 30), 0, 100),
    creator: clamp(a.creator + step((m.coding + m.design - m.browsing - m.video) / 60), 0, 100),
  };
}

export function nextSoul(prev: Soul | null, base: Axes, t: DailyTotals, ownerChanged: boolean): Soul {
  const start: Soul = prev ?? { ...base, level: 0, ownerCount: 0 };
  return {
    ...driftAxes(start, t),
    level: start.level + 1,
    ownerCount: start.ownerCount + (prev === null || ownerChanged ? 1 : 0),
  };
}

const isMinutes = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MINUTES_PER_DAY;

export function parseDailyTotals(x: unknown): DailyTotals {
  if (typeof x !== 'object' || x === null) throw new TypeError('totals must be an object');
  const { minutes, lateMinutes, earlyMinutes } = x as Record<string, unknown>;
  if (typeof minutes !== 'object' || minutes === null) throw new TypeError('minutes must be an object');
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const [k, v] of Object.entries(minutes)) {
    if (!(CATEGORIES as readonly string[]).includes(k)) throw new TypeError(`unknown category ${k}`);
    if (!isMinutes(v)) throw new TypeError(`bad minutes for ${k}`);
    out[k as Category] = v;
  }
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total > MINUTES_PER_DAY) throw new TypeError('more minutes than a day');
  if (!isMinutes(lateMinutes) || !isMinutes(earlyMinutes)) throw new TypeError('bad late/early minutes');
  if (lateMinutes + earlyMinutes > total) throw new TypeError('late/early exceed total');
  return { minutes: out, lateMinutes, earlyMinutes };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './soul';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @chog/core`
Expected: PASS. Check by hand: zero chat gives `(0 - 60) / 30 = -2`, so social is 48.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/soul.ts packages/core/src/index.ts packages/core/test/soul.test.ts
git commit -m "feat(core): Soul Drift and Activity totals validation"
```

---

### Task 4: Next.js app, database, Neon client

**Files:**
- Create: `web/` (create-next-app), `web/db/schema.sql`, `web/lib/db.ts`, `web/vitest.config.ts`, `web/.env.example`
- Modify: root `package.json` (add `web` workspace), `web/next.config.ts`, `web/package.json`

**Interfaces:**
- Produces: `sql` tagged-template client (`web/lib/db.ts`); tables `nonces`, `sessions`, `activity`, `souls`.

- [ ] **Step 1: Scaffold**

Run from the repo root:
```bash
npx create-next-app@latest web --ts --app --eslint --use-npm --yes --no-tailwind --no-src-dir --import-alias "@/*"
rm -rf web/.git
```
Then add `"web"` to root `package.json` workspaces: `["packages/*", "app", "web"]`.

Run: `npm install && npm install -w web @neondatabase/serverless viem @chog/core@* && npm install -w web -D vitest`
Expected: installs OK.

- [ ] **Step 2: Let Next compile the TS workspace package**

`web/next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@chog/core'],
};

export default nextConfig;
```

`web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: { environment: 'node' },
});
```

Add to `web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Database**

Create a free Neon project at https://neon.tech and copy its connection string.

`web/.env.example`:
```bash
DATABASE_URL=postgres://...
SIWE_DOMAIN=localhost:3000
ALCHEMY_KEY=
SOUL_CONTRACT=0x...
SOUL_WRITER_KEY=0x...
CRON_SECRET=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```
Copy it to `web/.env.local` and fill in `DATABASE_URL`.

`web/db/schema.sql`:
```sql
create table if not exists nonces (
  nonce text primary key,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  address text not null,
  created_at timestamptz not null default now()
);

-- One row per Chog per Owner-local day. Only Category minutes (ADR 0001).
create table if not exists activity (
  token_id int not null,
  day date not null,
  owner text not null,
  totals jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (token_id, day)
);

-- Mirror of the onchain Soul plus bookkeeping for the daily job.
create table if not exists souls (
  token_id int primary key,
  night_owl int not null,
  grinder int not null,
  social int not null,
  creator int not null,
  level int not null,
  owner_count int not null,
  last_owner text not null,
  last_day date not null
);
```

Run: `psql "$DATABASE_URL" -f web/db/schema.sql` (or paste it into the Neon SQL editor).
Expected: `CREATE TABLE` x4.

`web/lib/db.ts`:
```ts
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

export const sql = neon(url);
```

- [ ] **Step 4: Verify**

Run: `npm run build -w web`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json web
git commit -m "feat(web): Next.js app, Neon schema and client"
```

---

### Task 5: SIWE sign-in and sessions

**Files:**
- Create: `web/lib/auth.ts`, `web/lib/session.ts`, `web/app/api/auth/nonce/route.ts`, `web/app/api/auth/verify/route.ts`
- Test: `web/test/auth.test.ts`

**Interfaces:**
- Consumes: `sql` (Task 4).
- Produces:
  - `class AuthError extends Error`
  - `verifyLogin(message: string, signature: Hex, expected: { domain: string; now?: Date }): Promise<{ address: Address; nonce: string }>`
  - `createSession(address: Address): Promise<string>`
  - `requireSession(req: Request): Promise<Address>` (throws `AuthError`)
  - `POST /api/auth/nonce` returns `{ nonce }`
  - `POST /api/auth/verify` takes `{ message, signature }` and returns `{ token, address }`, or 401

- [ ] **Step 1: Write the failing test**

`web/test/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createSiweMessage, generateSiweNonce } from 'viem/siwe';
import { AuthError, verifyLogin } from '@/lib/auth';

const account = privateKeyToAccount(generatePrivateKey());
const domain = 'buddy.chog.test';

function msg(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({
    address: account.address,
    chainId: 143,
    domain,
    nonce: generateSiweNonce(),
    uri: `https://${domain}`,
    version: '1',
    issuedAt: new Date(),
    ...overrides,
  });
}

describe('verifyLogin', () => {
  it('accepts a valid signature and returns address + nonce', async () => {
    const message = msg();
    const signature = await account.signMessage({ message });
    const r = await verifyLogin(message, signature, { domain });
    expect(r.address).toBe(account.address);
    expect(r.nonce).toMatch(/\w{8,}/);
  });

  it('rejects another domain', async () => {
    const message = msg({ domain: 'evil.test', uri: 'https://evil.test' });
    const signature = await account.signMessage({ message });
    await expect(verifyLogin(message, signature, { domain })).rejects.toThrow(AuthError);
  });

  it('rejects a signature from another wallet', async () => {
    const message = msg();
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message });
    await expect(verifyLogin(message, signature, { domain })).rejects.toThrow(AuthError);
  });

  it('rejects stale messages (issued > 10 min ago)', async () => {
    const message = msg({ issuedAt: new Date(Date.now() - 11 * 60_000) });
    const signature = await account.signMessage({ message });
    await expect(verifyLogin(message, signature, { domain })).rejects.toThrow(/stale/);
  });

  it('rejects expired messages', async () => {
    const message = msg({ expirationTime: new Date(Date.now() - 1000) });
    const signature = await account.signMessage({ message });
    await expect(verifyLogin(message, signature, { domain })).rejects.toThrow(/expired/);
  });

  it('rejects garbage', async () => {
    await expect(verifyLogin('hello', '0x00', { domain })).rejects.toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL, cannot resolve `@/lib/auth`.

- [ ] **Step 3: Implement verifyLogin**

`web/lib/auth.ts`:
```ts
import { getAddress, verifyMessage, type Address, type Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';

export class AuthError extends Error {}

const MAX_AGE_MS = 10 * 60_000;

// EOA signatures only (offline ecrecover). Smart-contract wallets are out of scope for the hackathon.
export async function verifyLogin(message: string, signature: Hex, expected: { domain: string; now?: Date }): Promise<{ address: Address; nonce: string }> {
  const f = parseSiweMessage(message);
  if (!f.address || !f.nonce || !f.domain) throw new AuthError('malformed SIWE message');
  if (f.domain !== expected.domain) throw new AuthError('wrong domain');
  const now = expected.now ?? new Date();
  if (f.expirationTime && f.expirationTime.getTime() < now.getTime()) throw new AuthError('expired');
  if (!f.issuedAt || now.getTime() - f.issuedAt.getTime() > MAX_AGE_MS) throw new AuthError('stale message');
  let ok = false;
  try {
    ok = await verifyMessage({ address: f.address, message, signature });
  } catch {
    ok = false;
  }
  if (!ok) throw new AuthError('bad signature');
  return { address: getAddress(f.address), nonce: f.nonce };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Sessions + routes**

`web/lib/session.ts`:
```ts
import { getAddress, type Address } from 'viem';
import { sql } from './db';
import { AuthError } from './auth';

export async function createSession(address: Address): Promise<string> {
  const token = crypto.randomUUID();
  await sql`insert into sessions (token, address) values (${token}, ${address})`;
  return token;
}

export async function requireSession(req: Request): Promise<Address> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new AuthError('missing session');
  const rows = await sql`select address from sessions where token = ${token} and created_at > now() - interval '30 days'`;
  if (rows.length === 0) throw new AuthError('invalid session');
  return getAddress(rows[0].address as string);
}

export const unauthorized = (e: unknown) =>
  Response.json({ error: e instanceof AuthError ? e.message : 'unauthorized' }, { status: 401 });
```

`web/app/api/auth/nonce/route.ts`:
```ts
import { generateSiweNonce } from 'viem/siwe';
import { sql } from '@/lib/db';

export async function POST() {
  const nonce = generateSiweNonce();
  await sql`insert into nonces (nonce) values (${nonce})`;
  return Response.json({ nonce });
}
```

`web/app/api/auth/verify/route.ts`:
```ts
import type { Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { verifyLogin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { createSession, unauthorized } from '@/lib/session';

export async function POST(req: Request) {
  try {
    const { message, signature } = (await req.json()) as { message: string; signature: Hex };
    // Burn the nonce first: single use, valid for 10 minutes.
    const nonce = parseSiweMessage(message).nonce ?? '';
    const burned = await sql`delete from nonces where nonce = ${nonce} and created_at > now() - interval '10 minutes' returning nonce`;
    if (burned.length === 0) return Response.json({ error: 'unknown or used nonce' }, { status: 401 });
    const { address } = await verifyLogin(message, signature, { domain: process.env.SIWE_DOMAIN! });
    return Response.json({ token: await createSession(address), address });
  } catch (e) {
    return unauthorized(e);
  }
}
```

- [ ] **Step 6: Manual replay check**

Run `npm run dev -w web`. Then, in a scratch script using a viem test account, call `/api/auth/nonce`, sign a SIWE message for domain `localhost:3000`, and POST it to `/api/auth/verify` twice.
Expected: first `200 {token, address}`, second `401 unknown or used nonce`.

- [ ] **Step 7: Commit**

```bash
git add web/lib/auth.ts web/lib/session.ts web/app/api/auth web/test/auth.test.ts
git commit -m "feat(web): SIWE sign-in with single-use nonces and sessions"
```

---

### Task 6: Ownership, Chog info, Activity upload

**Files:**
- Create: `web/lib/owner.ts`, `web/lib/activity.ts`, `web/app/api/me/chogs/route.ts`, `web/app/api/chog/[id]/route.ts`, `web/app/api/activity/route.ts`
- Test: `web/test/owner.test.ts`, `web/test/activity.test.ts`

**Interfaces:**
- Consumes: `requireSession`, `unauthorized` (Task 5); `CHOG_CONTRACT`, `chogAbi`, `monad`, `fetchChogMetadata`, `pickArchetype`, `ARCHETYPES`, `ipfsToHttp`, `assertTokenId`, `parseDailyTotals` (core).
- Produces:
  - `ownerOf(tokenId: number): Promise<Address>`
  - `parseOwnedTokenIds(json: unknown): number[]`, `listOwnedChogs(owner: Address): Promise<number[]>`
  - `parseActivityBody(x: unknown, now?: Date): { tokenId: number; day: string; totals: DailyTotals }` (throws `TypeError`)
  - `GET /api/me/chogs` returns `{ tokenIds: number[] }`
  - `GET /api/chog/:id` returns `{ tokenId, name, image (https), attributes, archetype, archetypeName }`
  - `POST /api/activity` takes `{ tokenId, day: 'YYYY-MM-DD', totals }` and returns `{ ok: true }`, or 400/401/403

- [ ] **Step 1: Write failing tests**

`web/test/owner.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseOwnedTokenIds } from '@/lib/owner';

describe('parseOwnedTokenIds', () => {
  it('reads Alchemy v3 getNFTsForOwner shape', () => {
    expect(parseOwnedTokenIds({ ownedNfts: [{ tokenId: '5' }, { tokenId: '1462' }] })).toEqual([5, 1462]);
  });
  it('drops ids outside the collection', () => {
    expect(parseOwnedTokenIds({ ownedNfts: [{ tokenId: '0' }, { tokenId: '99999' }, { tokenId: '7' }] })).toEqual([7]);
  });
  it('handles empty / malformed', () => {
    expect(parseOwnedTokenIds({})).toEqual([]);
    expect(parseOwnedTokenIds(null)).toEqual([]);
  });
});
```

`web/test/activity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseActivityBody } from '@/lib/activity';

const now = new Date('2026-10-10T12:00:00Z');
const totals = { minutes: { coding: 30 }, lateMinutes: 0, earlyMinutes: 0 };

describe('parseActivityBody', () => {
  it('accepts today and yesterday', () => {
    expect(parseActivityBody({ tokenId: 5, day: '2026-10-10', totals }, now).day).toBe('2026-10-10');
    expect(parseActivityBody({ tokenId: 5, day: '2026-10-09', totals }, now).tokenId).toBe(5);
  });
  it.each([
    ['old day', { tokenId: 5, day: '2026-10-01', totals }],
    ['future day', { tokenId: 5, day: '2026-10-12', totals }],
    ['bad day format', { tokenId: 5, day: '10/10/2026', totals }],
    ['bad token', { tokenId: 0, day: '2026-10-10', totals }],
    ['string token', { tokenId: '5', day: '2026-10-10', totals }],
    ['bad totals', { tokenId: 5, day: '2026-10-10', totals: { minutes: { coding: -5 }, lateMinutes: 0, earlyMinutes: 0 } }],
  ])('rejects %s', (_n, body) => {
    expect(() => parseActivityBody(body, now)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w web`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement libs**

`web/lib/owner.ts`:
```ts
import { createPublicClient, getAddress, http, type Address } from 'viem';
import { CHOG_CONTRACT, CHOG_SUPPLY, chogAbi, monad } from '@chog/core';

const client = createPublicClient({ chain: monad, transport: http() });

export async function ownerOf(tokenId: number): Promise<Address> {
  return getAddress(await client.readContract({ address: CHOG_CONTRACT, abi: chogAbi, functionName: 'ownerOf', args: [BigInt(tokenId)] }));
}

export function parseOwnedTokenIds(json: unknown): number[] {
  const nfts = (json as { ownedNfts?: Array<{ tokenId?: string }> } | null)?.ownedNfts ?? [];
  return nfts.map((n) => Number(n.tokenId)).filter((id) => Number.isInteger(id) && id >= 1 && id <= CHOG_SUPPLY);
}

// The contract is not enumerable, so ask Alchemy's indexer (free tier) which Chogs a wallet holds.
export async function listOwnedChogs(owner: Address): Promise<number[]> {
  const ids: number[] = [];
  let pageKey: string | undefined;
  do {
    const url = new URL(`https://monad-mainnet.g.alchemy.com/nft/v3/${process.env.ALCHEMY_KEY}/getNFTsForOwner`);
    url.searchParams.set('owner', owner);
    url.searchParams.append('contractAddresses[]', CHOG_CONTRACT);
    url.searchParams.set('withMetadata', 'false');
    if (pageKey) url.searchParams.set('pageKey', pageKey);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alchemy ${res.status}`);
    const json = await res.json();
    ids.push(...parseOwnedTokenIds(json));
    pageKey = json.pageKey;
  } while (pageKey);
  return ids;
}
```

`web/lib/activity.ts`:
```ts
import { assertTokenId, parseDailyTotals, type DailyTotals } from '@chog/core';

const DAY_MS = 86_400_000;

// Owner-local day: accept anything within [now - 2 days, now + 1 day] to cover timezones.
export function parseActivityBody(x: unknown, now = new Date()): { tokenId: number; day: string; totals: DailyTotals } {
  const b = x as { tokenId?: unknown; day?: unknown; totals?: unknown } | null;
  if (typeof b?.tokenId !== 'number') throw new TypeError('tokenId must be a number');
  assertTokenId(b.tokenId);
  if (typeof b.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) throw new TypeError('day must be YYYY-MM-DD');
  const t = Date.parse(`${b.day}T12:00:00Z`);
  if (Number.isNaN(t) || t < now.getTime() - 2 * DAY_MS || t > now.getTime() + DAY_MS) throw new TypeError('day out of range');
  return { tokenId: b.tokenId, day: b.day, totals: parseDailyTotals(b.totals) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Routes**

`web/app/api/me/chogs/route.ts`:
```ts
import { listOwnedChogs } from '@/lib/owner';
import { requireSession, unauthorized } from '@/lib/session';

export async function GET(req: Request) {
  let address;
  try {
    address = await requireSession(req);
  } catch (e) {
    return unauthorized(e);
  }
  return Response.json({ tokenIds: await listOwnedChogs(address) });
}
```

`web/app/api/chog/[id]/route.ts`:
```ts
import { ARCHETYPES, fetchChogMetadata, ipfsToHttp, pickArchetype } from '@chog/core';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tokenId = Number((await params).id);
  try {
    const meta = await fetchChogMetadata(tokenId);
    const archetype = pickArchetype(meta);
    return Response.json(
      { ...meta, image: ipfsToHttp(meta.image), archetype, archetypeName: ARCHETYPES[archetype].name },
      { headers: { 'cache-control': 'public, s-maxage=86400' } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof RangeError ? 400 : 502 });
  }
}
```

`web/app/api/activity/route.ts`:
```ts
import { parseActivityBody } from '@/lib/activity';
import { sql } from '@/lib/db';
import { ownerOf } from '@/lib/owner';
import { requireSession, unauthorized } from '@/lib/session';

export async function POST(req: Request) {
  let address;
  try {
    address = await requireSession(req);
  } catch (e) {
    return unauthorized(e);
  }
  let body;
  try {
    body = parseActivityBody(await req.json());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  if ((await ownerOf(body.tokenId)) !== address) return Response.json({ error: 'not your Chog' }, { status: 403 });
  await sql`
    insert into activity (token_id, day, owner, totals) values (${body.tokenId}, ${body.day}, ${address}, ${JSON.stringify(body.totals)})
    on conflict (token_id, day) do update set owner = excluded.owner, totals = excluded.totals, updated_at = now()`;
  return Response.json({ ok: true });
}
```

- [ ] **Step 6: Manual check**

With `npm run dev -w web` running and a session token from Task 5:
- `curl localhost:3000/api/chog/5` returns JSON with `archetype` and an `https://` image.
- `curl localhost:3000/api/chog/0` returns 400.
- `curl -X POST localhost:3000/api/activity -H "authorization: Bearer $TOKEN" -d '{"tokenId":5,"day":"<today>","totals":{"minutes":{"coding":30},"lateMinutes":0,"earlyMinutes":0}}'` returns 403 (your test wallet doesn't own Chog #5).
- The same request with `"minutes":{"coding":-1}` returns 400.

- [ ] **Step 7: Commit**

```bash
git add web/lib/owner.ts web/lib/activity.ts web/app/api/me web/app/api/chog web/app/api/activity web/test
git commit -m "feat(web): Chog info, owned Chogs and ownership-checked Activity upload"
```

---

### Task 7: Daily Soul job (cron)

**Files:**
- Create: `web/lib/soul-abi.ts`, `web/lib/soul-job.ts`, `web/app/api/cron/soul/route.ts`, `web/vercel.json`, `.github/workflows/soul-cron.yml`
- Test: `web/test/soul-job.test.ts`

**Interfaces:**
- Consumes: `nextSoul`, `parseDailyTotals`, `ARCHETYPES`, `pickArchetype`, `fetchChogMetadata`, `monadTestnet`, `type Soul`, `type Axes` (core); `sql`; `SOUL_CONTRACT` (Task 2).
- Produces:
  - `type ActivityRow = { tokenId: number; day: string; owner: string; totals: unknown }`
  - `type StoredSoul = Soul & { lastOwner: string; lastDay: string }`
  - `computeSoulUpdates(rows: ActivityRow[], existing: Map<number, StoredSoul>, baseFor: (tokenId: number) => Promise<Axes>): Promise<Map<number, StoredSoul>>`
  - `runSoulJob(): Promise<{ updated: number; tx: string | null }>`
  - `GET /api/cron/soul` (Bearer `CRON_SECRET`)

- [ ] **Step 1: Write the failing test**

`web/test/soul-job.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { computeSoulUpdates, type ActivityRow, type StoredSoul } from '@/lib/soul-job';

const base = { nightOwl: 50, grinder: 50, social: 50, creator: 50 };
const t = (coding: number) => ({ minutes: { coding, chat: 60 }, lateMinutes: 0, earlyMinutes: 0 });
const row = (tokenId: number, day: string, owner = '0xA', coding = 480): ActivityRow => ({ tokenId, day, owner, totals: t(coding) });

describe('computeSoulUpdates', () => {
  it('creates a new soul from base for a first-time Chog', async () => {
    const baseFor = vi.fn().mockResolvedValue(base);
    const out = await computeSoulUpdates([row(5, '2026-10-09')], new Map(), baseFor);
    expect(out.get(5)).toMatchObject({ level: 1, ownerCount: 1, grinder: 53, lastOwner: '0xA', lastDay: '2026-10-09' });
    expect(baseFor).toHaveBeenCalledWith(5);
  });

  it('applies multiple missed days in order', async () => {
    const out = await computeSoulUpdates([row(5, '2026-10-09'), row(5, '2026-10-08')], new Map(), async () => base);
    expect(out.get(5)).toMatchObject({ level: 2, grinder: 56, lastDay: '2026-10-09' });
  });

  it('skips days already applied (cron ran twice)', async () => {
    const existing = new Map<number, StoredSoul>([[5, { ...base, level: 3, ownerCount: 1, lastOwner: '0xA', lastDay: '2026-10-09' }]]);
    const out = await computeSoulUpdates([row(5, '2026-10-09'), row(5, '2026-10-08')], existing, async () => base);
    expect(out.size).toBe(0);
  });

  it('counts a new owner', async () => {
    const existing = new Map<number, StoredSoul>([[5, { ...base, level: 3, ownerCount: 1, lastOwner: '0xA', lastDay: '2026-10-08' }]]);
    const out = await computeSoulUpdates([row(5, '2026-10-09', '0xB')], existing, async () => base);
    expect(out.get(5)).toMatchObject({ ownerCount: 2, lastOwner: '0xB', level: 4 });
  });

  it('skips rows with corrupt totals instead of failing the whole batch', async () => {
    const bad: ActivityRow = { tokenId: 9, day: '2026-10-09', owner: '0xA', totals: { minutes: { coding: -1 } } };
    const out = await computeSoulUpdates([bad, row(5, '2026-10-09')], new Map(), async () => base);
    expect([...out.keys()]).toEqual([5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL, cannot resolve `@/lib/soul-job`.

- [ ] **Step 3: Implement**

`web/lib/soul-abi.ts`:
```ts
import { parseAbi } from 'viem';

export const soulAbi = parseAbi([
  'struct Soul { uint8 nightOwl; uint8 grinder; uint8 social; uint8 creator; uint32 level; uint16 ownerCount; }',
  'function batchSet(uint256[] ids, Soul[] souls)',
  'function getSoul(uint256 id) view returns (Soul)',
]);
```

`web/lib/soul-job.ts`:
```ts
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARCHETYPES, fetchChogMetadata, monadTestnet, nextSoul, parseDailyTotals, pickArchetype, type Axes, type Soul } from '@chog/core';
import { sql } from './db';
import { soulAbi } from './soul-abi';

export type ActivityRow = { tokenId: number; day: string; owner: string; totals: unknown };
export type StoredSoul = Soul & { lastOwner: string; lastDay: string };

const BATCH = 100;

export async function computeSoulUpdates(
  rows: ActivityRow[],
  existing: Map<number, StoredSoul>,
  baseFor: (tokenId: number) => Promise<Axes>,
): Promise<Map<number, StoredSoul>> {
  const sorted = [...rows].sort((a, b) => a.tokenId - b.tokenId || a.day.localeCompare(b.day));
  const current = new Map(existing);
  const changed = new Map<number, StoredSoul>();
  for (const r of sorted) {
    const prev = current.get(r.tokenId) ?? null;
    if (prev && r.day <= prev.lastDay) continue; // already applied
    let totals;
    try {
      totals = parseDailyTotals(r.totals);
    } catch {
      continue; // corrupt row: skip, don't block everyone else
    }
    const base = prev ?? (await baseFor(r.tokenId));
    const soul = nextSoul(prev, base, totals, prev !== null && prev.lastOwner !== r.owner);
    const next = { ...soul, lastOwner: r.owner, lastDay: r.day };
    current.set(r.tokenId, next);
    changed.set(r.tokenId, next);
  }
  return changed;
}

async function baseFromChain(tokenId: number): Promise<Axes> {
  return ARCHETYPES[pickArchetype(await fetchChogMetadata(tokenId))].base;
}

export async function runSoulJob(): Promise<{ updated: number; tx: string | null }> {
  const rows = (await sql`
    select a.token_id, to_char(a.day, 'YYYY-MM-DD') as day, a.owner, a.totals
    from activity a left join souls s on s.token_id = a.token_id
    where a.day < current_date and (s.last_day is null or a.day > s.last_day)`) as Array<{ token_id: number; day: string; owner: string; totals: unknown }>;
  if (rows.length === 0) return { updated: 0, tx: null };

  const ids = [...new Set(rows.map((r) => r.token_id))];
  const soulRows = (await sql`select *, to_char(last_day, 'YYYY-MM-DD') as last_day_s from souls where token_id = any(${ids})`) as Array<Record<string, any>>;
  const existing = new Map<number, StoredSoul>(
    soulRows.map((s) => [
      s.token_id,
      { nightOwl: s.night_owl, grinder: s.grinder, social: s.social, creator: s.creator, level: s.level, ownerCount: s.owner_count, lastOwner: s.last_owner, lastDay: s.last_day_s },
    ]),
  );

  const changed = await computeSoulUpdates(
    rows.map((r) => ({ tokenId: r.token_id, day: r.day, owner: r.owner, totals: r.totals })),
    existing,
    baseFromChain,
  );
  if (changed.size === 0) return { updated: 0, tx: null };

  const account = privateKeyToAccount(process.env.SOUL_WRITER_KEY as Hex);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });
  const reader = createPublicClient({ chain: monadTestnet, transport: http() });
  const entries = [...changed.entries()];
  let lastTx: string | null = null;
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const hash = await wallet.writeContract({
      address: process.env.SOUL_CONTRACT as Hex,
      abi: soulAbi,
      functionName: 'batchSet',
      args: [
        chunk.map(([id]) => BigInt(id)),
        chunk.map(([, s]) => ({ nightOwl: s.nightOwl, grinder: s.grinder, social: s.social, creator: s.creator, level: s.level, ownerCount: s.ownerCount })),
      ],
    });
    await reader.waitForTransactionReceipt({ hash });
    lastTx = hash;
  }

  // Only mirror to the DB after the chain write succeeded, so a failed tx is retried next run.
  for (const [id, s] of entries) {
    await sql`
      insert into souls (token_id, night_owl, grinder, social, creator, level, owner_count, last_owner, last_day)
      values (${id}, ${s.nightOwl}, ${s.grinder}, ${s.social}, ${s.creator}, ${s.level}, ${s.ownerCount}, ${s.lastOwner}, ${s.lastDay})
      on conflict (token_id) do update set night_owl = excluded.night_owl, grinder = excluded.grinder, social = excluded.social,
        creator = excluded.creator, level = excluded.level, owner_count = excluded.owner_count,
        last_owner = excluded.last_owner, last_day = excluded.last_day`;
  }
  return { updated: entries.length, tx: lastTx };
}
```

`web/app/api/cron/soul/route.ts`:
```ts
import { runSoulJob } from '@/lib/soul-job';

export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('unauthorized', { status: 401 });
  return Response.json(await runSoulJob());
}
```

`web/vercel.json`:
```json
{
  "crons": [{ "path": "/api/cron/soul", "schedule": "10 0 * * *" }]
}
```

`.github/workflows/soul-cron.yml`:
```yaml
name: soul-cron-backup
on:
  schedule:
    - cron: '40 0 * * *'
  workflow_dispatch:
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - run: curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ secrets.WEB_URL }}/api/cron/soul"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Deploy and run end to end**

1. `cd web && npx vercel link`, then add the env vars from `.env.example` with `npx vercel env add <NAME>` (`SOUL_WRITER_KEY` is the testnet writer key from Task 2; `CRON_SECRET` is a random string).
2. `npx vercel deploy --prod`.
3. In the Neon SQL editor, insert a fake past Activity row:
   ```sql
   insert into activity (token_id, day, owner, totals) values (5, current_date - 1, '0x0000000000000000000000000000000000000001', '{"minutes":{"coding":480,"chat":60},"lateMinutes":0,"earlyMinutes":0}');
   ```
4. Run `curl -H "Authorization: Bearer $CRON_SECRET" https://<deployment>/api/cron/soul`.
   Expected: `{"updated":1,"tx":"0x..."}`.
5. Run `cast call $SOUL_CONTRACT "getSoul(uint256)((uint8,uint8,uint8,uint8,uint32,uint16))" 5 --rpc-url https://testnet-rpc.monad.xyz`.
   Expected: level 1, ownerCount 1, grinder = base + 3.
6. Run the curl again. Expected: `{"updated":0,"tx":null}` (idempotent).
7. Add GitHub secrets `CRON_SECRET` and `WEB_URL`, then trigger `soul-cron-backup` from the Actions tab. Expected: green.
8. Delete the fake row: `delete from activity where owner = '0x0000000000000000000000000000000000000001';`

- [ ] **Step 6: Commit**

```bash
git add web/lib/soul-abi.ts web/lib/soul-job.ts web/app/api/cron web/vercel.json web/test/soul-job.test.ts .github/workflows/soul-cron.yml
git commit -m "feat(web): daily Soul Drift job writes batched Souls onchain"
```

---

### Task 8: Diary endpoint (Gemini + template fallback)

**Files:**
- Create: `web/lib/diary.ts`, `web/app/api/diary/route.ts`
- Test: `web/test/diary.test.ts`

**Interfaces:**
- Consumes: `requireSession`, `unauthorized`, `ownerOf`, `parseDailyTotals`, `fetchChogMetadata`, `pickArchetype`, `ARCHETYPES`, `type ArchetypeId`, `type DailyTotals`.
- Produces:
  - `buildDiaryPrompt(archetype: ArchetypeId, chogName: string, t: DailyTotals): string`
  - `templateDiary(archetype: ArchetypeId, t: DailyTotals): string`
  - `generateDiary(archetype, chogName, t, fetchImpl?: typeof fetch): Promise<{ text: string; source: 'gemini' | 'template' }>`
  - `POST /api/diary` takes `{ tokenId, totals }` and returns `{ text, source }`. Nothing is stored (ADR 0001).

- [ ] **Step 1: Write the failing test**

`web/test/diary.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { buildDiaryPrompt, generateDiary, templateDiary } from '@/lib/diary';
import type { DailyTotals } from '@chog/core';

const t: DailyTotals = {
  minutes: { coding: 245.4, design: 0, chat: 30, browsing: 60, video: 90, meeting: 0, idle: 20, other: 5 },
  lateMinutes: 40,
  earlyMinutes: 0,
};

describe('buildDiaryPrompt', () => {
  it('includes the voice and rounded category minutes only', () => {
    const p = buildDiaryPrompt('grump', 'CHOG #5', t);
    expect(p).toContain('Grump Chog');
    expect(p).toContain('coding: 245 min');
    expect(p).toContain('late night: 40 min');
    expect(p).not.toContain('design: 0'); // zero categories omitted
  });
});

describe('templateDiary', () => {
  it('names the top category and is non-empty for every archetype', () => {
    for (const a of ['hype', 'grump', 'lazySage', 'chaos', 'sweetheart'] as const) {
      const d = templateDiary(a, t);
      expect(d).toContain('coding');
      expect(d.length).toBeGreaterThan(20);
    }
  });
  it('handles an empty day', () => {
    const empty = { ...t, minutes: Object.fromEntries(Object.keys(t.minutes).map((k) => [k, 0])) as DailyTotals['minutes'], lateMinutes: 0 };
    expect(templateDiary('hype', empty)).toMatch(/quiet/i);
  });
});

describe('generateDiary', () => {
  it('uses Gemini text when available', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Dear diary...' }] } }] }), { status: 200 }),
    );
    process.env.GEMINI_API_KEY = 'k';
    expect(await generateDiary('hype', 'CHOG #5', t, fetchImpl)).toEqual({ text: 'Dear diary...', source: 'gemini' });
  });
  it('falls back to template on quota error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('quota', { status: 429 }));
    const r = await generateDiary('hype', 'CHOG #5', t, fetchImpl);
    expect(r.source).toBe('template');
  });
  it('falls back to template on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect((await generateDiary('hype', 'CHOG #5', t, fetchImpl)).source).toBe('template');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL, cannot resolve `@/lib/diary`.

- [ ] **Step 3: Implement**

`web/lib/diary.ts`:
```ts
import { ARCHETYPES, type ArchetypeId, type Category, type DailyTotals } from '@chog/core';

const VOICE: Record<ArchetypeId, string> = {
  hype: 'over-the-top hype friend, all caps energy, supportive',
  grump: 'grumpy, sarcastic, secretly caring',
  lazySage: 'sleepy zen philosopher, short wise sentences',
  chaos: 'chaotic gremlin, absurd jokes, playful',
  sweetheart: 'warm, gentle, encouraging',
};

const ACTIVE: Category[] = ['coding', 'design', 'chat', 'browsing', 'video', 'meeting', 'other'];

function topCategory(t: DailyTotals): Category | null {
  const [cat, min] = ACTIVE.map((c) => [c, t.minutes[c]] as const).sort((a, b) => b[1] - a[1])[0];
  return min >= 1 ? cat : null;
}

export function buildDiaryPrompt(archetype: ArchetypeId, chogName: string, t: DailyTotals): string {
  const lines = (Object.entries(t.minutes) as Array<[Category, number]>)
    .filter(([, m]) => Math.round(m) > 0)
    .map(([c, m]) => `${c}: ${Math.round(m)} min`);
  if (t.lateMinutes >= 1) lines.push(`late night: ${Math.round(t.lateMinutes)} min`);
  if (t.earlyMinutes >= 1) lines.push(`early morning: ${Math.round(t.earlyMinutes)} min`);
  return [
    `You are ${chogName}, a ${ARCHETYPES[archetype].name}: ${VOICE[archetype]}.`,
    `You live on your owner's computer. Write today's diary entry about your owner's day in first person, max 80 words.`,
    `You only know these time totals, nothing else. Do not invent apps, people or events.`,
    lines.join('\n') || 'no activity recorded',
  ].join('\n\n');
}

export function templateDiary(archetype: ArchetypeId, t: DailyTotals): string {
  const top = topCategory(t);
  if (!top) return 'Quiet day. My human barely touched the computer. I napped on the taskbar.';
  const mins = Math.round(t.minutes[top]);
  const by: Record<ArchetypeId, string> = {
    hype: `TODAY WAS HUGE. ${mins} minutes of ${top}! My human is unstoppable.`,
    grump: `${mins} minutes of ${top}. Riveting. I watched the whole thing. Again.`,
    lazySage: `Today the river flowed toward ${top}. ${mins} minutes. I mostly slept.`,
    chaos: `${mins} MINUTES OF ${top.toUpperCase()}. I pressed zero buttons. Probably.`,
    sweetheart: `We spent ${mins} minutes on ${top} today. I'm so proud of my human.`,
  };
  return by[archetype];
}

export async function generateDiary(
  archetype: ArchetypeId,
  chogName: string,
  t: DailyTotals,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; source: 'gemini' | 'template' }> {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  if (key) {
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: buildDiaryPrompt(archetype, chogName, t) }] }] }),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.trim()) return { text: text.trim(), source: 'gemini' };
      }
    } catch {
      // fall through to template
    }
  }
  return { text: templateDiary(archetype, t), source: 'template' };
}
```

`web/app/api/diary/route.ts`:
```ts
import { fetchChogMetadata, parseDailyTotals, pickArchetype } from '@chog/core';
import { generateDiary } from '@/lib/diary';
import { ownerOf } from '@/lib/owner';
import { requireSession, unauthorized } from '@/lib/session';

// ponytail: no per-user rate limit; add one if the Gemini free quota runs out during judging.
export async function POST(req: Request) {
  let address;
  try {
    address = await requireSession(req);
  } catch (e) {
    return unauthorized(e);
  }
  let tokenId: number, totals;
  try {
    const b = await req.json();
    tokenId = b.tokenId;
    totals = parseDailyTotals(b.totals);
    if (!Number.isInteger(tokenId)) throw new TypeError('tokenId');
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  if ((await ownerOf(tokenId)) !== address) return Response.json({ error: 'not your Chog' }, { status: 403 });
  const meta = await fetchChogMetadata(tokenId);
  // Text is returned, never stored (ADR 0001).
  return Response.json(await generateDiary(pickArchetype(meta), meta.name, totals));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Live check**

Create a free key at https://aistudio.google.com/apikey and run `npx vercel env add GEMINI_API_KEY`, then redeploy. Calling the endpoint with a session for a wallet that owns a Chog returns `source: "gemini"`. Temporarily set a wrong key and redeploy. Expected: `source: "template"` and still HTTP 200.

- [ ] **Step 6: Commit**

```bash
git add web/lib/diary.ts web/app/api/diary web/test/diary.test.ts
git commit -m "feat(web): Diary generation with Gemini and template fallback"
```

---

## Not in this plan

- Integration plan (days 6-8): the app-side SIWE page and loopback, Chog picker, Activity upload, Diary display, Judge Mode, GitHub + Calendar.
- Later-phase plan (days 9-11): `FocusPool`, mock $CHOG, settlement oracle, Chog Park page.

Write each when its prerequisites are merged.
