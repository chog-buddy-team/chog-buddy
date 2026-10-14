import type { DailyTotals } from '@chog/core';
import { emptyTotals } from './tally';

type Day = { day: string; totals: DailyTotals };

export const UPLOAD_EVERY_MS = 3_600_000;
export const uploadDue = (last: number, now: number) => now - last >= UPLOAD_EVERY_MS;

export function rollover(today: Day, nowDay: string): { today: Day; yesterday: Day | null } {
  if (today.day === nowDay) return { today, yesterday: null };
  return { today: { day: nowDay, totals: emptyTotals() }, yesterday: today };
}

export function uploadsFor(i: { judge: boolean; signedIn: boolean; tokenId: number; today: Day; yesterday: Day | null }) {
  if (i.judge || !i.signedIn) return [];
  return [...(i.yesterday ? [i.yesterday] : []), i.today].map((d) => ({ tokenId: i.tokenId, day: d.day, totals: d.totals }));
}
