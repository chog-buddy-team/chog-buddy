import { describe, expect, it } from 'vitest';
import { PixelBuffer, crop, hex, mirrorX, outline, scaleNearest, shade } from '../src/sprite/pixels';

const RED = hex('#ff0000');
const INK = hex('#000000');

describe('PixelBuffer', () => {
  it('starts transparent and sets/gets pixels', () => {
    const b = new PixelBuffer(4, 3);
    expect(b.get(1, 1)).toEqual([0, 0, 0, 0]);
    b.set(1, 1, RED);
    expect(b.get(1, 1)).toEqual([255, 0, 0, 255]);
    expect(b.isFilled(1, 1)).toBe(true);
  });
  it('ignores out-of-bounds writes and reports them unfilled', () => {
    const b = new PixelBuffer(2, 2);
    b.set(-1, 0, RED);
    b.set(2, 2, RED);
    expect(b.isFilled(-1, 0)).toBe(false);
    expect([...b.data].every((v) => v === 0)).toBe(true);
  });
  it('rejects data of the wrong length', () => {
    expect(() => new PixelBuffer(2, 2, new Uint8ClampedArray(3))).toThrow(RangeError);
  });
  it('fillEllipse fills the centre and not the corners', () => {
    const b = new PixelBuffer(10, 10);
    b.fillEllipse(5, 5, 4, 4, RED);
    expect(b.isFilled(5, 5)).toBe(true);
    expect(b.isFilled(0, 0)).toBe(false);
  });
  it('blit skips transparent pixels', () => {
    const src = new PixelBuffer(2, 1);
    src.set(0, 0, RED);
    const dst = new PixelBuffer(4, 1);
    dst.blit(src, 1, 0);
    expect(dst.isFilled(1, 0)).toBe(true);
    expect(dst.isFilled(2, 0)).toBe(false);
  });
});

describe('raster ops', () => {
  it('hex and shade', () => {
    expect(hex('#102030')).toEqual([16, 32, 48, 255]);
    expect(shade(hex('#646464'), 0.5)).toEqual([50, 50, 50, 255]);
  });
  it('crop copies a region', () => {
    const b = new PixelBuffer(4, 4);
    b.set(2, 3, RED);
    const c = crop(b, 2, 2, 2, 2);
    expect(c.width).toBe(2);
    expect(c.get(0, 1)).toEqual(RED);
  });
  it('scaleNearest multiplies size and keeps hard edges', () => {
    const b = new PixelBuffer(2, 1);
    b.set(0, 0, RED);
    const s = scaleNearest(b, 4);
    expect([s.width, s.height]).toEqual([8, 4]);
    expect(s.get(3, 3)).toEqual(RED);
    expect(s.isFilled(4, 0)).toBe(false);
  });
  it('mirrorX flips horizontally', () => {
    const b = new PixelBuffer(3, 1);
    b.set(0, 0, RED);
    expect(mirrorX(b).get(2, 0)).toEqual(RED);
  });
  it('outline rings filled pixels with ink without overwriting them', () => {
    const b = new PixelBuffer(3, 3);
    b.set(1, 1, RED);
    const o = outline(b, INK);
    expect(o.get(1, 1)).toEqual(RED);
    expect(o.get(0, 1)).toEqual(INK);
    expect(o.isFilled(0, 0)).toBe(false); // diagonal stays empty
  });
});
