import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../src/main/store';

describe('settings store', () => {
  it('returns defaults when no file exists', () => {
    const s = loadSettings(mkdtempSync(join(tmpdir(), 'chog-')));
    expect(s.tokenId).toBe(5);
    expect(s.focusMode).toBe(false);
  });
  it('round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    const s = loadSettings(dir);
    saveSettings(dir, { ...s, tokenId: 42, focusMode: true });
    expect(loadSettings(dir)).toMatchObject({ tokenId: 42, focusMode: true });
  });
  it('survives a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    writeFileSync(join(dir, 'settings.json'), '{not json');
    expect(loadSettings(dir).tokenId).toBe(5);
  });
  it('fills chat defaults, including for an old settings file without chat', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ tokenId: 9 }));
    expect(loadSettings(dir).chat).toEqual({ provider: 'auto', ollamaModel: 'llama3.2', geminiKeyEnc: null });
  });
  it('falls back to chat defaults for non-object saved chat', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    for (const bad of [null, 'x', []]) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ chat: bad }));
      expect(loadSettings(dir).chat).toEqual({ provider: 'auto', ollamaModel: 'llama3.2', geminiKeyEnc: null });
    }
  });
  it('keeps saved chat fields and fills missing ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ chat: { provider: 'gemini' } }));
    expect(loadSettings(dir).chat).toEqual({ provider: 'gemini', ollamaModel: 'llama3.2', geminiKeyEnc: null });
  });
  it('defaults skin to classic and rejects unknown skins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    expect(loadSettings(dir).skin).toBe('classic');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ focusMode: true }));
    expect(loadSettings(dir).skin).toBe('classic');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ skin: 'banana' }));
    expect(loadSettings(dir).skin).toBe('classic');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ skin: 5 }));
    expect(loadSettings(dir).skin).toBe('classic');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ skin: 'nft' }));
    expect(loadSettings(dir).skin).toBe('nft');
  });
  it('fills integration defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    const s = loadSettings(dir);
    expect(s).toMatchObject({ judgeMode: false, session: null, lastUpload: 0, lastOwnershipCheck: 0, yesterday: null });
    expect(s.secrets).toEqual({ githubEnc: null, icalEnc: null });
  });
  it('keeps saved secrets and fills missing secret fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ secrets: { githubEnc: 'abc' } }));
    expect(loadSettings(dir).secrets).toEqual({ githubEnc: 'abc', icalEnc: null });
  });
  it('falls back to secret defaults for non-object saved secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    for (const bad of [null, 'abc', []]) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ secrets: bad }));
      expect(loadSettings(dir).secrets).toEqual({ githubEnc: null, icalEnc: null });
    }
  });
  it('saves atomically: round-trips and leaves no .tmp file behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    saveSettings(dir, { ...loadSettings(dir), tokenId: 42, judgeMode: true });
    expect(loadSettings(dir)).toMatchObject({ tokenId: 42, judgeMode: true });
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });
  it('focusBet defaults to null, round-trips, and a broken saved value becomes null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    expect(loadSettings(dir).focusBet).toBeNull();
    const bet = { betId: '3', keyEnc: 'c2VhbGVk', focusMs: 65_000, startedAt: 1, deadline: null, goal: null, goalMinutes: null };
    saveSettings(dir, { ...loadSettings(dir), focusBet: bet });
    expect(loadSettings(dir).focusBet).toEqual(bet);
    for (const bad of [null, 'x', [], 5, {}, { betId: 3, keyEnc: 'k', focusMs: 0 }, { betId: '3', keyEnc: 'k', focusMs: 'a' }]) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ focusBet: bad }));
      expect(loadSettings(dir).focusBet).toBeNull();
    }
  });
  it('a saved focusBet nulls an invalid deadline, goal or goalMinutes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    const base = { betId: '3', keyEnc: 'k', focusMs: 0 };
    const load = (extra: object) => {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ focusBet: { ...base, ...extra } }));
      return loadSettings(dir).focusBet;
    };
    expect(load({ deadline: 5, goal: 2, goalMinutes: 240 })).toMatchObject({ deadline: 5, goal: 2, goalMinutes: 240 });
    expect(load({ deadline: 'x', goal: 4, goalMinutes: 0 })).toMatchObject({ deadline: null, goal: null, goalMinutes: null });
    expect(load({ deadline: null, goal: 1.5, goalMinutes: 2.5 })).toMatchObject({ deadline: null, goal: null, goalMinutes: null });
    expect(load({ deadline: 5, goal: -1, goalMinutes: -3 })).toMatchObject({ deadline: 5, goal: null, goalMinutes: null });
  });
  it('movement defaults to walk with no stayPos, round-trips, and invalid values fall back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    expect(loadSettings(dir)).toMatchObject({ movement: 'walk', stayPos: null });
    saveSettings(dir, { ...loadSettings(dir), movement: 'stay', stayPos: { x: 300, y: -200 } });
    expect(loadSettings(dir)).toMatchObject({ movement: 'stay', stayPos: { x: 300, y: -200 } });
    for (const movement of ['run', 5, null, ['stay']]) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ movement }));
      expect(loadSettings(dir).movement).toBe('walk');
    }
    for (const stayPos of [null, 'x', [], 5, {}, { x: 1 }, { x: 'a', y: 2 }, { x: 1, y: null }]) {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ movement: 'stay', stayPos }));
      expect(loadSettings(dir).stayPos).toBeNull();
    }
  });
});
