import { describe, expect, it } from 'vitest';
import { petdexFolderName, petdexManifest } from '../src/main/petdex';

const meta = { tokenId: 5, name: 'CHOG #1462', image: 'ipfs://x/1462.webp', attributes: [] };

describe('petdexManifest', () => {
  it('describes the atlas geometry and credits the NFT', () => {
    const m = petdexManifest(meta, 'Hype Chog');
    expect(m).toMatchObject({
      name: 'CHOG #1462', slug: 'chog-5', spritesheet: 'spritesheet.png',
      frameWidth: 192, frameHeight: 208, columns: 8, rows: 9, formatVersion: 'unverified-2026-10',
    });
    expect(m.description).toContain('Hype Chog');
    expect(m.source).toContain('0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763');
  });
  it('folder names are filesystem-safe', () => {
    expect(petdexFolderName(5)).toBe('chog-5');
  });
});
