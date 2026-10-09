import { describe, expect, it } from 'vitest';
import { parseDailyTotals } from '@chog/core';
import { DEMO_DAYS, demoDays, demoTotals } from '@/lib/demo';

const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 9, 1) + i * 86_400_000).toISOString().slice(0, 10));
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('demoTotals', () => {
  it('always produces totals the API itself would accept', () => {
    for (const d of days) expect(() => parseDailyTotals(demoTotals(d))).not.toThrow();
  });
  it('is the same for the same day, so re-runs never change history', () => {
    expect(demoTotals('2026-10-09')).toEqual(demoTotals('2026-10-09'));
  });
  it('varies day to day', () => {
    expect(new Set(days.map((d) => JSON.stringify(demoTotals(d)))).size).toBeGreaterThan(50);
  });
  it('codes more on weekdays and watches more video on weekends', () => {
    const wk = days.filter((d) => !isWeekend(d)).map(demoTotals);
    const we = days.filter(isWeekend).map(demoTotals);
    expect(avg(wk.map((t) => t.minutes.coding))).toBeGreaterThan(avg(we.map((t) => t.minutes.coding)));
    expect(avg(we.map((t) => t.minutes.video))).toBeGreaterThan(avg(wk.map((t) => t.minutes.video)));
  });
});

describe('demoDays', () => {
  it('covers today plus enough past days for a 7-day head start past the 2-day lag', () => {
    const d = demoDays(new Date('2026-10-09T15:00:00Z'));
    expect(d).toHaveLength(DEMO_DAYS);
    expect(d[0]).toBe('2026-10-09');
    expect(d.at(-1)).toBe('2026-10-01'); // 2026-10-01..07 are old enough for the cron to apply = 7 days
  });
});
