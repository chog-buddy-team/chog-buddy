import { PixelBuffer, hex, shade, type Rgba } from './pixels';

export type Side = 'Left' | 'Right';
export type ChogPalette = { skin: Rgba; spike: Rgba; hat: Rgba; hatShade: Rgba; outfit: Rgba; outfitShade: Rgba; shoes: Rgba; ink: Rgba };
type Region = { x: number; y: number; w: number; h: number };

const R = {
  bg: { x: 0, y: 0, w: 0.04, h: 0.04 },
  skin: { x: 0.53, y: 0.43, w: 0.27, h: 0.14 },
  hat: { x: 0.4, y: 0.03, w: 0.47, h: 0.14 },
  outfit: { x: 0.05, y: 0.82, w: 0.3, h: 0.16 },
  spike: { x: 0.05, y: 0.3, w: 0.15, h: 0.32 },
} satisfies Record<string, Region>;

const INK = hex('#1b1420');
const dist = (a: Rgba, b: Rgba) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = (c: Rgba) => c[0] + c[1] + c[2];

function forSide(r: Region, side: Side): Region {
  return side === 'Left' ? { ...r, x: 1 - r.x - r.w } : r;
}

/** Average colour of the most common 4-bit bucket in a region, skipping ink-dark and avoided colours. */
function modeColor(img: PixelBuffer, r: Region, avoid: Rgba[], skipDark = true): Rgba | null {
  const x0 = Math.floor(r.x * img.width), y0 = Math.floor(r.y * img.height);
  const x1 = Math.max(x0 + 1, Math.floor((r.x + r.w) * img.width)), y1 = Math.max(y0 + 1, Math.floor((r.y + r.h) * img.height));
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  const buckets = new Map<string, { n: number; s: [number, number, number] }>();
  for (let y = y0; y < y1; y += step)
    for (let x = x0; x < x1; x += step) {
      const c = img.get(x, y);
      if (c[3] < 128 || (skipDark && lum(c) < 140) || avoid.some((a) => dist(a, c) < 55)) continue;
      const k = `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;
      const e = buckets.get(k) ?? { n: 0, s: [0, 0, 0] };
      e.n++;
      e.s = [e.s[0] + c[0], e.s[1] + c[1], e.s[2] + c[2]];
      buckets.set(k, e);
    }
  const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  return best ? [Math.round(best.s[0] / best.n), Math.round(best.s[1] / best.n), Math.round(best.s[2] / best.n), 255] : null;
}

export function samplePalette(nft: PixelBuffer, side: Side): ChogPalette {
  const bg = modeColor(nft, forSide(R.bg, side), [], false) ?? hex('#ffffff');
  const skin = modeColor(nft, forSide(R.skin, side), [bg]) ?? hex('#f0e6d6');
  const hat = modeColor(nft, forSide(R.hat, side), [bg, skin]) ?? shade(skin, 0.6);
  const outfit = modeColor(nft, forSide(R.outfit, side), [bg, skin]) ?? hex('#505a6e');
  // Spikes are often near-black, so do not skip dark pixels here; ink outline is thin enough to lose the vote.
  const spike = modeColor(nft, forSide(R.spike, side), [bg, skin, hat], false) ?? hex('#2a2a2a');
  return { skin, spike, hat, hatShade: shade(hat, 0.7), outfit, outfitShade: shade(outfit, 0.7), shoes: shade(outfit, 0.35), ink: INK };
}

/** Popularity quantizer: keep the `maxColors` most common 4-bit buckets, map every pixel to the nearest. */
export function quantize(buf: PixelBuffer, maxColors: number): PixelBuffer {
  const buckets = new Map<string, { n: number; s: [number, number, number] }>();
  for (let y = 0; y < buf.height; y++)
    for (let x = 0; x < buf.width; x++) {
      const c = buf.get(x, y);
      if (c[3] === 0) continue;
      const k = `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;
      const e = buckets.get(k) ?? { n: 0, s: [0, 0, 0] };
      e.n++;
      e.s = [e.s[0] + c[0], e.s[1] + c[1], e.s[2] + c[2]];
      buckets.set(k, e);
    }
  const pal: Rgba[] = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, maxColors)
    .map((e) => [Math.round(e.s[0] / e.n), Math.round(e.s[1] / e.n), Math.round(e.s[2] / e.n), 255]);
  const out = new PixelBuffer(buf.width, buf.height);
  for (let y = 0; y < buf.height; y++)
    for (let x = 0; x < buf.width; x++) {
      const c = buf.get(x, y);
      if (c[3] === 0) continue;
      let best = pal[0];
      for (const p of pal) if (dist(p, c) < dist(best, c)) best = p;
      out.set(x, y, best);
    }
  return out;
}
