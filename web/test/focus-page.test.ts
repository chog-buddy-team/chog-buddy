import { describe, expect, it } from 'vitest';
import { canPickGoal, localMidnightDeadline, newProgressKey } from '@/lib/focus-page';

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
