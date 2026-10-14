import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendDiary, loadDiary, localDiaryPrompt, wipeDiary, writeDiary } from '../src/main/diary';
import { emptyTotals } from '../src/main/tally';

describe('diary store', () => {
  it('appends, caps at 30, and wipes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    expect(loadDiary(dir)).toEqual([]);
    for (let i = 0; i < 35; i++) appendDiary(dir, { day: `d${i}`, tokenId: 5, text: 't' });
    expect(loadDiary(dir)).toHaveLength(30);
    expect(loadDiary(dir)[0].day).toBe('d5');
    writeFileSync(join(dir, 'diary.json.tmp'), 'leftover from a crash');
    wipeDiary(dir);
    expect(existsSync(join(dir, 'diary.json'))).toBe(false);
    expect(existsSync(join(dir, 'diary.json.tmp'))).toBe(false);
    expect(loadDiary(dir)).toEqual([]);
  });
  it('leaves no .tmp file behind after appending (atomic write)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    appendDiary(dir, { day: 'd0', tokenId: 5, text: 't' });
    appendDiary(dir, { day: 'd1', tokenId: 5, text: 't' });
    expect(readdirSync(dir)).toEqual(['diary.json']);
  });
});

describe('writeDiary', () => {
  it('prefers the server', async () => {
    expect(await writeDiary({ remote: async () => 'S', local: async () => 'L', template: 'T' })).toEqual({ text: 'S', source: 'server' });
  });
  it('falls back to the local model, then the template', async () => {
    const fail = async () => { throw new Error('down'); };
    expect(await writeDiary({ remote: fail, local: async () => 'L', template: 'T' })).toEqual({ text: 'L', source: 'local' });
    expect(await writeDiary({ remote: fail, local: fail, template: 'T' })).toEqual({ text: 'T', source: 'template' });
    expect(await writeDiary({ remote: fail, local: null, template: 'T' })).toEqual({ text: 'T', source: 'template' });
  });
  it('treats an empty model reply as a failure', async () => {
    expect(await writeDiary({ remote: async () => '  ', local: null, template: 'T' })).toEqual({ text: 'T', source: 'template' });
  });
});

describe('localDiaryPrompt', () => {
  it('uses only category minutes', () => {
    const t = emptyTotals();
    t.minutes.coding = 90;
    const p = localDiaryPrompt({ chogName: 'CHOG #5', archetype: 'hype', totals: t });
    expect(p).toContain('coding: 90 min');
    expect(p).toContain('Hype Chog');
    expect(p).not.toContain('chat: 0');
  });
});
