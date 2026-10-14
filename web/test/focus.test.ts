import { describe, expect, it } from 'vitest';
import { keccak256, type Hex } from 'viem';
import { GOALS, decideCheck, decideProgress, keyHashOf, parseProgressBody, type OnchainBet } from '@/lib/focus';

const key = `0x${'ab'.repeat(32)}` as Hex;
const start = 1_800_000_000; // seconds
const bet = (over: Partial<OnchainBet> = {}): OnchainBet => ({
  betId: 7n,
  bettor: '0x0000000000000000000000000000000000000001',
  amount: 10n ** 19n,
  start,
  deadline: start + 300,
  bonus: 5n * 10n ** 17n,
  goal: 0,
  status: 'Open',
  progressKeyHash: keccak256(key),
  ...over,
});
const at = (secondsAfterStart: number) => (start + secondsAfterStart) * 1000;

describe('GOALS', () => {
  it('mirrors the contract goal table', () => {
    expect(GOALS.map((g) => [g.id, g.focusMinutes, g.bonusBps, g.graceMs])).toEqual([
      [0, 3, 500, 120_000],
      [1, 120, 1000, 900_000],
      [2, 240, 2500, 900_000],
      [3, 360, 5000, 900_000],
    ]);
  });
});

describe('keyHashOf', () => {
  it('is keccak256 of the 32-byte key', () => {
    expect(keyHashOf(key)).toBe(keccak256(key));
  });
});

describe('parseProgressBody', () => {
  it('accepts a valid report', () => {
    expect(parseProgressBody({ betId: '12', key, focusMinutes: 2 })).toEqual({ betId: 12n, key, focusMinutes: 2 });
  });
  it.each([
    ['fractional minutes', { betId: '1', key, focusMinutes: 1.5 }],
    ['negative minutes', { betId: '1', key, focusMinutes: -1 }],
    ['missing key', { betId: '1', focusMinutes: 1 }],
    ['short key', { betId: '1', key: '0xabcd', focusMinutes: 1 }],
    ['bad bet id', { betId: 'x', key, focusMinutes: 1 }],
    ['zero bet id', { betId: '0', key, focusMinutes: 1 }],
  ])('rejects %s', (_n, body) => {
    expect(() => parseProgressBody(body)).toThrow(TypeError);
  });
});

describe('decideProgress', () => {
  it('403 on a wrong key', () => {
    expect(decideProgress(bet(), { key: `0x${'cd'.repeat(32)}`, focusMinutes: 1 }, null, at(90))).toMatchObject({ action: 'reject', status: 403 });
  });
  it('409 when the bet is not open', () => {
    expect(decideProgress(bet({ status: 'Won' }), { key, focusMinutes: 1 }, null, at(90))).toMatchObject({ action: 'reject', status: 409 });
  });
  it('409 after deadline + grace', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, null, at(300 + 121))).toMatchObject({ action: 'reject', status: 409 });
  });
  it('400 when claiming more focus than time elapsed', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 5 }, null, at(60))).toMatchObject({ action: 'reject', status: 400 });
  });
  it('stores progress below the goal', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 1 }, null, at(90))).toEqual({ action: 'store', minutes: 1 });
  });
  it('never lowers stored progress', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 1 }, 2, at(150))).toEqual({ action: 'store', minutes: 2 });
  });
  it('wins at the goal, also inside the grace period', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, 2, at(200))).toEqual({ action: 'win', minutes: 3 });
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, 2, at(300 + 60))).toEqual({ action: 'win', minutes: 3 });
  });
});

describe('decideCheck', () => {
  it('done when not open', () => {
    expect(decideCheck(bet({ status: 'Lost' }), null, at(1000))).toBe('done');
  });
  it('waits until deadline + grace', () => {
    expect(decideCheck(bet(), 1, at(300 + 119))).toBe('wait');
  });
  it('loses after deadline + grace below the goal', () => {
    expect(decideCheck(bet(), 1, at(300 + 120))).toBe('lose');
    expect(decideCheck(bet(), null, at(300 + 120))).toBe('lose');
  });
  it('retries the win when progress reached the goal but the bet is still open', () => {
    expect(decideCheck(bet(), 3, at(300 + 500))).toBe('win');
  });
});
