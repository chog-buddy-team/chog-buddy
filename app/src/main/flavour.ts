import { ARCHETYPES, type ArchetypeId, type Category } from '@chog/core';
import type { Trigger } from './reactions';

export const FLAVOUR_CHANCE = 0.25;
export const FLAVOUR_TIMEOUT_MS = 3000;
export const MAX_FLAVOUR = 140;

const WHAT: Record<Trigger, string> = {
  category_switch: 'just switched to {category}',
  long_session: 'has been doing {category} for 90 minutes straight',
  idle_return: 'just came back after a break',
  late_night: 'is still up past midnight',
  morning: 'just started their day',
  focus_violation: 'opened a distraction during Focus Mode',
  pet: 'just clicked on you',
  github: 'got new GitHub notifications',
  meeting_soon: 'has a meeting in 5 minutes',
};

export function flavourPrompt(i: { chogName: string; archetype: ArchetypeId; trigger: Trigger; category: Category; template: string }): string {
  const a = ARCHETYPES[i.archetype];
  return `You are ${i.chogName}, a ${a.name}: ${a.voice}. Your owner ${WHAT[i.trigger].replace('{category}', i.category)}. Say ONE short line (max 15 words) reacting to it, in character, no quotes, no emoji spam. Example of your style: "${i.template}"`;
}

export function cleanFlavour(raw: string): string | null {
  const s = raw.replace(/[*_#`]/g, '').replace(/\s*\n\s*/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!s || s.length > MAX_FLAVOUR) return null;
  return s;
}

export async function flavourLine(i: { template: string; rand: () => number; generate: () => Promise<string> }): Promise<string> {
  if (i.rand() >= FLAVOUR_CHANCE) return i.template;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), FLAVOUR_TIMEOUT_MS));
  const gen = i.generate().then(cleanFlavour, () => null);
  return (await Promise.race([gen, timeout])) ?? i.template;
}
