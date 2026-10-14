import { describe, expect, it } from 'vitest';
import { hex } from '../src/sprite/pixels';
import { PRESET_SKINS, SKIN_IDS, isSkinId, nftSkin, outfitFor, skinFor } from '../src/sprite/skins';

const t = (o: Record<string, string>) => Object.entries(o).map(([trait_type, value]) => ({ trait_type, value }));
const palette = { skin: hex('#6a3d2b'), spike: hex('#2a2a2a'), hat: hex('#b8c4d6'), hatShade: hex('#8090a0'), outfit: hex('#b3262b'), outfitShade: hex('#7d1b1f'), shoes: hex('#3e0d0f'), ink: hex('#1b1420') };

describe('skins', () => {
  it('lists five skins and validates ids', () => {
    expect(SKIN_IDS).toEqual(['classic', 'hoodie', 'jacket', 'dress', 'nft']);
    expect(isSkinId('hoodie')).toBe(true);
    expect(isSkinId('nope')).toBe(false);
    expect(isSkinId(null)).toBe(false);
  });
  it('presets have the expected outfits and no hat', () => {
    expect(PRESET_SKINS.classic.outfit).toBe('classic');
    expect(PRESET_SKINS.hoodie.outfit).toBe('hoodie');
    expect(PRESET_SKINS.jacket.outfit).toBe('jacket');
    expect(PRESET_SKINS.dress.outfit).toBe('dress');
    for (const s of Object.values(PRESET_SKINS)) expect(s.hat).toBe('none');
  });
  it.each([['bare', 'classic'], ['suit', 'jacket'], ['robe', 'dress'], ['hoodie', 'hoodie'], ['shirt', 'tee']] as const)('outfitFor(%s) = %s', (style, outfit) => {
    expect(outfitFor(style)).toBe(outfit);
  });
  it('nft skin maps traits and sampled colours', () => {
    const s = nftSkin(t({ Body: 'Red Tuxedo', Head: 'MMGA Cap' }), palette);
    expect(s.outfit).toBe('jacket');
    expect(s.hat).toBe('cap');
    expect(s.colors.outfit).toEqual(palette.outfit);
    expect(s.colors.hat).toEqual(palette.hat);
  });
  it('nft hat close to the hood purple falls back to the default hat colours', () => {
    const s = nftSkin(t({ Head: 'MMGA Cap' }), { ...palette, hat: hex('#7a4de0'), hatShade: hex('#5a2dc0') });
    expect(s.colors.hat).toEqual(PRESET_SKINS.classic.colors.hat);
    expect(s.colors.hatShade).toEqual(PRESET_SKINS.classic.colors.hatShade);
    expect(s.colors.outfit).toEqual(palette.outfit);
  });
  it('nft skin without a palette still returns a complete skin', () => {
    const s = nftSkin(t({ Head: 'Wizard Hat' }), null);
    expect(s.outfit).toBe('classic');
    expect(s.hat).toBe('wizard');
    for (const c of Object.values(s.colors)) expect(c).toHaveLength(4);
  });
  it('skinFor picks preset or nft', () => {
    expect(skinFor('dress', { attributes: [], palette: null })).toBe(PRESET_SKINS.dress);
    expect(skinFor('nft', { attributes: t({ Head: 'Crown' }), palette: null }).hat).toBe('crown');
  });
});
