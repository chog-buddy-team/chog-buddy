import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category, type DailyTotals } from '../src/types';
import { driftAxes, nextSoul, parseDailyTotals } from '../src/soul';

const totals = (m: Partial<Record<Category, number>>, late = 0, early = 0): DailyTotals => ({
  minutes: Object.fromEntries(CATEGORIES.map((c) => [c, m[c] ?? 0])) as Record<Category, number>,
  lateMinutes: late,
  earlyMinutes: early,
});
const mid = { nightOwl: 50, grinder: 50, social: 50, creator: 50 };

describe('driftAxes', () => {
  it('no activity barely moves anything', () => {
    // social has a 60-minute baseline, so zero chat drifts it down
    expect(driftAxes(mid, totals({}))).toEqual({ nightOwl: 50, grinder: 50, social: 48, creator: 50 });
  });
  it('a big coding day pushes grinder and creator up by the cap', () => {
    const a = driftAxes(mid, totals({ coding: 480 }));
    expect(a.grinder).toBe(53);
    expect(a.creator).toBe(53);
  });
  it('late nights push nightOwl up, early mornings down', () => {
    expect(driftAxes(mid, totals({ coding: 120 }, 120, 0)).nightOwl).toBe(52);
    expect(driftAxes(mid, totals({ coding: 120 }, 0, 120)).nightOwl).toBe(48);
  });
  it('lots of video drags grinder and creator down', () => {
    const a = driftAxes(mid, totals({ video: 300 }));
    expect(a.grinder).toBe(47);
    expect(a.creator).toBe(47);
  });
  it('chatty day raises social', () => {
    expect(driftAxes(mid, totals({ chat: 180 })).social).toBe(53);
  });
  it('clamps to 0-100', () => {
    expect(driftAxes({ ...mid, grinder: 99 }, totals({ coding: 600 })).grinder).toBe(100);
    expect(driftAxes({ ...mid, grinder: 1 }, totals({ video: 600 })).grinder).toBe(0);
  });
});

describe('nextSoul', () => {
  const base = { nightOwl: 70, grinder: 20, social: 40, creator: 60 };
  it('first day starts from the archetype base, level 1, ownerCount 1', () => {
    const s = nextSoul(null, base, totals({}), false);
    expect(s).toMatchObject({ level: 1, ownerCount: 1, nightOwl: 70 });
  });
  it('increments level and keeps ownerCount for same owner', () => {
    const s = nextSoul({ ...base, level: 4, ownerCount: 2 }, base, totals({}), false);
    expect(s).toMatchObject({ level: 5, ownerCount: 2 });
  });
  it('bumps ownerCount when the owner changed', () => {
    expect(nextSoul({ ...base, level: 4, ownerCount: 2 }, base, totals({}), true).ownerCount).toBe(3);
  });
});

describe('parseDailyTotals', () => {
  const ok = { minutes: { coding: 10, chat: 5 }, lateMinutes: 0, earlyMinutes: 0 };
  it('fills missing categories with 0', () => {
    expect(parseDailyTotals(ok).minutes.video).toBe(0);
  });
  it.each([
    ['null', null],
    ['string minutes', { ...ok, minutes: { coding: '10' } }],
    ['negative', { ...ok, minutes: { coding: -1 } }],
    ['unknown category', { ...ok, minutes: { gaming: 10 } }],
    ['more than a day', { ...ok, minutes: { coding: 1000, chat: 500 } }],
    ['late > total', { ...ok, lateMinutes: 100 }],
    ['NaN', { ...ok, earlyMinutes: Number.NaN }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseDailyTotals(input)).toThrow(TypeError);
  });
});
