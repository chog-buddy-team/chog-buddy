import type { Trait } from '../types';

export type OutfitStyle = 'suit' | 'shirt' | 'hoodie' | 'robe' | 'bare';
export type HatStyle = 'cap' | 'bucket' | 'wizard' | 'horns' | 'headband' | 'crown' | 'none';

export const traitValue = (attributes: Trait[], type: string) => attributes.find((a) => a.trait_type === type)?.value;

export function outfitStyle(attributes: Trait[]): OutfitStyle {
  const body = traitValue(attributes, 'Body');
  if (!body || traitValue(attributes, 'Naked') === 'Yes') return 'bare';
  // Costume suits map to shirt
  if (/astro|banana|dragon|shark|toad/i.test(body)) return 'shirt';
  // Business suits
  if (/tuxedo|blazer|gangster suit/i.test(body)) return 'suit';
  if (/hoodie|jacket|zip|sweater/i.test(body)) return 'hoodie';
  if (/robe|chinese|kimono|gown|cloak|yukata|cape|wizard|jesus/i.test(body)) return 'robe';
  return 'shirt';
}

// Order matters: "Wizard Hat" and "Bucket Hat" must win before the generic cap/hat rule.
const HAT_RULES: Array<[HatStyle, RegExp]> = [
  ['wizard', /wizard/i],
  ['bucket', /bucket/i],
  ['horns', /\bhorns?\b/i],
  ['headband', /band/i],
  ['crown', /crown|halo/i],
  ['cap', /cap|hat|beanie/i],
];

export function hatStyle(attributes: Trait[]): HatStyle {
  const head = traitValue(attributes, 'Head');
  if (!head) return 'none';
  return HAT_RULES.find(([, re]) => re.test(head))?.[0] ?? 'none';
}
