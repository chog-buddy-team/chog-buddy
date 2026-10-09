import { assertTokenId, parseDailyTotals, type DailyTotals } from '@chog/core';

const DAY_MS = 86_400_000;

// Owner-local day: accept anything within [now - 2 days, now + 1 day] to cover timezones.
export function parseActivityBody(x: unknown, now = new Date()): { tokenId: number; day: string; totals: DailyTotals } {
  const b = x as { tokenId?: unknown; day?: unknown; totals?: unknown } | null;
  if (typeof b?.tokenId !== 'number') throw new TypeError('tokenId must be a number');
  assertTokenId(b.tokenId);
  if (typeof b.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) throw new TypeError('day must be YYYY-MM-DD');
  const t = Date.parse(`${b.day}T12:00:00Z`);
  if (Number.isNaN(t) || t < now.getTime() - 2 * DAY_MS || t > now.getTime() + DAY_MS) throw new TypeError('day out of range');
  return { tokenId: b.tokenId, day: b.day, totals: parseDailyTotals(b.totals) };
}
