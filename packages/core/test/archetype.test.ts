import { describe, expect, it } from 'vitest';
import { ARCHETYPES, pickArchetype } from '../src/archetype';

const chog = (tokenId: number, traits: Record<string, string>) => ({
  tokenId,
  attributes: Object.entries(traits).map(([trait_type, value]) => ({ trait_type, value })),
});

describe('pickArchetype', () => {
  it('angry eyes + grit mouth = grump', () => {
    expect(pickArchetype(chog(1, { Eyes: 'Angry', Mouth: 'Grit' }))).toBe('grump');
  });
  it('happy eyes + smile = hype', () => {
    expect(pickArchetype(chog(1, { Eyes: 'Happy', Mouth: 'Smile' }))).toBe('hype');
  });
  it('tired eyes + smoke aura = lazySage', () => {
    expect(pickArchetype(chog(1, { Eyes: 'Tired', Aura: 'Smoke' }))).toBe('lazySage');
  });
  it('clown + rainbow puke = chaos', () => {
    expect(pickArchetype(chog(1, { Eyes: 'Clown Eye', Mouth: 'Rainbow Puke' }))).toBe('chaos');
  });
  it('heart eyes + teary = sweetheart', () => {
    expect(pickArchetype(chog(1, { Eyes: 'Heart', Mouth: 'Sad' }))).toBe('sweetheart');
  });
  it('ignores Background (too noisy)', () => {
    expect(pickArchetype(chog(0, { Background: 'Angry Red', Eyes: 'Happy' }))).toBe('hype');
  });
  it('no matches falls back deterministically by tokenId', () => {
    const a = pickArchetype(chog(7, { Eyes: 'Base' }));
    const b = pickArchetype(chog(7, { Eyes: 'Base' }));
    expect(a).toBe(b);
    expect(Object.keys(ARCHETYPES)).toContain(a);
  });
  it('ties break deterministically by tokenId', () => {
    const traits = { Eyes: 'Happy', Mouth: 'Grit' }; // hype 1, grump 1
    expect(pickArchetype(chog(0, traits))).toBe('hype');
    expect(pickArchetype(chog(1, traits))).toBe('grump');
  });
  it('every archetype base axis is within 0-100', () => {
    for (const { base } of Object.values(ARCHETYPES))
      for (const v of Object.values(base)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
  });
});
