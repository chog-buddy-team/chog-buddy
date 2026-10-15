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
  // A stored row: minutes so far, and the time up to which focus credit has been spent.
  const last = (minutes: number, creditedAtSeconds: number) => ({ minutes, creditedAtMs: at(creditedAtSeconds) });
  const twoHours = bet({ goal: 1, deadline: start + 7200 });
  it('403 on a wrong key', () => {
    expect(decideProgress(bet(), { key: `0x${'cd'.repeat(32)}` as Hex, focusMinutes: 1 }, null, at(90))).toMatchObject({ action: 'reject', status: 403 });
  });
  it('409 when the bet is not open', () => {
    expect(decideProgress(bet({ status: 'Won' }), { key, focusMinutes: 1 }, null, at(90))).toMatchObject({ action: 'reject', status: 409 });
  });
  it('409 from the exact end of the grace period (same boundary as decideCheck)', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, last(2, 120), at(300 + 120))).toMatchObject({ action: 'reject', status: 409 });
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, last(2, 120), at(300 + 119))).toMatchObject({ action: 'win', minutes: 3 });
  });
  it('400 when claiming more focus than the exact time since the stake', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 2 }, null, at(119))).toMatchObject({ action: 'reject', status: 400 });
    expect(decideProgress(bet(), { key, focusMinutes: 2 }, null, at(120))).toEqual({ action: 'store', minutes: 2, creditedAtMs: at(120) });
  });
  it('rejects a Sprint win at two minutes (no slack)', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, last(2, 110), at(120))).toMatchObject({ action: 'reject', status: 400 });
  });
  it('credit builds one minute per real minute and spends only what a report uses', () => {
    expect(decideProgress(twoHours, { key, focusMinutes: 2 }, last(1, 900), at(930))).toEqual({ action: 'store', minutes: 1, creditedAtMs: at(900) });
    expect(decideProgress(twoHours, { key, focusMinutes: 2 }, last(1, 900), at(960))).toEqual({ action: 'store', minutes: 2, creditedAtMs: at(960) });
  });
  it('a jump after a long silence gains at most two minutes', () => {
    expect(decideProgress(twoHours, { key, focusMinutes: 9 }, last(1, 900), at(1500))).toEqual({ action: 'store', minutes: 3, creditedAtMs: at(1500) });
  });
  it('one report at the goal time cannot win when nothing came before it', () => {
    expect(decideProgress(twoHours, { key, focusMinutes: 120 }, null, at(7200))).toMatchObject({ action: 'store', minutes: 2 });
    expect(decideProgress(twoHours, { key, focusMinutes: 120 }, last(0, 60), at(7200))).toMatchObject({ action: 'store', minutes: 2 });
  });
  it('wins when reports kept up with the clock', () => {
    expect(decideProgress(twoHours, { key, focusMinutes: 120 }, last(119, 7140), at(7200))).toMatchObject({ action: 'win', minutes: 120 });
  });
  it('a Pet whose 30 s timer runs a little fast still reaches a Sprint win', () => {
    let stored: { minutes: number; creditedAtMs: number } | null = null;
    let result = '';
    for (let t = 29.9; t < 300 && result !== 'win'; t += 29.9) {
      const d = decideProgress(bet(), { key, focusMinutes: Math.floor(t / 60) }, stored, at(t));
      if (d.action === 'reject') throw new Error(d.error);
      stored = { minutes: d.minutes, creditedAtMs: d.creditedAtMs };
      result = d.action;
    }
    expect(result).toBe('win');
  });
  it('does not count time after the deadline', () => {
    // Sprint deadline is 300 s; credit spent up to 290 s, so the grace period adds nothing.
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, last(2, 290), at(400))).toMatchObject({ action: 'store', minutes: 2 });
    // A late upload of focus reached before the deadline still counts.
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, last(2, 240), at(400))).toMatchObject({ action: 'win', minutes: 3 });
  });
  it('stores progress below the goal and never lowers it', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 1 }, null, at(90))).toMatchObject({ action: 'store', minutes: 1 });
    expect(decideProgress(bet(), { key, focusMinutes: 1 }, last(2, 120), at(150))).toMatchObject({ action: 'store', minutes: 2 });
  });
  it('wins at the goal, also inside the grace period', () => {
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, last(2, 140), at(200))).toMatchObject({ action: 'win', minutes: 3 });
    expect(decideProgress(bet(), { key, focusMinutes: 3 }, last(2, 240), at(300 + 60))).toMatchObject({ action: 'win', minutes: 3 });
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
