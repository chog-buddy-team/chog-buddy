import { describe, expect, it } from 'vitest';
import { PixelBuffer, hex } from '../src/sprite/pixels';
import { CANON, EYE_X, HEAD_CY, drawBody, drawCanonHead, drawHat, type Expr, type SkinColors } from '../src/sprite/canon';

const same = (a: readonly number[], b: readonly number[]) => a.every((v, i) => v === b[i]);
const count = (b: PixelBuffer, c: readonly number[]) => { let n = 0; for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (same(b.get(x, y), c)) n++; return n; };
const head = (expr: Expr, squash: 0 | 1 = 0) => { const b = new PixelBuffer(48, 52); drawCanonHead(b, HEAD_CY, expr, squash); return b; };
const colors: SkinColors = { outfit: hex('#2c5cc8'), outfitShade: hex('#1a3c8c'), pants: hex('#28304a'), hat: hex('#b8c4d6'), hatShade: hex('#3e7cc9') };

describe('fillTriangle', () => {
  it('fills inside and not outside', () => {
    const b = new PixelBuffer(10, 10);
    b.fillTriangle([0, 0], [9, 0], [0, 9], hex('#ff0000'));
    expect(b.isFilled(1, 1)).toBe(true);
    expect(b.isFilled(9, 9)).toBe(false);
  });
});

describe('drawCanonHead', () => {
  it('draws a purple hood with a cream face', () => {
    const b = head('open');
    expect(count(b, CANON.hood)).toBeGreaterThan(300);
    expect(count(b, CANON.face)).toBeGreaterThan(150);
    expect(count(b, CANON.blush)).toBeGreaterThan(6);
  });
  it('open eyes are filled ovals with white catchlights', () => {
    const b = head('open');
    const ey = HEAD_CY + 5;
    for (const ex of EYE_X) {
      expect(same(b.get(ex + 1, ey - 2), CANON.eye)).toBe(true);
      expect(same(b.get(ex - 1, ey - 2), CANON.white)).toBe(true);
    }
  });
  it('closed eyes are a single line', () => {
    const b = head('closed');
    const ey = HEAD_CY + 5;
    for (const ex of EYE_X) {
      expect(same(b.get(ex + 1, ey - 2), CANON.eye)).toBe(false);
      expect(same(b.get(ex, ey), CANON.eye)).toBe(true);
    }
  });
  it('happy and sad differ from open and from each other', () => {
    const o = head('open').data, h = head('happy').data, s = head('sad').data, t = head('talk').data;
    expect(h).not.toEqual(o);
    expect(s).not.toEqual(o);
    expect(s).not.toEqual(h);
    expect(t).not.toEqual(o);
  });
  it('every expression keeps eyes inside the cream face (no eye pixel touches hood or blush)', () => {
    for (const e of ['open', 'closed', 'happy', 'talk', 'sad'] as Expr[]) {
      const b = head(e);
      for (let y = 0; y < 52; y++) for (let x = 0; x < 48; x++) {
        if (!same(b.get(x, y), CANON.eye)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = b.get(x + dx, y + dy);
          expect(same(n, CANON.hood) || same(n, CANON.blush)).toBe(false);
        }
      }
    }
  });
  it('squash makes the hood wider', () => {
    const width = (b: PixelBuffer) => { let w = 0; const y = HEAD_CY + 1; for (let x = 0; x < 48; x++) if (b.isFilled(x, y)) w++; return w; };
    expect(width(head('open', 1))).toBeGreaterThan(width(head('open', 0)));
  });
});

describe('drawHat and drawBody', () => {
  it('every hat draws above the face and none for "none"', () => {
    for (const hat of ['cap', 'bucket', 'wizard', 'horns', 'headband', 'crown'] as const) {
      const b = new PixelBuffer(48, 52);
      drawHat(b, hat, HEAD_CY, colors.hat, colors.hatShade);
      expect(count(b, colors.hat) + count(b, colors.hatShade)).toBeGreaterThan(10);
    }
    const n = new PixelBuffer(48, 52);
    drawHat(n, 'none', HEAD_CY, colors.hat, colors.hatShade);
    expect(count(n, colors.hat)).toBe(0);
  });
  it('classic body is suit-coloured with pink hands and feet; other outfits use the outfit colour', () => {
    const c = new PixelBuffer(48, 52);
    drawBody(c, 'classic', colors, 0, { l: 0, r: 0 }, { l: 0, r: 0 });
    expect(count(c, CANON.suit)).toBeGreaterThan(80);
    expect(count(c, CANON.pink)).toBeGreaterThan(20);
    expect(count(c, colors.outfit)).toBe(0);
    for (const o of ['tee', 'hoodie', 'jacket', 'dress'] as const) {
      const b = new PixelBuffer(48, 52);
      drawBody(b, o, colors, 0, { l: 0, r: 0 }, { l: 0, r: 0 });
      expect(count(b, colors.outfit)).toBeGreaterThan(40);
    }
  });
  it('leg lift raises a foot', () => {
    const lowestPink = (b: PixelBuffer, x0: number, x1: number) => { for (let y = 51; y >= 0; y--) for (let x = x0; x <= x1; x++) if (same(b.get(x, y), CANON.pink)) return y; return -1; };
    const a = new PixelBuffer(48, 52), l = new PixelBuffer(48, 52);
    drawBody(a, 'classic', colors, 0, { l: 0, r: 0 }, { l: 0, r: 0 });
    drawBody(l, 'classic', colors, 0, { l: 2, r: 0 }, { l: 0, r: 0 });
    expect(lowestPink(a, 16, 23) - lowestPink(l, 16, 23)).toBe(2);
  });
});
