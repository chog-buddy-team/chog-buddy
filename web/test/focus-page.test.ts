import { describe, expect, it } from 'vitest';
import { keyHashOf } from '@/lib/focus';
import { canPickGoal, estimatedBonus, keyForBet, localMidnightDeadline, minBonusFor, newProgressKey, parseSavedBets, rememberBet } from '@/lib/focus-page';

describe('minBonusFor', () => {
  it('accepts up to 5% less than the estimate', () => {
    expect(minBonusFor(100n)).toBe(95n);
    expect(minBonusFor(0n)).toBe(0n);
  });
});

describe('keyForBet', () => {
  const k1 = `0x${'11'.repeat(32)}` as const;
  const k2 = `0x${'22'.repeat(32)}` as const;
  it('finds the key saved under the bet id', () => {
    expect(keyForBet([{ betId: '7', key: k1 }], 7n, keyHashOf(k2))).toBe(k1);
  });
  it('finds a key saved before the bet id was known by its onchain hash', () => {
    expect(keyForBet([{ betId: '0', key: k1 }, { betId: '0', key: k2 }].slice(1), 9n, keyHashOf(k2))).toBe(k2);
  });
  it('returns null when no saved key matches', () => {
    expect(keyForBet([{ betId: '0', key: k1 }], 9n, keyHashOf(k2))).toBeNull();
  });
});

const local = (h: number, m: number) => new Date(2026, 9, 14, h, m, 0);
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

describe('localMidnightDeadline', () => {
  it('is the next local midnight', () => {
    expect(localMidnightDeadline(local(23, 30)) - secs(local(23, 30))).toBe(30 * 60);
    expect(localMidnightDeadline(local(0, 0)) - secs(local(0, 0))).toBe(24 * 3600);
  });
  it('never exceeds 24h (contract limit), e.g. on a daylight-saving day', () => {
    const now = local(1, 0); // real midnight is 23h away here
    // simulate a DST day where the next local midnight is 25h away
    expect(localMidnightDeadline(now, () => secs(now) + 25 * 3600) - secs(now)).toBe(24 * 3600);
  });
});

describe('canPickGoal', () => {
  it('always allows the sprint', () => {
    expect(canPickGoal(0, local(23, 59))).toBe(true);
  });
  it('allows an hour goal only if it still fits before midnight', () => {
    expect(canPickGoal(1, local(23, 0))).toBe(false);
    expect(canPickGoal(1, local(22, 0))).toBe(false); // exactly 2h left: the tx could mine too late
    expect(canPickGoal(1, local(21, 58))).toBe(true); // 2h + 2 min margin
    expect(canPickGoal(1, local(20, 0))).toBe(true);
    expect(canPickGoal(3, local(19, 0))).toBe(false); // 6h needs until 18:00
  });
});

describe('newProgressKey', () => {
  it('is 32 random bytes as hex', () => {
    const a = newProgressKey();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(newProgressKey()).not.toBe(a);
  });
});

describe('estimatedBonus', () => {
  const e18 = 10n ** 18n;
  it('is the goal share of the stake when the pot is large', () => {
    expect(estimatedBonus(10n * e18, 0, 100_000n * e18)).toBe(e18 / 2n); // 5% of 10
  });
  it('is capped at 1% of the free pot, like the contract', () => {
    expect(estimatedBonus(100n * e18, 3, 1_000n * e18)).toBe(10n * e18); // 50% of 100, capped at 1% of 1000
  });
});

describe('saved bets', () => {
  const key = `0x${'ab'.repeat(32)}` as const;
  it('ignores missing or broken storage', () => {
    expect(parseSavedBets(null)).toEqual([]);
    expect(parseSavedBets('not json')).toEqual([]);
    expect(parseSavedBets(JSON.stringify([{ betId: 'x' }, { betId: '3', key }, { betId: '4', key: '0x12' }]))).toEqual([{ betId: '3', key }]);
  });
  it('puts the newest bet first, replaces the same id and keeps 20', () => {
    let list = parseSavedBets(null);
    for (let i = 1; i <= 25; i++) list = rememberBet(list, { betId: String(i), key });
    expect(list).toHaveLength(20);
    expect(list[0].betId).toBe('25');
    const again = rememberBet(list, { betId: '24', key });
    expect(again[0].betId).toBe('24');
    expect(again.filter((b) => b.betId === '24')).toHaveLength(1);
  });
});
