import { CATEGORIES, type Category, type DailyTotals } from '@chog/core';

export function emptyTotals(): DailyTotals {
  return { minutes: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>, lateMinutes: 0, earlyMinutes: 0 };
}

export function addSample(t: DailyTotals, category: Category, seconds: number, hour: number): DailyTotals {
  const min = seconds / 60;
  const active = category !== 'idle';
  return {
    minutes: { ...t.minutes, [category]: t.minutes[category] + min },
    lateMinutes: t.lateMinutes + (active && (hour >= 22 || hour < 4) ? min : 0),
    earlyMinutes: t.earlyMinutes + (active && hour >= 5 && hour < 8 ? min : 0),
  };
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
