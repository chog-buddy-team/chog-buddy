import type { ArchetypeId, Axes, ChogMetadata } from './types';

export const ARCHETYPES: Record<ArchetypeId, { name: string; base: Axes; voice: string }> = {
  hype: { name: 'Hype Chog', base: { nightOwl: 50, grinder: 70, social: 70, creator: 50 }, voice: 'over-the-top hype friend, loud and supportive, lots of energy' },
  grump: { name: 'Grump Chog', base: { nightOwl: 40, grinder: 60, social: 20, creator: 50 }, voice: 'grumpy and sarcastic but secretly caring, short dry sentences' },
  lazySage: { name: 'Lazy Sage', base: { nightOwl: 70, grinder: 20, social: 40, creator: 60 }, voice: 'sleepy zen philosopher, calm, short wise sentences, often yawning' },
  chaos: { name: 'Chaos Chog', base: { nightOwl: 80, grinder: 40, social: 60, creator: 70 }, voice: 'chaotic gremlin, absurd jokes, playful, unpredictable' },
  sweetheart: { name: 'Sweetheart', base: { nightOwl: 40, grinder: 50, social: 80, creator: 40 }, voice: 'warm, gentle and encouraging, checks on how you feel' },
};

const ORDER: ArchetypeId[] = ['hype', 'grump', 'lazySage', 'chaos', 'sweetheart'];

// Keywords matched (lowercase substring) against real Chog trait values.
const KEYWORDS: Record<ArchetypeId, string[]> = {
  hype: ['happy', 'laser', 'smile', 'green candle', 'fire', 'burning', 'electric', 'gold', 'mog', 'thug', 'coin'],
  grump: ['angry', 'side eye', 'flat', 'grit', 'red candle', 'knife', 'cigar', 'skull', 'smirk'],
  lazySage: ['tired', 'closed', 'drool', 'smoke', 'wind', 'cool', 'visor', 'vr', 'glass', 'mint', 'clean'],
  chaos: ['retard', 'xd', 'clown', 'puke', 'dead', 'radioactive', 'frog', 'fwog', 'pepe', 'vertical', 'multi'],
  sweetheart: ['heart', 'crying', 'tear', 'worried', 'sad', 'rose', 'pink', 'bubblegum', 'lip bite'],
};

const SCORED_TRAITS = new Set(['Eyes', 'Mouth', 'Accessory', 'Aura', 'Base', 'Skin']);

export function pickArchetype(meta: Pick<ChogMetadata, 'tokenId' | 'attributes'>): ArchetypeId {
  const scores = new Map<ArchetypeId, number>(ORDER.map((id) => [id, 0]));
  for (const { trait_type, value } of meta.attributes) {
    if (!SCORED_TRAITS.has(trait_type)) continue;
    const v = value.toLowerCase();
    for (const id of ORDER) for (const kw of KEYWORDS[id]) if (v.includes(kw)) scores.set(id, scores.get(id)! + 1);
  }
  const best = Math.max(...scores.values());
  const tied = ORDER.filter((id) => scores.get(id) === best);
  return tied[meta.tokenId % tied.length];
}
