import { hex } from './pixels';
import type { Trait } from '../types';
import type { ChogPalette } from './palette';
import { hatStyle, outfitStyle, type HatStyle, type OutfitStyle } from './traits';
import type { Outfit, SkinColors } from './canon';

export type Skin = { outfit: Outfit; hat: HatStyle; colors: SkinColors };
export type SkinId = 'classic' | 'hoodie' | 'jacket' | 'dress' | 'nft';
export const SKIN_IDS: SkinId[] = ['classic', 'hoodie', 'jacket', 'dress', 'nft'];
export const isSkinId = (x: unknown): x is SkinId => typeof x === 'string' && (SKIN_IDS as string[]).includes(x);

const DEFAULT_COLORS: SkinColors = { outfit: hex('#6c4ab6'), outfitShade: hex('#563a98'), pants: hex('#28304a'), hat: hex('#b8c4d6'), hatShade: hex('#3e7cc9') };

export const PRESET_SKINS: Record<Exclude<SkinId, 'nft'>, Skin> = {
  classic: { outfit: 'classic', hat: 'none', colors: DEFAULT_COLORS },
  hoodie: { outfit: 'hoodie', hat: 'none', colors: { ...DEFAULT_COLORS, outfit: hex('#2c5cc8'), outfitShade: hex('#1a3c8c') } },
  jacket: { outfit: 'jacket', hat: 'none', colors: { ...DEFAULT_COLORS, outfit: hex('#d23232'), outfitShade: hex('#3c3c46'), pants: hex('#28304a') } },
  dress: { outfit: 'dress', hat: 'none', colors: { ...DEFAULT_COLORS, outfit: hex('#bea0dc'), outfitShade: hex('#9c80bc') } },
};

export function outfitFor(style: OutfitStyle): Outfit {
  switch (style) {
    case 'bare': return 'classic';
    case 'suit': return 'jacket';
    case 'robe': return 'dress';
    case 'hoodie': return 'hoodie';
    case 'shirt': return 'tee';
  }
}

export function nftSkin(attributes: Trait[], palette: ChogPalette | null): Skin {
  const colors: SkinColors = palette
    ? { outfit: palette.outfit, outfitShade: palette.outfitShade, pants: palette.shoes, hat: palette.hat, hatShade: palette.hatShade }
    : DEFAULT_COLORS;
  return { outfit: outfitFor(outfitStyle(attributes)), hat: hatStyle(attributes), colors };
}

export function skinFor(id: SkinId, nft: { attributes: Trait[]; palette: ChogPalette | null }): Skin {
  return id === 'nft' ? nftSkin(nft.attributes, nft.palette) : PRESET_SKINS[id];
}
