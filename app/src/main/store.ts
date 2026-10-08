import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DailyTotals } from '@chog/core';
import { dayKey, emptyTotals } from './tally';

export type Settings = { tokenId: number; focusMode: boolean; today: { day: string; totals: DailyTotals } };

const DEMO_TOKEN_ID = 5; // replaced by the signed-in Owner's choice in the integration plan

export function loadSettings(dir: string): Settings {
  const defaults: Settings = { tokenId: DEMO_TOKEN_ID, focusMode: false, today: { day: dayKey(new Date()), totals: emptyTotals() } };
  try {
    return { ...defaults, ...JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) };
  } catch {
    return defaults;
  }
}

export function saveSettings(dir: string, s: Settings): void {
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(s, null, 2));
}
