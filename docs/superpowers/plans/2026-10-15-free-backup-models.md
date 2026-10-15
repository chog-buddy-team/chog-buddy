# Free Backup Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Gemini is over its cap or failing, `/api/chat` and `/api/diary` try free backup models (Groq, then OpenRouter free) before falling back to canned lines, so users never have to set up a model.

**Architecture:** A new `web/lib/llm.ts` owns one provider chain, `generateText()`: Gemini first, then Groq (OpenAI-compatible API), then OpenRouter. Each provider is enabled only when its env key is set, and returns `null` on any failure. `generateChat` and `generateDiary` call the chain and keep their in-character fallbacks. The chat route lets backups run after the shared *global* Gemini cap is hit, but never past the *per-caller* cap.

**Tech Stack:** Next.js route handlers, TypeScript, vitest, global `fetch`. No new dependencies.

**Spec:** User request 2026-10-15 ("build the free backup models on the server"); current behaviour in `web/lib/chat.ts`, `web/lib/diary.ts`, `web/app/api/chat/route.ts`, `web/app/api/diary/route.ts`.

## Global Constraints
- $0: free tiers only. Keys come from env vars, never committed, never logged, never returned to clients.
- No new npm dependencies.
- Chat and diary text are never stored (ADR 0001). Usage tables keep counts only.
- Every provider call has a timeout (default 10 s) and never throws out of `generateText`.
- Env names: `GROQ_API_KEY`, `GROQ_MODEL` (default `llama-3.1-8b-instant`), `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `meta-llama/llama-3.3-70b-instruct:free`). Existing `GEMINI_API_KEY`, `GEMINI_MODEL` are unchanged.
- Response `source` values: `'gemini' | 'groq' | 'openrouter' | 'fallback'` for chat; `'gemini' | 'groq' | 'openrouter' | 'template'` for diary.

## Review Focus
- Gemini returns 429/500 while the cap is fine → the next provider answers; the user never sees the canned line if any backup works.
- A provider returns 200 with an empty or odd body (`choices: []`, missing content) → treated as failure, the chain continues.
- Global Gemini cap hit, but the caller is under the per-caller cap → backups still answer (Task 2 route test).
- No backup keys set (today's production) → behaviour identical to before (Task 1 test).
- A provider hangs → aborted at the timeout, chain continues (Task 1 test with an abort).

---

### Task 1: Provider chain `generateText`, used by chat and diary

**Files:**
- Create: `web/lib/llm.ts`
- Modify: `web/lib/chat.ts` (`generateChat`), `web/lib/diary.ts` (`generateDiary`), `web/.env.example`
- Test: `web/test/llm.test.ts`; update `web/test/chat.test.ts` and `web/test/diary.test.ts` only where a `source` assertion changes

**Interfaces:**
- Produces:
  - `type LlmTurn = { role: 'user' | 'model'; text: string }`
  - `type LlmSource = 'gemini' | 'groq' | 'openrouter'`
  - `generateText(req: { system?: string; turns: LlmTurn[]; maxTokens: number }, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; allowGemini?: boolean; allowBackup?: boolean; env?: Record<string, string | undefined> }): Promise<{ text: string; source: LlmSource } | null>`
  - `generateChat(archetype, chogName, messages, fetchImpl = fetch, timeoutMs = 10_000, allowGemini = true, allowBackup = allowGemini)`, which returns `{ text, source: LlmSource | 'fallback' }`
  - `generateDiary(archetype, chogName, t, fetchImpl = fetch, timeoutMs = 10_000, allowGemini = true)`, which returns `{ text, source: LlmSource | 'template' }`. Backups follow the same flag as Gemini, because the diary cap is per wallet.

- [ ] **Step 1: Write the failing tests** in `web/test/llm.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { generateText } from '@/lib/llm';

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const gem = (t: string) => ok({ candidates: [{ content: { parts: [{ text: t }] } }] });
const oai = (t: string) => ok({ choices: [{ message: { content: t } }] });
const env = { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', OPENROUTER_API_KEY: 'o' };
const req = { system: 'be a chog', turns: [{ role: 'user' as const, text: 'hi' }], maxTokens: 50 };

describe('generateText', () => {
  it('uses Gemini first', async () => {
    const f = vi.fn().mockResolvedValue(gem(' yo '));
    expect(await generateText(req, { fetchImpl: f, env })).toEqual({ text: 'yo', source: 'gemini' });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('falls through Gemini error to Groq with an OpenAI-style body', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 429 })).mockResolvedValueOnce(oai('hey'));
    expect(await generateText(req, { fetchImpl: f, env })).toEqual({ text: 'hey', source: 'groq' });
    const [url, init] = f.mock.calls[1];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer q');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('llama-3.1-8b-instant');
    expect(body.messages).toEqual([{ role: 'system', content: 'be a chog' }, { role: 'user', content: 'hi' }]);
    expect(body.max_tokens).toBe(50);
  });
  it('maps model turns to assistant for OpenAI-style providers', async () => {
    const f = vi.fn().mockResolvedValue(oai('ok'));
    await generateText({ turns: [{ role: 'user', text: 'a' }, { role: 'model', text: 'b' }, { role: 'user', text: 'c' }], maxTokens: 9 }, { fetchImpl: f, env: { GROQ_API_KEY: 'q' } });
    expect(JSON.parse(f.mock.calls[0][1].body).messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
  it('treats empty choices as failure and reaches OpenRouter', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 500 })).mockResolvedValueOnce(ok({ choices: [] })).mockResolvedValueOnce(oai('or'));
    expect(await generateText(req, { fetchImpl: f, env })).toEqual({ text: 'or', source: 'openrouter' });
    expect(f.mock.calls[2][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
  it('skips Gemini when not allowed, and backups when not allowed', async () => {
    const f = vi.fn().mockResolvedValue(oai('b'));
    expect((await generateText(req, { fetchImpl: f, env, allowGemini: false }))?.source).toBe('groq');
    expect(await generateText(req, { fetchImpl: f, env, allowGemini: false, allowBackup: false })).toBeNull();
  });
  it('returns null with no keys (unchanged production behaviour without backups)', async () => {
    const f = vi.fn();
    expect(await generateText(req, { fetchImpl: f, env: {} })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('a rejected or aborted fetch moves on instead of throwing', async () => {
    const f = vi.fn().mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError')).mockResolvedValueOnce(oai('saved'));
    expect(await generateText(req, { fetchImpl: f, env })).toEqual({ text: 'saved', source: 'groq' });
  });
});
```

- [ ] **Step 2: Run and confirm failure.** Run `npm test -w web`. Expected: FAIL, module `@/lib/llm` not found.

- [ ] **Step 3: Implement `web/lib/llm.ts`**

```ts
export type LlmTurn = { role: 'user' | 'model'; text: string };
export type LlmSource = 'gemini' | 'groq' | 'openrouter';
type Req = { system?: string; turns: LlmTurn[]; maxTokens: number };
type Opts = { fetchImpl?: typeof fetch; timeoutMs?: number; allowGemini?: boolean; allowBackup?: boolean; env?: Record<string, string | undefined> };

const clean = (t: unknown) => (typeof t === 'string' && t.trim() ? t.trim() : null);

async function gemini(r: Req, key: string, model: string, f: typeof fetch, ms: number): Promise<string | null> {
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      ...(r.system ? { systemInstruction: { parts: [{ text: r.system }] } } : {}),
      contents: r.turns.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { maxOutputTokens: r.maxTokens },
    }),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) return null;
  return clean((await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function openaiCompatible(url: string, r: Req, key: string, model: string, f: typeof fetch, ms: number): Promise<string | null> {
  const messages = [
    ...(r.system ? [{ role: 'system', content: r.system }] : []),
    ...r.turns.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
  ];
  const res = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, max_tokens: r.maxTokens }),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) return null;
  return clean((await res.json())?.choices?.[0]?.message?.content);
}

// Gemini first, then free backups. Each step is skipped when its key is unset; any failure moves on. Never throws.
export async function generateText(r: Req, o: Opts = {}): Promise<{ text: string; source: LlmSource } | null> {
  const env = o.env ?? process.env;
  const f = o.fetchImpl ?? fetch;
  const ms = o.timeoutMs ?? 10_000;
  const allowGemini = o.allowGemini ?? true;
  const allowBackup = o.allowBackup ?? true;
  const steps: Array<[LlmSource, string | undefined, boolean, () => Promise<string | null>]> = [
    ['gemini', env.GEMINI_API_KEY, allowGemini, () => gemini(r, env.GEMINI_API_KEY!, env.GEMINI_MODEL || 'gemini-flash-lite-latest', f, ms)],
    ['groq', env.GROQ_API_KEY, allowBackup, () => openaiCompatible('https://api.groq.com/openai/v1/chat/completions', r, env.GROQ_API_KEY!, env.GROQ_MODEL || 'llama-3.1-8b-instant', f, ms)],
    ['openrouter', env.OPENROUTER_API_KEY, allowBackup, () => openaiCompatible('https://openrouter.ai/api/v1/chat/completions', r, env.OPENROUTER_API_KEY!, env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', f, ms)],
  ];
  for (const [source, key, allowed, call] of steps) {
    if (!key || !allowed) continue;
    try {
      const text = await call();
      if (text) return { text, source };
    } catch {
      // next provider
    }
  }
  return null;
}
```

- [ ] **Step 4: Rewire `generateChat` and `generateDiary`.** Keep their exported names, prompts and fallbacks. Replace each inline Gemini fetch with:

```ts
// chat.ts
const r = await generateText(
  { system: buildChatSystemPrompt(archetype, chogName), turns: messages, maxTokens: 100 },
  { fetchImpl, timeoutMs, allowGemini, allowBackup },
);
return r ?? { text: fallbackReply(archetype), source: 'fallback' };
```

```ts
// diary.ts
const r = await generateText(
  { turns: [{ role: 'user', text: buildDiaryPrompt(archetype, chogName, t) }], maxTokens: 300 },
  { fetchImpl, timeoutMs, allowGemini, allowBackup: allowGemini },
);
return r ?? { text: templateDiary(archetype, t), source: 'template' };
```

Add the `allowBackup = allowGemini` parameter after `allowGemini` in `generateChat`. Update both return types to `LlmSource | 'fallback'` and `LlmSource | 'template'`. Existing chat and diary tests that stub `process.env.GEMINI_API_KEY` must keep passing. If one asserts a fetch call count with backup keys present in the env, isolate it by deleting `GROQ_API_KEY`/`OPENROUTER_API_KEY` from the env in that test.

- [ ] **Step 5: Document the env.** Append to `web/.env.example`:

```
# Free backup models, tried after Gemini (each optional). Groq: console.groq.com/keys. OpenRouter: openrouter.ai/keys (":free" models).
GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant
OPENROUTER_API_KEY=
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
```

- [ ] **Step 6: Run** `npm test -w web && cd web && npx tsc --noEmit` (run `npx next typegen` first if `LayoutProps` is missing). Expected: PASS.

- [ ] **Step 7: Commit.** `git add web/lib/llm.ts web/lib/chat.ts web/lib/diary.ts web/.env.example web/test/llm.test.ts web/test/chat.test.ts web/test/diary.test.ts && git commit -m "feat(web): free backup models (Groq, OpenRouter) behind Gemini"`

---

### Task 2: Chat route lets backups run after the global Gemini cap

**Files:**
- Modify: `web/app/api/chat/route.ts`, `web/lib/caps.ts` (comment only)
- Test: `web/test/chat-route.test.ts` (new)

**Interfaces:**
- Consumes: `generateChat(..., allowGemini, allowBackup)` from Task 1, plus `chatCaps`, `bumpChatUsage` and `callerKey` from `@/lib/caps`.
- Produces: the route semantics:
  - `allowGemini = mine <= perCaller && everyone <= global`
  - `allowBackup = mine <= perCaller`

- [ ] **Step 1: Write the failing test.** It mocks the modules and calls `POST` directly:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateChat = vi.fn().mockResolvedValue({ text: 'hi', source: 'groq' });
let usage: Record<string, number> = {};
vi.mock('@/lib/chat', async (orig) => ({ ...(await orig<typeof import('@/lib/chat')>()), generateChat }));
vi.mock('@/lib/caps', () => ({
  chatCaps: () => ({ perCaller: 2, global: 3 }),
  callerKey: () => 'ip:x',
  bumpChatUsage: async (k: string) => (usage[k] = (usage[k] ?? 0) + 1),
}));
vi.mock('@chog/core', async (orig) => ({ ...(await orig<typeof import('@chog/core')>()), fetchChogMetadata: async () => ({ tokenId: 5, name: 'CHOG #5', image: '', attributes: [] }) }));

const call = async () => {
  const { POST } = await import('@/app/api/chat/route');
  return POST(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify({ tokenId: 5, messages: [{ role: 'user', text: 'hi' }] }) }));
};

describe('chat route caps', () => {
  beforeEach(() => { usage = {}; generateChat.mockClear(); });
  it('global cap hit but caller under cap: Gemini off, backups on', async () => {
    usage.global = 3; // next bump makes 4 > 3
    await call();
    expect(generateChat.mock.calls[0].slice(5, 7)).toEqual([false, true]);
  });
  it('caller over cap: everything off', async () => {
    usage['ip:x'] = 2;
    await call();
    expect(generateChat.mock.calls[0].slice(5, 7)).toEqual([false, false]);
  });
});
```

- [ ] **Step 2: Run and confirm failure.** Run `npm test -w web`. Expected: FAIL. The current route passes only 6 arguments, so index 6 is `undefined`.

- [ ] **Step 3: Implement.** In the route, replace the final call:

```ts
const underCaller = mine <= caps.perCaller;
return Response.json(
  await generateChat(pickArchetype(meta), meta.name, body.messages, fetch, undefined, underCaller && everyone <= caps.global, underCaller),
);
```

Update the comment above `chatCaps` in `caps.ts`: "the global cap protects only the Gemini quota; free backups keep answering until the per-caller cap".

- [ ] **Step 4: Run** `npm test -w web && cd web && npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add web/app/api/chat/route.ts web/lib/caps.ts web/test/chat-route.test.ts && git commit -m "feat(web): backups keep chat alive past the global Gemini cap"`

---

## Deploy note (for the human, not a task)
Create free keys at console.groq.com and openrouter.ai, then add `GROQ_API_KEY` and `OPENROUTER_API_KEY` to Vercel env (Production) and redeploy. Without the keys, nothing changes.
