import { CATEGORIES, type Axes, type Category, type DailyTotals, type Soul } from './types';

export const MAX_DAILY_DRIFT = 3;
const MINUTES_PER_DAY = 1440;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const step = (raw: number) => clamp(Math.round(raw), -MAX_DAILY_DRIFT, MAX_DAILY_DRIFT);

export function driftAxes(a: Axes, t: DailyTotals): Axes {
  const m = t.minutes;
  return {
    nightOwl: clamp(a.nightOwl + step((t.lateMinutes - t.earlyMinutes) / 60), 0, 100),
    grinder: clamp(a.grinder + step((m.coding + m.design + m.meeting - m.video - m.idle) / 60), 0, 100),
    social: clamp(a.social + step((m.chat + m.meeting - 60) / 30), 0, 100),
    creator: clamp(a.creator + step((m.coding + m.design - m.browsing - m.video) / 60), 0, 100),
  };
}

export function nextSoul(prev: Soul | null, base: Axes, t: DailyTotals, ownerChanged: boolean): Soul {
  const start: Soul = prev ?? { ...base, level: 0, ownerCount: 0 };
  return {
    ...driftAxes(start, t),
    level: start.level + 1,
    ownerCount: start.ownerCount + (prev === null || ownerChanged ? 1 : 0),
  };
}

const isMinutes = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MINUTES_PER_DAY;

export function parseDailyTotals(x: unknown): DailyTotals {
  if (typeof x !== 'object' || x === null) throw new TypeError('totals must be an object');
  const { minutes, lateMinutes, earlyMinutes } = x as Record<string, unknown>;
  if (typeof minutes !== 'object' || minutes === null) throw new TypeError('minutes must be an object');
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const [k, v] of Object.entries(minutes)) {
    if (!(CATEGORIES as readonly string[]).includes(k)) throw new TypeError(`unknown category ${k}`);
    if (!isMinutes(v)) throw new TypeError(`bad minutes for ${k}`);
    out[k as Category] = v;
  }
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total > MINUTES_PER_DAY) throw new TypeError('more minutes than a day');
  if (!isMinutes(lateMinutes) || !isMinutes(earlyMinutes)) throw new TypeError('bad late/early minutes');
  if (lateMinutes + earlyMinutes > total) throw new TypeError('late/early exceed total');
  return { minutes: out, lateMinutes, earlyMinutes };
}
