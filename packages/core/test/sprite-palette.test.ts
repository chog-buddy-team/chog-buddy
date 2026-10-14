import { describe, expect, it } from 'vitest';
import { PixelBuffer, hex, type Rgba } from '../src/sprite/pixels';
import { samplePalette } from '../src/sprite';

// Synthetic "NFT": 100x100, pink bg, brown face block, grey hat band, red outfit corner, black spikes.
function fakeNft(mirrored = false): PixelBuffer {
  const b = new PixelBuffer(100, 100);
  b.fillRect(0, 0, 100, 100, hex('#e6a8f0'));
  const X = (x: number, w: number) => (mirrored ? 100 - x - w : x);
  b.fillRect(X(40, 50), 0, 50, 18, hex('#b8c4d6')); // hat
  b.fillRect(X(30, 66), 28, 66, 52, hex('#6a3d2b')); // face
  b.fillRect(X(70, 6), 40, 6, 6, hex('#141018')); // an "eye" on the viewer-right side
  b.fillRect(X(5, 15), 30, 15, 32, hex('#2a2a2a')); // spikes
  b.fillRect(X(5, 30), 82, 30, 18, hex('#b3262b')); // jacket
  return b;
}
const near = (a: Rgba, b: Rgba) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 20;

describe('samplePalette', () => {
  it('finds skin, hat, spikes and outfit on a Right Chog', () => {
    const p = samplePalette(fakeNft(), 'Right');
    expect(near(p.skin, hex('#6a3d2b'))).toBe(true);
    expect(near(p.hat, hex('#b8c4d6'))).toBe(true);
    expect(near(p.outfit, hex('#b3262b'))).toBe(true);
    expect(near(p.spike, hex('#2a2a2a'))).toBe(true); // spikes are sampled without the dark-pixel skip
  });
  it('mirrors regions for a Left Chog', () => {
    const p = samplePalette(fakeNft(true), 'Left');
    expect(near(p.skin, hex('#6a3d2b'))).toBe(true);
    expect(near(p.hat, hex('#b8c4d6'))).toBe(true);
    expect(near(p.outfit, hex('#b3262b'))).toBe(true);
  });
  it('falls back to defaults when every region is background', () => {
    const blank = new PixelBuffer(50, 50);
    blank.fillRect(0, 0, 50, 50, hex('#e6a8f0'));
    const p = samplePalette(blank, 'Right');
    expect(p.skin).toEqual(hex('#f0e6d6'));
    expect(p.outfit).toEqual(hex('#505a6e'));
    expect(p.spike).toEqual(hex('#2a2a2a'));
  });
});
