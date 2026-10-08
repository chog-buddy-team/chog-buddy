import { ATLAS_COLS, ATLAS_ROW_COUNT, CHOG_CONTRACT, FRAME_H, FRAME_W, type ChogMetadata } from '@chog/core';

export type PetdexManifest = {
  name: string; slug: string; description: string; source: string; spritesheet: string;
  frameWidth: number; frameHeight: number; columns: number; rows: number; formatVersion: string;
};

export const petdexFolderName = (tokenId: number) => `chog-${tokenId}`;

export function petdexManifest(meta: ChogMetadata, archetypeName: string): PetdexManifest {
  return {
    name: meta.name,
    slug: petdexFolderName(meta.tokenId),
    description: `${meta.name}, a ${archetypeName}, exported from Chog Buddy. Face from the owner's Chog Genesis NFT.`,
    source: `https://monadscan.com/token/${CHOG_CONTRACT}?a=${meta.tokenId}`,
    spritesheet: 'spritesheet.png',
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    columns: ATLAS_COLS,
    rows: ATLAS_ROW_COUNT,
    formatVersion: 'unverified-2026-10',
  };
}
