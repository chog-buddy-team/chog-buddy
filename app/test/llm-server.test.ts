import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerChat, resetServerBreaker } from '../src/main/llm/server';
import { apiUrl, DEFAULT_API_URL } from '../src/main/config';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
afterEach(() => resetServerBreaker());

describe('server chat', () => {
  it('posts tokenId + user/model messages and returns the reply', async () => {
    const f = vi.fn().mockResolvedValue(json({ text: 'Yo!', source: 'gemini' }));
    const toks: string[] = [];
    const p = createServerChat({ apiUrl: 'https://api.test/', tokenId: 5, fetchImpl: f });
    const out = await p.stream('IGNORED', [{ role: 'user', content: ' hi ' }, { role: 'assistant', content: 'hey' }, { role: 'user', content: 'sup' }], (t) => toks.push(t));
    expect(out).toBe('Yo!');
    expect(toks).toEqual(['Yo!']);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.test/api/chat');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ tokenId: 5, messages: [{ role: 'user', text: 'hi' }, { role: 'model', text: 'hey' }, { role: 'user', text: 'sup' }] });
    expect(JSON.stringify(body)).not.toContain('IGNORED');
    expect(init.headers.authorization).toBeUndefined();
  });
  it('keeps the last 20 messages, caps text at 500 and drops empty ones', async () => {
    const f = vi.fn().mockResolvedValue(json({ text: 'ok', source: 'gemini' }));
    const history = Array.from({ length: 24 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: i === 22 ? '   ' : 'x'.repeat(600) }));
    history.push({ role: 'user', content: 'last' });
    await createServerChat({ apiUrl: 'https://api.test', tokenId: 5, fetchImpl: f }).stream('', history, () => {});
    const msgs = JSON.parse(f.mock.calls[0][1].body).messages;
    expect(msgs.length).toBeLessThanOrEqual(20);
    expect(msgs.at(-1)).toEqual({ role: 'user', text: 'last' });
    expect(msgs.every((m: { text: string }) => m.text.length >= 1 && m.text.length <= 500)).toBe(true);
  });
  it('never opens with a model turn when a full session history is trimmed to 20', async () => {
    const f = vi.fn().mockResolvedValue(json({ text: 'ok', source: 'gemini' }));
    // ChatSession sends a full 20-message history plus the new user turn: 21 messages, user first.
    const history = Array.from({ length: 21 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }));
    await createServerChat({ apiUrl: 'https://api.test', tokenId: 5, fetchImpl: f }).stream('', history, () => {});
    const msgs = JSON.parse(f.mock.calls[0][1].body).messages;
    expect(msgs[0].role).toBe('user');
    expect(msgs.length).toBeLessThanOrEqual(20);
    expect(msgs.at(-1)).toEqual({ role: 'user', text: 'm20' });
  });
  it('sends the session token when signed in', async () => {
    const f = vi.fn().mockResolvedValue(json({ text: 'ok', source: 'gemini' }));
    await createServerChat({ apiUrl: 'https://api.test', tokenId: 5, token: 'T', fetchImpl: f }).stream('', [{ role: 'user', content: 'a' }], () => {});
    expect(f.mock.calls[0][1].headers.authorization).toBe('Bearer T');
  });
  it.each([[429, 'quota'], [400, 'bad-response'], [502, 'network'], [500, 'network']])('HTTP %i -> %s', async (status, kind) => {
    const p = createServerChat({ apiUrl: 'https://api.test', tokenId: 5, fetchImpl: vi.fn().mockResolvedValue(json({ error: 'x' }, status)) });
    await expect(p.stream('', [{ role: 'user', content: 'a' }], () => {})).rejects.toMatchObject({ kind });
  });
  it('a 200 without text is a bad-response', async () => {
    const p = createServerChat({ apiUrl: 'https://api.test', tokenId: 5, fetchImpl: vi.fn().mockResolvedValue(json({ nope: 1 })) });
    await expect(p.stream('', [{ role: 'user', content: 'a' }], () => {})).rejects.toMatchObject({ kind: 'bad-response' });
  });
  it('network failure trips a 60s breaker so auto mode falls through to Ollama/Gemini', async () => {
    let t = 1_000;
    const p = createServerChat({ apiUrl: 'https://api.test', tokenId: 5, now: () => t, fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
    expect(await p.available()).toBe(true);
    await expect(p.stream('', [{ role: 'user', content: 'a' }], () => {})).rejects.toMatchObject({ kind: 'network' });
    expect(await p.available()).toBe(false);
    t += 61_000;
    expect(await p.available()).toBe(true);
  });
  it('apiUrl defaults to the production API', () => {
    expect(DEFAULT_API_URL).toBe('https://chog-buddy-api.vercel.app');
    expect(apiUrl()).toBe(process.env.CHOG_API_URL ?? DEFAULT_API_URL);
  });
});
