import { describe, expect, it } from 'vitest';
import {
  ATLAS_COLS, ATLAS_ROWS, ATLAS_ROW_COUNT, FACE_H, FACE_W, FRAME_H, FRAME_W, PixelBuffer, REST, SPRITE_H, SPRITE_W,
  buildAtlas, drawChogFrame, frameAt, hex, type ChogParts, type HatStyle, type OutfitStyle,
} from '../src/sprite';

function parts(outfit: OutfitStyle = 'suit', hat: HatStyle = 'cap'): ChogParts {
  const face = new PixelBuffer(FACE_W, FACE_H);
  face.fillRect(0, 0, FACE_W, FACE_H, hex('#6a3d2b'));
  face.fillRect(20, 6, 3, 3, hex('#000000')); // eye on viewer-right
  const c = hex('#888888');
  return { face, outfit, hat, palette: { skin: hex('#6a3d2b'), spike: hex('#2a2a2a'), hat: hex('#b8c4d6'), hatShade: c, outfit: hex('#b3262b'), outfitShade: c, shoes: c, ink: hex('#1b1420') } };
}
const filled = (b: PixelBuffer) => { let n = 0; for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.isFilled(x, y)) n++; return n; };

describe('drawChogFrame', () => {
  it('draws a 48x52 sprite with transparent corners', () => {
    const f = drawChogFrame(parts(), REST);
    expect([f.width, f.height]).toEqual([SPRITE_W, SPRITE_H]);
    expect(f.isFilled(0, SPRITE_H - 1)).toBe(false);
    expect(filled(f)).toBeGreaterThan(600);
  });
  it('puts the real face pixels on the head', () => {
    const f = drawChogFrame(parts(), REST);
    expect(f.get(10 + 21, 15 + 7)).toEqual(hex('#000000'));
  });
  it('eyesClosed hides the face eye row', () => {
    const f = drawChogFrame(parts(), { ...REST, eyesClosed: true });
    expect(f.get(10 + 21, 15 + 7)).not.toEqual(hex('#000000'));
  });
  it('lift moves the whole sprite up', () => {
    const a = drawChogFrame(parts(), REST);
    const b = drawChogFrame(parts(), { ...REST, lift: 3 });
    const topmost = (x: PixelBuffer) => { for (let y = 0; y < x.height; y++) for (let i = 0; i < x.width; i++) if (x.isFilled(i, y)) return y; return -1; };
    expect(topmost(a) - topmost(b)).toBe(3);
  });
  it('every outfit and hat style draws without throwing', () => {
    for (const o of ['suit', 'shirt', 'hoodie', 'robe', 'bare'] as const)
      for (const h of ['cap', 'bucket', 'wizard', 'horns', 'headband', 'crown', 'none'] as const)
        expect(filled(drawChogFrame(parts(o, h), REST))).toBeGreaterThan(500);
  });
  it('is deterministic', () => {
    expect(drawChogFrame(parts(), REST).data).toEqual(drawChogFrame(parts(), REST).data);
  });
});

describe('buildAtlas', () => {
  const atlas = buildAtlas(parts());
  it('is 8x9 frames of 192x208', () => {
    expect([atlas.width, atlas.height]).toEqual([ATLAS_COLS * FRAME_W, ATLAS_ROW_COUNT * FRAME_H]);
    expect([atlas.width, atlas.height]).toEqual([1536, 1872]);
  });
  it('fills exactly the frames each row declares', () => {
    for (const { row, durationsMs } of Object.values(ATLAS_ROWS))
      for (let col = 0; col < ATLAS_COLS; col++) {
        const cx = col * FRAME_W + FRAME_W / 2, cy = row * FRAME_H + FRAME_H / 2;
        expect(atlas.isFilled(cx, cy)).toBe(col < durationsMs.length);
      }
  });
  it('walkWest frames are mirrors of walkEast frames', () => {
    const e = ATLAS_ROWS.walkEast.row * FRAME_H, w = ATLAS_ROWS.walkWest.row * FRAME_H;
    for (const [x, y] of [[40, 100], [150, 60], [96, 180]])
      expect(atlas.get(x, e + y)).toEqual(atlas.get(FRAME_W - 1 - x, w + y));
  });
  it('row frame counts match the spec', () => {
    expect(Object.fromEntries(Object.entries(ATLAS_ROWS).map(([k, v]) => [k, [v.row, v.durationsMs.length]]))).toEqual({
      idle: [0, 6], walkEast: [1, 8], walkWest: [2, 8], react: [3, 4], hop: [4, 5], sleep: [5, 6], talk: [6, 6], sad: [7, 6], celebrate: [8, 6],
    });
  });
});

describe('frameAt', () => {
  it('walks through durations and loops', () => {
    const d = [100, 100, 200];
    expect(frameAt(d, 0)).toBe(0);
    expect(frameAt(d, 150)).toBe(1);
    expect(frameAt(d, 250)).toBe(2);
    expect(frameAt(d, 400)).toBe(0);
    expect(frameAt(d, -50)).toBe(0);
  });
});
