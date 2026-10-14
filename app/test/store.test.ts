import { mkdtempSync, writeFileSync } from 'node:fs';
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
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ skin: 'banana' }));
    expect(loadSettings(dir).skin).toBe('classic');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ skin: 'nft' }));
    expect(loadSettings(dir).skin).toBe('nft');
  });
});
