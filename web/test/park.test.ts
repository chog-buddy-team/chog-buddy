import { describe, expect, it } from 'vitest';
import { buildPark, moodLine, type ParkMeta, type ParkRow } from '@/lib/park';

const totals = (m: Partial<Record<string, number>>) => ({
  minutes: { coding: 0, design: 0, chat: 0, browsing: 0, video: 0, meeting: 0, idle: 0, other: 0, ...m },
  lateMinutes: 0,
  earlyMinutes: 0,
});
const soul = { nightOwl: 50, grinder: 70, social: 20, creator: 60, level: 7 };
const row = (tokenId: number, day: string, m: Partial<Record<string, number>>, extra: Partial<ParkRow> = {}): ParkRow => ({ tokenId, day, totals: totals(m), demo: false, soul, ...extra });
const metas = new Map<number, ParkMeta>([
  [5, { name: 'CHOG #1466', image: 'https://x/5.png', archetype: 'grump' }],
  [9, { name: 'CHOG #9', image: null, archetype: 'hype' }],
]);

describe('moodLine', () => {
  it('reflects the top category in the archetype voice', () => {
    expect(moodLine('hype', totals({ coding: 120, video: 10 }) as never)).toMatch(/cod/i);
  });
  it('is neutral with no data or no archetype', () => {
    expect(moodLine(null, null)).toBeTruthy();
    expect(moodLine('grump', totals({}) as never)).toBeTruthy();
  });
});

describe('buildPark', () => {
  it('builds cards with focus minutes (coding + design only) and sorts by level', () => {
    const p = buildPark([row(9, '2026-10-15', { coding: 30, design: 15, video: 99 }, { soul: { ...soul, level: 2 } }), row(5, '2026-10-15', { coding: 100 })], metas, '2026-10-15');
    expect(p.chogs.map((c) => c.tokenId)).toEqual([5, 9]);
    expect(p.chogs[1].focusMinutes).toBe(45);
    expect(p.chogs[0]).toMatchObject({ name: 'CHOG #1466', archetypeName: 'Grump Chog', image: 'https://x/5.png' });
    expect(JSON.stringify(p)).not.toMatch(/video|owner|0x/i);
  });
  it('handles a missing soul, failed metadata and corrupt totals', () => {
    const p = buildPark([row(77, '2026-10-15', {}, { soul: null, totals: 'garbage' })], metas, '2026-10-15');
    expect(p.chogs[0]).toMatchObject({ tokenId: 77, name: 'Chog #77', image: null, archetypeName: null, soul: null, focusMinutes: 0 });
    expect(p.chogs[0].mood).toBeTruthy();
  });
  it('leaderboard: today or yesterday only, focus > 0, top 10, desc', () => {
    const rows = [row(5, '2026-10-14', { coding: 50 }), row(9, '2026-10-15', { coding: 80 }), ...Array.from({ length: 12 }, (_, i) => row(100 + i, '2026-10-15', { design: i + 1 })), row(200, '2026-10-10', { coding: 999 }), row(201, '2026-10-15', {})];
    const p = buildPark(rows, metas, '2026-10-15');
    expect(p.leaderboard[0]).toEqual({ tokenId: 9, name: 'CHOG #9', focusMinutes: 80 });
    expect(p.leaderboard).toHaveLength(10);
    expect(p.leaderboard.some((l) => l.tokenId === 200 || l.tokenId === 201)).toBe(false);
    expect(p.chogs.some((c) => c.tokenId === 200)).toBe(true); // stale Chogs keep their card
  });
  it('labels the demo Chog', () => {
    expect(buildPark([row(5, '2026-10-15', {}, { demo: true })], metas, '2026-10-15').chogs[0].demo).toBe(true);
  });
});
