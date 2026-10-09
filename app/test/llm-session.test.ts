import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category } from '@chog/core';
import { buildSystemPrompt } from '../src/main/llm/prompt';
import { ChatSession, HISTORY_CAP, MAX_INPUT, errorLine, pickProvider } from '../src/main/llm/session';
import { ProviderError, type ChatProvider } from '../src/main/llm/types';

const totals = { minutes: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>, lateMinutes: 0, earlyMinutes: 0 };
totals.minutes.coding = 125.6;
totals.minutes.video = 30;

function fake(id: ChatProvider['id'], avail: boolean, reply: string | Error = 'hi!'): ChatProvider & { calls: number } {
  const p = {
    id, calls: 0,
    available: async () => avail,
    stream: async (_s: string, _h: unknown, onToken: (t: string) => void) => {
      p.calls++;
      if (reply instanceof Error) throw reply;
      onToken(reply);
      return reply;
    },
  };
  return p;
}

describe('buildSystemPrompt', () => {
  it('includes name, voice and rounded category minutes, nothing else about the user', () => {
    const s = buildSystemPrompt({ chogName: 'CHOG #5', archetype: 'grump', totals });
    expect(s).toContain('CHOG #5');
    expect(s).toContain('Grump Chog');
    expect(s).toContain('sarcastic');
    expect(s).toContain('coding: 126 min');
    expect(s).toContain('video: 30 min');
    expect(s).not.toContain('design: 0');
  });
});

describe('pickProvider', () => {
  it('auto prefers Ollama, then Gemini, else null', async () => {
    expect((await pickProvider('auto', [fake('ollama', true), fake('gemini', true)]))?.id).toBe('ollama');
    expect((await pickProvider('auto', [fake('ollama', false), fake('gemini', true)]))?.id).toBe('gemini');
    expect(await pickProvider('auto', [fake('ollama', false), fake('gemini', false)])).toBeNull();
  });
  it('a forced provider is used only if available', async () => {
    expect((await pickProvider('gemini', [fake('ollama', true), fake('gemini', true)]))?.id).toBe('gemini');
    expect(await pickProvider('gemini', [fake('ollama', true), fake('gemini', false)])).toBeNull();
  });
});

describe('ChatSession', () => {
  const mk = (providers: ChatProvider[]) => new ChatSession(() => providers, () => 'auto', () => 'SYS');

  it('ignores empty or whitespace input without calling a provider', async () => {
    const o = fake('ollama', true);
    const s = mk([o]);
    expect((await s.send('   ', () => {})).reply).toBe('');
    expect(o.calls).toBe(0);
    expect(s.history).toHaveLength(0);
  });
  it('caps input length and records both turns', async () => {
    const s = mk([fake('ollama', true, 'yo')]);
    await s.send('x'.repeat(MAX_INPUT + 50), () => {});
    expect(s.history[0].content).toHaveLength(MAX_INPUT);
    expect(s.history[1]).toEqual({ role: 'assistant', content: 'yo' });
  });
  it('keeps at most HISTORY_CAP messages', async () => {
    const s = mk([fake('ollama', true)]);
    for (let i = 0; i < HISTORY_CAP; i++) await s.send(`m${i}`, () => {});
    expect(s.history).toHaveLength(HISTORY_CAP);
    expect(s.history.at(-1)?.role).toBe('assistant');
  });
  it('no provider -> in-character setup line, not recorded as a reply', async () => {
    const r = await mk([fake('ollama', false), fake('gemini', false)]).send('hi', () => {});
    expect(r).toMatchObject({ failed: true, provider: null, reply: errorLine('none') });
  });
  it.each(['auth', 'quota', 'network', 'bad-response'] as const)('%s error -> friendly line, raw message hidden, user turn dropped', async (kind) => {
    const s = mk([fake('gemini', true, new ProviderError('RAW SECRET DETAIL', kind))]);
    const toks: string[] = [];
    const r = await s.send('hi', (t) => toks.push(t));
    expect(r.failed).toBe(true);
    expect(r.reply).toBe(errorLine(kind));
    expect(r.reply).not.toContain('RAW');
    expect(s.history).toHaveLength(0);
  });
});

describe('ChatSession.send', () => {
  it('never rejects when available() throws', async () => {
    const bad = { ...fake('ollama', true), available: async () => { throw new Error('boom'); } };
    const r = await new ChatSession(() => [bad], () => 'auto', () => 's').send('hi', () => {});
    expect(r.failed).toBe(true);
  });
});
