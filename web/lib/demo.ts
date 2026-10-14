import { assertTokenId, type DailyTotals } from '@chog/core';
import { sql } from './db';

// Judge Mode demo Chog (option b): the server makes up one plausible day of Activity per day, under owner 'demo',
// and the normal Soul job applies it. Today plus 8 days back = 7 days old enough to pass the 2-day lag.
export const DEMO_DAYS = 9;
export const DEMO_OWNER = 'demo';

// Deterministic per day, so re-seeding never rewrites history.
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function demoTotals(day: string): DailyTotals {
  const r = rng(day);
  const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
  const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
  const minutes = weekend
    ? { coding: between(0, 120), design: between(0, 30), chat: between(40, 140), browsing: between(60, 150), video: between(120, 240), meeting: 0, idle: between(30, 90), other: between(0, 20) }
    : { coding: between(180, 360), design: between(0, 60), chat: between(30, 120), browsing: between(30, 90), video: between(20, 80), meeting: between(0, 60), idle: between(20, 60), other: between(0, 20) };
  return {
    minutes,
    lateMinutes: r() < 0.35 ? between(30, 120) : 0,
    earlyMinutes: r() < 0.2 ? between(20, 60) : 0,
  };
}

export function demoDays(now = new Date()): string[] {
  return Array.from({ length: DEMO_DAYS }, (_, i) => new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
}

// Called by the daily cron. Existing days are left alone, so this also back-fills any days the cron missed.
export async function seedDemoActivity(tokenId: number, now = new Date()): Promise<number> {
  assertTokenId(tokenId);
  let inserted = 0;
  for (const day of demoDays(now)) {
    const rows = await sql`
      insert into activity (token_id, day, owner, totals) values (${tokenId}, ${day}, ${DEMO_OWNER}, ${JSON.stringify(demoTotals(day))})
      on conflict (token_id, day) do nothing returning 1`;
    inserted += rows.length;
  }
  return inserted;
}
