import { describe, expect, it } from 'vitest';
import {
  ATLAS_COLS, ATLAS_ROWS, ATLAS_ROW_COUNT, CANON, EYE_X, FRAME_H, FRAME_W, HEAD_CY, PRESET_SKINS, PixelBuffer, REST, SPRITE_H, SPRITE_W,
  buildAtlas, crop, drawChogFrame, frameAt, type ChogParts, type HatStyle, type Outfit,
} from '../src/sprite';

const OUTFITS: Outfit[] = ['classic', 'tee', 'hoodie', 'jacket', 'dress'];
const HATS: HatStyle[] = ['cap', 'bucket', 'wizard', 'horns', 'headband', 'crown', 'none'];

function parts(outfit: Outfit = 'classic', hat: HatStyle = 'cap'): ChogParts {
  return { outfit, hat, colors: PRESET_SKINS.hoodie.colors };
}
const filled = (b: PixelBuffer) => { let n = 0; for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.isFilled(x, y)) n++; return n; };
const topmost = (x: PixelBuffer) => { for (let y = 0; y < x.height; y++) for (let i = 0; i < x.width; i++) if (x.isFilled(i, y)) return y; return -1; };
const count = (b: PixelBuffer, c: readonly number[]) => { let n = 0; for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.get(x, y).every((v, i) => v === c[i])) n++; return n; };

describe('drawChogFrame', () => {
  it('draws a 48x52 sprite with transparent corners', () => {
    const f = drawChogFrame(parts(), REST);
    expect([f.width, f.height]).toEqual([SPRITE_W, SPRITE_H]);
    expect(f.isFilled(0, SPRITE_H - 1)).toBe(false);
    expect(filled(f)).toBeGreaterThan(600);
  });
  it('shows the canonical face and hood colours on the head', () => {
    const f = drawChogFrame(parts(), REST);
    expect(count(f, CANON.face)).toBeGreaterThan(100);
    expect(count(f, CANON.hood)).toBeGreaterThan(200);
  });
  it('expr closed swaps the open eye for a line', () => {
    const open = drawChogFrame(parts(), REST);
    const closed = drawChogFrame(parts(), { ...REST, expr: 'closed' });
    expect(closed.data).not.toEqual(open.data);
    expect(open.get(EYE_X[0] + 1, HEAD_CY + 3)).toEqual(CANON.eye);
    expect(closed.get(EYE_X[0] + 1, HEAD_CY + 3)).not.toEqual(CANON.eye);
  });
  it('lift moves the whole sprite up', () => {
    const a = drawChogFrame(parts(), REST);
    const b = drawChogFrame(parts(), { ...REST, lift: 3 });
    expect(topmost(a) - topmost(b)).toBe(3);
  });
  it('every outfit and hat style draws without throwing', () => {
    for (const o of OUTFITS) for (const h of HATS) expect(filled(drawChogFrame(parts(o, h), REST))).toBeGreaterThan(500);
  });
  it('keeps every hat inside the frame at the worst atlas poses', () => {
    for (const o of OUTFITS)
      for (const h of HATS)
        for (const pose of [REST, { ...REST, lift: 3 }, { ...REST, headDy: -1 }])
          expect(topmost(drawChogFrame(parts(o, h), pose))).toBeGreaterThanOrEqual(1);
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
  it('sleep closes the eyes: its first frame differs from the first idle frame', () => {
    const first = (row: number) => crop(atlas, 0, row * FRAME_H, FRAME_W, FRAME_H).data;
    const idle = first(ATLAS_ROWS.idle.row), sleep = first(ATLAS_ROWS.sleep.row);
    expect(idle.some((v, i) => v !== sleep[i])).toBe(true);
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
