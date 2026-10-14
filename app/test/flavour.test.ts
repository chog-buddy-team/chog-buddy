import { describe, expect, it, vi } from 'vitest';
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
  it('falls back on error or junk', async () => {
    expect(await flavourLine({ template: T, rand: () => 0.1, generate: async () => { throw new Error('x'); } })).toBe(T);
    expect(await flavourLine({ template: T, rand: () => 0.1, generate: () => { throw new Error('sync'); } })).toBe(T);
    expect(await flavourLine({ template: T, rand: () => 0.1, generate: async () => 42 as unknown as string })).toBe(T);
    expect(await flavourLine({ template: T, rand: () => 0.1, generate: async () => '' })).toBe(T);
  });
  it('falls back on timeout', async () => {
    vi.useFakeTimers();
    try {
      const line = flavourLine({ template: T, rand: () => 0.1, generate: () => new Promise<string>(() => {}) });
      await vi.advanceTimersByTimeAsync(FLAVOUR_TIMEOUT_MS);
      expect(await line).toBe(T);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('flavourPrompt', () => {
  it('names the voice, the trigger and the template as a style example', () => {
    const p = flavourPrompt({ chogName: 'CHOG #5', archetype: 'grump', trigger: 'category_switch', category: 'video', template: 'Oh, video now. Sure.' });
    expect(p).toContain('Grump Chog');
    expect(p).toContain('video');
    expect(p).toContain('Oh, video now. Sure.');
  });
});
