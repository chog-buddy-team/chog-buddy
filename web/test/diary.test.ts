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
      expect(d.toLowerCase()).toContain('coding');
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
  it('falls back to template when Gemini hangs past the timeout', async () => {
    // Resolves only when aborted, like an overloaded model that never answers.
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    ) as unknown as typeof fetch;
    const r = await generateDiary('hype', 'CHOG #5', t, fetchImpl, 50);
    expect(r.source).toBe('template');
  });
  it('uses the template without calling Gemini when over the daily cap', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const fetchImpl = vi.fn();
    const r = await generateDiary('hype', 'CHOG #5', t, fetchImpl as unknown as typeof fetch, 10_000, false);
    expect(r.source).toBe('template');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('falls back to template on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect((await generateDiary('hype', 'CHOG #5', t, fetchImpl)).source).toBe('template');
  });
});
