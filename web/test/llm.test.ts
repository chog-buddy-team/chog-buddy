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
