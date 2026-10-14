import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATLOG_CAP, appendChatLog, forToken, loadChatLog, wipeChatLog } from '../src/main/chatlog';
import type { Cipher } from '../src/main/secrets';

const rev: Cipher = { available: () => true, encrypt: (s) => Buffer.from([...s].reverse().join('')), decrypt: (b) => [...b.toString()].reverse().join('') };
const m = (i: number, tokenId = 5) => ({ role: 'user' as const, content: `msg ${i}`, at: i, tokenId });

describe('chat log', () => {
  it('round-trips encrypted and is not plain text on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    appendChatLog(dir, rev, [m(1), { role: 'assistant', content: 'hi there', at: 2, tokenId: 5 }]);
    expect(loadChatLog(dir, rev).map((x) => x.content)).toEqual(['msg 1', 'hi there']);
    expect(readFileSync(join(dir, 'chat-history.bin'), 'utf8')).not.toContain('hi there');
  });
  it('caps at CHATLOG_CAP keeping the newest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    appendChatLog(dir, rev, Array.from({ length: CHATLOG_CAP + 15 }, (_, i) => m(i)));
    const log = loadChatLog(dir, rev);
    expect(log).toHaveLength(CHATLOG_CAP);
    expect(log[0].at).toBe(15);
  });
  it('returns [] for missing, corrupt or undecryptable files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    expect(loadChatLog(dir, rev)).toEqual([]);
    writeFileSync(join(dir, 'chat-history.bin'), 'garbage');
    expect(loadChatLog(dir, { ...rev, decrypt: () => { throw new Error('x'); } })).toEqual([]);
    expect(loadChatLog(dir, rev)).toEqual([]);
  });
  it('writes nothing when encryption is unavailable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    appendChatLog(dir, { ...rev, available: () => false }, [m(1)]);
    expect(existsSync(join(dir, 'chat-history.bin'))).toBe(false);
  });
  it('filters by token and wipes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    appendChatLog(dir, rev, [m(1, 5), m(2, 9)]);
    expect(forToken(loadChatLog(dir, rev), 9).map((x) => x.at)).toEqual([2]);
    wipeChatLog(dir);
    expect(loadChatLog(dir, rev)).toEqual([]);
  });
  it('leaves no .tmp file behind (atomic write; wipe clears a crash leftover)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    appendChatLog(dir, rev, [m(1)]);
    appendChatLog(dir, rev, [m(2)]);
    expect(readdirSync(dir)).toEqual(['chat-history.bin']);
    writeFileSync(join(dir, 'chat-history.bin.tmp'), 'leftover from a crash');
    wipeChatLog(dir);
    expect(readdirSync(dir)).toEqual([]);
  });
});
