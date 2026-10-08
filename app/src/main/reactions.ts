import type { ArchetypeId, Category } from '@chog/core';
import { LINES } from './lines';

export type Trigger = 'category_switch' | 'long_session' | 'idle_return' | 'late_night' | 'morning' | 'focus_violation' | 'pet';

export type ReactionState = {
  category: Category;
  since: number; // when the current category started
  idleSince: number | null;
  lastSpokeAt: number;
  lastDayGreeted: string;
  lastNightNagged: string;
  longSessionNotified: boolean;
};

export type Observation = { at: number; category: Category; hour: number; day: string };

export const COOLDOWN_MS = 3 * 60_000;
const IDLE_RETURN_MS = 10 * 60_000;
const LONG_SESSION_MS = 90 * 60_000;
const DISTRACTING: Category[] = ['video'];

export function initialState(now: number): ReactionState {
  return { category: 'other', since: now, idleSince: null, lastSpokeAt: 0, lastDayGreeted: '', lastNightNagged: '', longSessionNotified: false };
}

export function detectTrigger(prev: ReactionState, obs: Observation, focusMode: boolean): { trigger: Trigger | null; state: ReactionState } {
  const s = { ...prev };
  const active = obs.category !== 'idle';
  const switched = obs.category !== s.category;

  let returnedFromIdle = false;
  if (!active) s.idleSince ??= obs.at;
  else if (s.idleSince !== null) {
    returnedFromIdle = obs.at - s.idleSince >= IDLE_RETURN_MS;
    s.idleSince = null;
  }
  if (switched) {
    s.category = obs.category;
    s.since = obs.at;
    s.longSessionNotified = false;
  }

  // Priority order. One-time flags are only set when the trigger is actually emitted.
  const candidates: Array<[Trigger, boolean, () => void]> = [
    ['idle_return', returnedFromIdle, () => {}],
    ['focus_violation', focusMode && switched && DISTRACTING.includes(obs.category), () => {}],
    ['morning', active && obs.hour >= 5 && obs.hour < 12 && s.lastDayGreeted !== obs.day, () => (s.lastDayGreeted = obs.day)],
    ['late_night', active && obs.hour < 4 && s.lastNightNagged !== obs.day, () => (s.lastNightNagged = obs.day)],
    ['long_session', active && !s.longSessionNotified && obs.at - s.since >= LONG_SESSION_MS, () => (s.longSessionNotified = true)],
    ['category_switch', switched && active && obs.category !== 'other', () => {}],
  ];
  const hit = candidates.find(([, ok]) => ok);
  if (!hit || obs.at - s.lastSpokeAt < COOLDOWN_MS) return { trigger: null, state: s };
  hit[2]();
  s.lastSpokeAt = obs.at;
  return { trigger: hit[0], state: s };
}

export function pickLine(archetype: ArchetypeId, trigger: Trigger, category: Category, rand: () => number = Math.random): string {
  const options = LINES[archetype][trigger];
  return options[Math.floor(rand() * options.length)].replaceAll('{category}', category);
}
