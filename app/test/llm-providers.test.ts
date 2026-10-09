import { describe, expect, it, vi } from 'vitest';
import { createGemini } from '../src/main/llm/gemini';
import { createOllama } from '../src/main/llm/ollama';
import { readLines } from '../src/main/llm/stream';
import { ProviderError } from '../src/main/llm/types';

const enc = new TextEncoder();
function body(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
}
const ok = (b: ReadableStream<Uint8Array> | string, status = 200) => new Response(b, { status });

describe('readLines', () => {
  it('joins lines split across chunks and flushes the last line', async () => {
    const lines: string[] = [];
    await readLines(body('ab', 'c\nde', 'f\n', 'tail'), (l) => lines.push(l));
    expect(lines).toEqual(['abc', 'def', 'tail']);
  });
});

describe('ollama', () => {
  it('available() is false when the server is unreachable', async () => {
    const o = createOllama({ model: 'llama3.2', fetchImpl: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    expect(await o.available()).toBe(false);
  });
  it('listModels reads /api/tags', async () => {
    const f = vi.fn().mockResolvedValue(ok(JSON.stringify({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen3:4b' }] })));
    expect(await createOllama({ model: 'x', fetchImpl: f }).listModels()).toEqual(['llama3.2:latest', 'qwen3:4b']);
    expect(f.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/tags');
  });
  it('streams NDJSON tokens, including a line split across chunks', async () => {
    const f = vi.fn().mockResolvedValue(ok(body('{"message":{"content":"Hel"},"done":false}\n{"message":{"con', 'tent":"lo"},"done":false}\n{"done":true}\n')));
    const toks: string[] = [];
    const out = await createOllama({ model: 'llama3.2', fetchImpl: f }).stream('SYS', [{ role: 'user', content: 'hi' }], (t) => toks.push(t));
    expect(toks).toEqual(['Hel', 'lo']);
    expect(out).toBe('Hello');
    const sent = JSON.parse(f.mock.calls[0][1].body);
    expect(sent).toMatchObject({ model: 'llama3.2', stream: true });
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'SYS' });
  });
  it('maps a refused connection to a network ProviderError', async () => {
    const o = createOllama({ model: 'x', fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
    await expect(o.stream('s', [], () => {})).rejects.toMatchObject({ kind: 'network' });
  });
  it('throws on mid-stream error object', async () => {
    const f = vi.fn().mockResolvedValue(ok(body('{"message":{"content":"start"}}\n{"error":"model not found"}\n')));
    const o = createOllama({ model: 'x', fetchImpl: f });
    await expect(o.stream('s', [], () => {})).rejects.toMatchObject({ kind: 'bad-response', message: /error/ });
  });
  it('throws on empty reply', async () => {
    const f = vi.fn().mockResolvedValue(ok(body('{"done":true}\n')));
    const o = createOllama({ model: 'x', fetchImpl: f });
    await expect(o.stream('s', [], () => {})).rejects.toMatchObject({ kind: 'bad-response', message: /empty/ });
  });
  it('throws on body stream error', async () => {
    const f = vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(c){ c.enqueue(enc.encode('{"message":{"content":"a"}}\n')); c.error(new Error('reset')); } }), { status: 200 }));
    const o = createOllama({ model: 'x', fetchImpl: f });
    await expect(o.stream('s', [], () => {})).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('gemini', () => {
  it('is unavailable without a key and never calls fetch', async () => {
    const f = vi.fn();
    const g = createGemini({ apiKey: null, fetchImpl: f });
    expect(await g.available()).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('streams SSE text parts, maps assistant->model, keeps key out of the URL', async () => {
    const f = vi.fn().mockResolvedValue(ok(body(
      'data: {"candidates":[{"content":{"parts":[{"text":"Yo "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"chief"}]}}]}\n\n',
    )));
    const toks: string[] = [];
    const out = await createGemini({ apiKey: 'SECRET_KEY_123', fetchImpl: f }).stream('SYS', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], (t) => toks.push(t));
    expect(out).toBe('Yo chief');
    expect(toks).toEqual(['Yo ', 'chief']);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(String(url)).not.toContain('SECRET_KEY_123');
    expect(init.headers['x-goog-api-key']).toBe('SECRET_KEY_123');
    const sent = JSON.parse(init.body);
    expect(sent.systemInstruction.parts[0].text).toBe('SYS');
    expect(sent.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
  });
  it.each([[400, 'auth'], [401, 'auth'], [403, 'auth'], [429, 'quota'], [500, 'bad-response']])('HTTP %i -> %s', async (status, kind) => {
    const g = createGemini({ apiKey: 'SECRET_KEY_123', fetchImpl: vi.fn().mockResolvedValue(ok('err', status)) });
    await expect(g.stream('s', [{ role: 'user', content: 'x' }], () => {})).rejects.toMatchObject({ kind });
  });
  it('throws on promptFeedback.blockReason', async () => {
    const f = vi.fn().mockResolvedValue(ok(body('data: {"candidates":[{"content":{"parts":[{"text":"text"}]}}]}\n\ndata: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n')));
    const g = createGemini({ apiKey: 'SECRET_KEY_123', fetchImpl: f });
    await expect(g.stream('s', [{ role: 'user', content: 'x' }], () => {})).rejects.toMatchObject({ kind: 'bad-response' });
  });
  it('ProviderError is an Error', () => {
    expect(new ProviderError('x', 'quota')).toBeInstanceOf(Error);
  });
});
