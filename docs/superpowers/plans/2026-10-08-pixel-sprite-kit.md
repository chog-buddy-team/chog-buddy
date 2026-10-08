# Pixel Sprite Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating NFT picture with a walking pixel Chog. It is assembled from one shared body kit, recoloured and restyled by traits, and wears the owner's real NFT face. Every animation is packed into a Petdex/Codex-format sprite atlas.

**Architecture:**
- **`@chog/core`:** all pixel work is pure TypeScript on raw RGBA buffers (`PixelBuffer`): palette sampling, face extraction, trait→style maps, kit drawing, and the atlas build. All of it is unit-tested with vitest and has no DOM.
- **Electron main process:** downloads the NFT image bytes and chooses which animation row plays (pure `chooseAnimation`).
- **Renderer:** decodes the bytes with the browser canvas, calls core to build the atlas once per launch, and plays frames on a `<canvas>`.
- **Export:** a tray item saves the atlas plus a manifest for Codex/Petdex.

**Tech Stack:** TypeScript, vitest, Electron, esbuild (all already installed). No new dependencies.

**Spec:** `docs/designs/chog-buddy.md`, section "Pet visuals: pixel sprite kit (decided 2026-10-08)". Also `docs/adr/0004-pixel-sprite-kit-with-real-nft-face.md` and `CONTEXT.md`.

**Base:** branch `pet-app`. The existing app is Electron with walking, drag, Reactions and a tray (`app/src/main/main.ts`, `app/src/renderer/pet.ts`, `app/src/preload.ts`).

## Global Constraints

- No new npm dependencies; no paid services. Budget $0.
- Logical sprite size 48×52 px, scaled 4× nearest-neighbour to a 192×208 frame.
- Atlas: 8 columns × 9 rows of 192×208 frames = 1536×1872 PNG.
- Row map:

  | Row | Animation | Frames |
  |---|---|---|
  | 0 | idle | 6 |
  | 1 | walk east | 8 |
  | 2 | walk west | 8 (mirror of row 1) |
  | 3 | react | 4 |
  | 4 | hop | 5 |
  | 5 | sleep | 6 |
  | 6 | talk | 6 |
  | 7 | sad | 6 |
  | 8 | celebrate | 6 |

- The face comes from the owner's real NFT image, never invented. A Side=Left Chog's face is mirrored so it always looks toward viewer-right in east frames.
- Doze: owner idle ≥ 120 s → sleep animation, no walking. Pause: idle ≥ 900 s → stop frame playback, until input returns.
- Code names follow the vocabulary in `CONTEXT.md` (Chog, Pet, Traits, Archetype).
- Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **NFT image download or decode fails** (offline, gateway error, corrupt bytes): expect 3 retries, then an error box and the app quits. Never a blank or invisible Pet. Owned by Task 6, step 6.
2. **Side=Left Chog:** the face must be mirrored, so the face looks the same way as Side=Right Chogs in east frames. Test in Task 2.
3. **Missing or odd traits** (no Body, no Head, Naked=Yes, unknown values): expect fallback styles (`shirt`/`bare`, `none`) and a complete atlas, never a throw. Tests in Task 3 and Task 4.
4. **Colour sampling hits only background or ink-dark pixels** (dark-on-dark art): expect fallback palette colours, not `null` or NaN. Test in Task 2.
5. **Long idle then return:** expect sleep at 120 s, pause at 900 s, and walking again as soon as idle time drops. Test in Task 5.

---

## File Structure

```
packages/core/src/sprite/
  pixels.ts        PixelBuffer + hex/shade + crop/downscale/scale/mirror/outline (pure raster ops)
  palette.ts       samplePalette(nft, side) -> ChogPalette; quantize(buf, n)
  face.ts          extractFace(nft, side) -> 28x22 PixelBuffer
  traits.ts        outfitStyle(), hatStyle()
  kit.ts           Pose, ChogParts, drawChogFrame(parts, pose) -> 48x52 PixelBuffer
  atlas.ts         ATLAS_ROWS, buildAtlas(parts), frameAt()
  index.ts         re-exports
packages/core/src/index.ts           + export * from './sprite'
packages/core/test/sprite-*.test.ts
app/src/main/animState.ts            chooseAnimation() (pure)
app/src/main/petdex.ts               petdexManifest() (pure)
app/src/main/main.ts                 image fetch, anim loop, doze, export menu
app/src/preload.ts                   new IPC: anim, atlas-ready, atlas-error
app/src/renderer/index.html          <canvas> instead of <img>
app/src/renderer/pet.ts              build atlas, play frames
app/test/animState.test.ts, app/test/petdex.test.ts
```

---

### Task 1: PixelBuffer and raster ops

**Files:**
- Create: `packages/core/src/sprite/pixels.ts`, `packages/core/src/sprite/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/sprite-pixels.test.ts`

**Interfaces:**
- Produces:
  - `type Rgba = readonly [number, number, number, number]`
  - `class PixelBuffer { width; height; data: Uint8ClampedArray; get(x,y): Rgba; set(x,y,c: Rgba): void; isFilled(x,y): boolean; fillRect(x,y,w,h,c): void; fillEllipse(cx,cy,rx,ry,c): void; blit(src, dx, dy, mask?: (x:number,y:number)=>boolean): void }`
  - `hex(h: string): Rgba`, `shade(c: Rgba, f: number): Rgba`
  - `crop(buf, x, y, w, h): PixelBuffer`, `downscaleBox(buf, w, h): PixelBuffer`, `scaleNearest(buf, k): PixelBuffer`, `mirrorX(buf): PixelBuffer`, `outline(buf, ink: Rgba): PixelBuffer`

- [ ] **Step 1: Write the failing test**

`packages/core/test/sprite-pixels.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { PixelBuffer, crop, downscaleBox, hex, mirrorX, outline, scaleNearest, shade } from '../src/sprite/pixels';

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
  it('blit skips transparent pixels and respects the mask', () => {
    const src = new PixelBuffer(2, 1);
    src.set(0, 0, RED);
    const dst = new PixelBuffer(4, 1);
    dst.blit(src, 1, 0);
    expect(dst.isFilled(1, 0)).toBe(true);
    expect(dst.isFilled(2, 0)).toBe(false);
    const masked = new PixelBuffer(4, 1);
    masked.blit(src, 1, 0, () => false);
    expect(masked.isFilled(1, 0)).toBe(false);
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
  it('downscaleBox averages blocks', () => {
    const b = new PixelBuffer(2, 2);
    b.fillRect(0, 0, 2, 2, hex('#000000'));
    b.set(0, 0, hex('#ffffff'));
    const d = downscaleBox(b, 1, 1);
    expect(d.get(0, 0)[0]).toBe(64);
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w @chog/core`
Expected: FAIL. Vitest cannot resolve `../src/sprite/pixels`.

- [ ] **Step 3: Implement**

`packages/core/src/sprite/pixels.ts`:
```ts
export type Rgba = readonly [number, number, number, number];

export class PixelBuffer {
  readonly data: Uint8ClampedArray;

  constructor(readonly width: number, readonly height: number, data?: Uint8ClampedArray) {
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
    if (this.data.length !== width * height * 4) throw new RangeError(`expected ${width * height * 4} bytes, got ${this.data.length}`);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Rgba {
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  set(x: number, y: number, c: Rgba): void {
    if (!this.inBounds(x, y)) return;
    this.data.set(c, (y * this.width + x) * 4);
  }

  isFilled(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.data[(y * this.width + x) * 4 + 3] > 0;
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.set(xx, yy, c);
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, c: Rgba): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, c);
      }
  }

  blit(src: PixelBuffer, dx: number, dy: number, mask?: (x: number, y: number) => boolean): void {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        if (c[3] === 0) continue;
        const tx = dx + x;
        const ty = dy + y;
        if (mask && !mask(tx, ty)) continue;
        this.set(tx, ty, c);
      }
  }
}

export function hex(h: string): Rgba {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function shade(c: Rgba, f: number): Rgba {
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return [k(c[0]), k(c[1]), k(c[2]), c[3]];
}

export function crop(buf: PixelBuffer, x: number, y: number, w: number, h: number): PixelBuffer {
  const out = new PixelBuffer(w, h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (buf.inBounds(x + xx, y + yy)) out.set(xx, yy, buf.get(x + xx, y + yy));
  return out;
}

export function downscaleBox(buf: PixelBuffer, w: number, h: number): PixelBuffer {
  const out = new PixelBuffer(w, h);
  const sx = buf.width / w;
  const sy = buf.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
          const c = buf.get(xx, yy);
          for (let i = 0; i < 4; i++) acc[i] += c[i];
          n++;
        }
      if (n) out.set(x, y, [acc[0] / n, acc[1] / n, acc[2] / n, acc[3] / n].map(Math.round) as unknown as Rgba);
    }
  return out;
}

export function scaleNearest(buf: PixelBuffer, k: number): PixelBuffer {
  const out = new PixelBuffer(buf.width * k, buf.height * k);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.set(x, y, buf.get(Math.floor(x / k), Math.floor(y / k)));
  return out;
}

export function mirrorX(buf: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(buf.width, buf.height);
  for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) out.set(buf.width - 1 - x, y, buf.get(x, y));
  return out;
}

/** 1px 4-neighbour ink ring around every filled pixel (cel-art outline). */
export function outline(buf: PixelBuffer, ink: Rgba): PixelBuffer {
  const out = new PixelBuffer(buf.width, buf.height, new Uint8ClampedArray(buf.data));
  for (let y = 0; y < buf.height; y++)
    for (let x = 0; x < buf.width; x++) {
      if (buf.isFilled(x, y)) continue;
      if (buf.isFilled(x - 1, y) || buf.isFilled(x + 1, y) || buf.isFilled(x, y - 1) || buf.isFilled(x, y + 1)) out.set(x, y, ink);
    }
  return out;
}
```

`packages/core/src/sprite/index.ts`:
```ts
export * from './pixels';
```

Append to `packages/core/src/index.ts`:
```ts
export * from './sprite';
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test -w @chog/core && npm run typecheck -w @chog/core`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sprite packages/core/src/index.ts packages/core/test/sprite-pixels.test.ts
git commit -m "feat(core): PixelBuffer raster ops for the sprite kit"
```

---

### Task 2: Palette sampling, quantize, face extraction

**Files:**
- Create: `packages/core/src/sprite/palette.ts`, `packages/core/src/sprite/face.ts`
- Modify: `packages/core/src/sprite/index.ts`
- Test: `packages/core/test/sprite-palette.test.ts`

**Interfaces:**
- Consumes: Task 1 `PixelBuffer`, `Rgba`, `hex`, `shade`, `crop`, `downscaleBox`, `mirrorX`.
- Produces:
  - `type Side = 'Left' | 'Right'`
  - `type ChogPalette = { skin: Rgba; spike: Rgba; hat: Rgba; hatShade: Rgba; outfit: Rgba; outfitShade: Rgba; shoes: Rgba; ink: Rgba }`
  - `samplePalette(nft: PixelBuffer, side: Side): ChogPalette`
  - `quantize(buf: PixelBuffer, maxColors: number): PixelBuffer`
  - `FACE_W = 28`, `FACE_H = 22`, `FACE_BOX = { x: 0.30, y: 0.28, w: 0.66, h: 0.52 }`
  - `extractFace(nft: PixelBuffer, side: Side): PixelBuffer` (28×22)

The sampling regions are in normalized image coordinates for a Side=Right Chog. They were measured on tokens #5, #300 and #77, all Origin base:
- face skin `{x:.53,y:.43,w:.27,h:.14}`
- hat `{x:.40,y:.03,w:.47,h:.14}`
- outfit, from the jacket side at the bottom-left `{x:.05,y:.82,w:.30,h:.16}`
- spikes `{x:.05,y:.30,w:.15,h:.32}`
- background `{x:0,y:0,w:.04,h:.04}`

For Side=Left, mirror each region's x as `1 - x - w`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/sprite-palette.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { PixelBuffer, hex, type Rgba } from '../src/sprite/pixels';
import { FACE_H, FACE_W, extractFace, quantize, samplePalette } from '../src/sprite';

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
    expect(near(p.outfit, hex('#b3262b'))).toBe(true);
  });
  it('falls back to defaults when every region is background', () => {
    const blank = new PixelBuffer(50, 50);
    blank.fillRect(0, 0, 50, 50, hex('#e6a8f0'));
    const p = samplePalette(blank, 'Right');
    for (const c of Object.values(p)) for (const v of c) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('quantize', () => {
  it('limits distinct opaque colours', () => {
    const b = new PixelBuffer(16, 1);
    for (let x = 0; x < 16; x++) b.set(x, 0, [x * 16, 0, 0, 255]);
    const q = quantize(b, 4);
    const distinct = new Set<string>();
    for (let x = 0; x < 16; x++) distinct.add(q.get(x, 0).join());
    expect(distinct.size).toBeLessThanOrEqual(4);
  });
});

describe('extractFace', () => {
  it('returns a FACE_W x FACE_H opaque buffer', () => {
    const f = extractFace(fakeNft(), 'Right');
    expect([f.width, f.height]).toEqual([FACE_W, FACE_H]);
    expect(f.get(0, 0)[3]).toBe(255);
  });
  it('mirrors a Left Chog so the eye lands on the same side as a Right Chog', () => {
    const r = extractFace(fakeNft(false), 'Right');
    const l = extractFace(fakeNft(true), 'Left');
    const darkCols = (f: ReturnType<typeof extractFace>) => {
      const cols: number[] = [];
      for (let x = 0; x < f.width; x++) for (let y = 0; y < f.height; y++) if (f.get(x, y)[0] < 60) cols.push(x);
      return cols.reduce((a, b) => a + b, 0) / cols.length;
    };
    expect(Math.abs(darkCols(r) - darkCols(l))).toBeLessThan(2);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w @chog/core`
Expected: FAIL. `samplePalette` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/sprite/palette.ts`:
```ts
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
      if (c[3] < 128 || (skipDark && lum(c) < 140) || avoid.some((a) => dist(a, c) < 80)) continue;
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
```

`packages/core/src/sprite/face.ts`:
```ts
import { crop, downscaleBox, mirrorX, type PixelBuffer } from './pixels';
import { quantize, type Side } from './palette';

export const FACE_W = 28;
export const FACE_H = 22;
/** Face window inside the NFT art for a Side=Right Chog, clear of the cropped frame edges. */
export const FACE_BOX = { x: 0.3, y: 0.28, w: 0.66, h: 0.52 };

export function extractFace(nft: PixelBuffer, side: Side): PixelBuffer {
  const bx = side === 'Left' ? 1 - FACE_BOX.x - FACE_BOX.w : FACE_BOX.x;
  const region = crop(
    nft,
    Math.round(bx * nft.width),
    Math.round(FACE_BOX.y * nft.height),
    Math.round(FACE_BOX.w * nft.width),
    Math.round(FACE_BOX.h * nft.height),
  );
  const small = quantize(downscaleBox(region, FACE_W, FACE_H), 12);
  // Normalise orientation: every face looks toward viewer-right, like a Side=Right Chog.
  return side === 'Left' ? mirrorX(small) : small;
}
```

`packages/core/src/sprite/index.ts`:
```ts
export * from './pixels';
export * from './palette';
export * from './face';
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test -w @chog/core && npm run typecheck -w @chog/core`
Expected: PASS.

- [ ] **Step 5: Smoke-test on a real Chog**

Run from repo root:
```bash
cd packages/core && npx tsx -e "
import { fetchChogMetadata, ipfsToHttp } from './src/chain';
const m = await fetchChogMetadata(5); console.log(ipfsToHttp(m.image));"
```
Expected: an `https://chog-genesis.mypinata.cloud/ipfs/.../NNNN.webp` URL. Image decoding needs a canvas, so the real visual check happens in Task 6.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sprite packages/core/test/sprite-palette.test.ts
git commit -m "feat(core): sample Chog palette and extract the real NFT face"
```

---

### Task 3: Trait → part style maps

**Files:**
- Create: `packages/core/src/sprite/traits.ts`
- Modify: `packages/core/src/sprite/index.ts`
- Test: `packages/core/test/sprite-traits.test.ts`

**Interfaces:**
- Consumes: `Trait` from `packages/core/src/types.ts`.
- Produces:
  - `type OutfitStyle = 'suit' | 'shirt' | 'hoodie' | 'robe' | 'bare'`
  - `type HatStyle = 'cap' | 'bucket' | 'wizard' | 'horns' | 'headband' | 'crown' | 'none'`
  - `traitValue(attributes: Trait[], type: string): string | undefined`
  - `outfitStyle(attributes: Trait[]): OutfitStyle`
  - `hatStyle(attributes: Trait[]): HatStyle`

- [ ] **Step 1: Write the failing test**

`packages/core/test/sprite-traits.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hatStyle, outfitStyle, traitValue } from '../src/sprite';

const t = (o: Record<string, string>) => Object.entries(o).map(([trait_type, value]) => ({ trait_type, value }));

describe('outfitStyle', () => {
  it.each([
    ['Red Tuxedo', 'suit'],
    ['Black Blazer', 'suit'],
    ['Grey Hoodie', 'hoodie'],
    ['Blue Chinese', 'robe'],
    ['Hawaiian Polo', 'shirt'],
    ['Stripes', 'shirt'],
    ['Guko', 'shirt'],
  ])('%s -> %s', (body, style) => {
    expect(outfitStyle(t({ Body: body }))).toBe(style);
  });
  it('Naked=Yes or no Body is bare', () => {
    expect(outfitStyle(t({ Body: 'Red Tuxedo', Naked: 'Yes' }))).toBe('bare');
    expect(outfitStyle([])).toBe('bare');
  });
});

describe('hatStyle', () => {
  it.each([
    ['MMGA Cap', 'cap'],
    ['Thunder Cap', 'cap'],
    ['Wizard Hat', 'wizard'],
    ['Blue Bucket Hat', 'bucket'],
    ['Red Horn', 'horns'],
    ['Red Headband', 'headband'],
    ['Gold Crown', 'crown'],
    ['Something New', 'none'],
  ])('%s -> %s', (head, style) => {
    expect(hatStyle(t({ Head: head }))).toBe(style);
  });
  it('no Head trait is none', () => {
    expect(hatStyle([])).toBe('none');
  });
});

describe('traitValue', () => {
  it('finds a value case-sensitively by type', () => {
    expect(traitValue(t({ Side: 'Left' }), 'Side')).toBe('Left');
    expect(traitValue(t({ Side: 'Left' }), 'Body')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w @chog/core`
Expected: FAIL. `outfitStyle` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/sprite/traits.ts`:
```ts
import type { Trait } from '../types';

export type OutfitStyle = 'suit' | 'shirt' | 'hoodie' | 'robe' | 'bare';
export type HatStyle = 'cap' | 'bucket' | 'wizard' | 'horns' | 'headband' | 'crown' | 'none';

export const traitValue = (attributes: Trait[], type: string) => attributes.find((a) => a.trait_type === type)?.value;

export function outfitStyle(attributes: Trait[]): OutfitStyle {
  const body = traitValue(attributes, 'Body');
  if (!body || traitValue(attributes, 'Naked') === 'Yes') return 'bare';
  if (/tuxedo|suit|blazer/i.test(body)) return 'suit';
  if (/hoodie|jacket|zip|sweater/i.test(body)) return 'hoodie';
  if (/robe|chinese|kimono|gown|cloak/i.test(body)) return 'robe';
  return 'shirt';
}

// Order matters: "Wizard Hat" and "Bucket Hat" must win before the generic cap/hat rule.
const HAT_RULES: Array<[HatStyle, RegExp]> = [
  ['wizard', /wizard/i],
  ['bucket', /bucket/i],
  ['horns', /horn/i],
  ['headband', /band|bandana/i],
  ['crown', /crown|halo/i],
  ['cap', /cap|hat|beanie/i],
];

export function hatStyle(attributes: Trait[]): HatStyle {
  const head = traitValue(attributes, 'Head');
  if (!head) return 'none';
  return HAT_RULES.find(([, re]) => re.test(head))?.[0] ?? 'none';
}
```

Append to `packages/core/src/sprite/index.ts`:
```ts
export * from './traits';
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test -w @chog/core && npm run typecheck -w @chog/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sprite packages/core/test/sprite-traits.test.ts
git commit -m "feat(core): map Body and Head traits to sprite part styles"
```

---

### Task 4: Body kit drawing and the atlas

**Files:**
- Create: `packages/core/src/sprite/kit.ts`, `packages/core/src/sprite/atlas.ts`
- Modify: `packages/core/src/sprite/index.ts`
- Test: `packages/core/test/sprite-kit.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`PixelBuffer`, `outline`, `mirrorX`, `scaleNearest`, `ChogPalette`, `FACE_W`, `FACE_H`, `OutfitStyle`, `HatStyle`).
- Produces:
  - `SPRITE_W = 48`, `SPRITE_H = 52`
  - `type Pose = { lift: number; headDy: number; bodyDy: number; legL: number; legR: number; armL: number; armR: number; squash: 0 | 1; eyesClosed: boolean }`
  - `REST: Pose`
  - `type ChogParts = { palette: ChogPalette; face: PixelBuffer; outfit: OutfitStyle; hat: HatStyle }`
  - `drawChogFrame(parts: ChogParts, pose: Pose): PixelBuffer` (48×52)
  - `FRAME_W = 192`, `FRAME_H = 208`, `ATLAS_COLS = 8`, `ATLAS_ROW_COUNT = 9`
  - `type AnimName = 'idle' | 'walkEast' | 'walkWest' | 'react' | 'hop' | 'sleep' | 'talk' | 'sad' | 'celebrate'`
  - `ATLAS_ROWS: Record<AnimName, { row: number; durationsMs: number[] }>`
  - `buildAtlas(parts: ChogParts): PixelBuffer` (1536×1872)
  - `frameAt(durationsMs: number[], elapsedMs: number): number`

Kit layout, in logical px with the head centre at (24, 24):
- **Head:** ellipse with radii 17×14.
- **Face window:** x 10..37, y 15..36 (28×22), masked to the head ellipse shrunk by 1 px.
- **Spikes:** 3 per side, based at x 8 and x 40, swept up and back.
- **Torso:** ellipse at (24, 43) with radii 10×6.
- **Arms:** ellipses at x 13 and x 35.
- **Legs:** start at y 46. Feet at y 50.
- **Hat:** sits on the head top, at y = 24 − 14 = 10.

- [ ] **Step 1: Write the failing test**

`packages/core/test/sprite-kit.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w @chog/core`
Expected: FAIL. `drawChogFrame` is not exported.

- [ ] **Step 3: Implement the kit**

`packages/core/src/sprite/kit.ts`:
```ts
import { PixelBuffer, outline, type Rgba } from './pixels';
import { FACE_H, FACE_W } from './face';
import type { ChogPalette } from './palette';
import type { HatStyle, OutfitStyle } from './traits';

export const SPRITE_W = 48;
export const SPRITE_H = 52;

export type Pose = { lift: number; headDy: number; bodyDy: number; legL: number; legR: number; armL: number; armR: number; squash: 0 | 1; eyesClosed: boolean };
export const REST: Pose = { lift: 0, headDy: 0, bodyDy: 0, legL: 0, legR: 0, armL: 0, armR: 0, squash: 0, eyesClosed: false };

export type ChogParts = { palette: ChogPalette; face: PixelBuffer; outfit: OutfitStyle; hat: HatStyle };

const CX = 24;
const HEAD_CY = 24;
const HEAD_RX = 17;
const HEAD_RY = 14;
const FACE_X = CX - FACE_W / 2; // 10
const FACE_Y = 15;
const WHITE: Rgba = [245, 245, 245, 255];

function spike(b: PixelBuffer, baseX: number, baseY: number, dir: -1 | 1, len: number, c: Rgba) {
  for (let k = 0; k <= len; k++) {
    const half = Math.round((len - k) / 3);
    b.fillRect(baseX + dir * k, baseY - half - Math.round(k * 0.5), 1, 2 * half + 1, c);
  }
}

function drawLegs(b: PixelBuffer, p: ChogParts, pose: Pose, oy: number) {
  for (const [x, lift] of [[18, pose.legL], [26, pose.legR]] as const) {
    b.fillRect(x, oy + 46 - lift, 4, 4, p.palette.outfitShade);
    b.fillEllipse(x + 2, oy + 50.5 - lift, 3, 1.5, p.palette.shoes);
  }
}

function drawTorso(b: PixelBuffer, p: ChogParts, oy: number) {
  const { outfit, outfitShade, skin } = p.palette;
  const y = oy + 43;
  if (p.outfit === 'robe') b.fillRect(15, y - 4, 18, 10, outfit);
  b.fillEllipse(CX, y, 10, 6, p.outfit === 'bare' ? skin : outfit);
  if (p.outfit === 'suit') {
    b.fillRect(22, y - 6, 4, 7, WHITE);
    b.fillRect(23, y - 5, 2, 5, outfitShade);
  } else if (p.outfit === 'hoodie') {
    b.fillRect(17, y - 6, 14, 2, outfitShade);
    b.fillRect(23, y - 4, 1, 6, outfitShade);
  } else if (p.outfit === 'shirt') {
    b.fillRect(16, y - 1, 16, 1, outfitShade);
    b.fillRect(16, y + 2, 16, 1, outfitShade);
  }
}

function drawArms(b: PixelBuffer, p: ChogParts, pose: Pose, oy: number) {
  const sleeve = p.outfit === 'bare' ? p.palette.skin : p.palette.outfitShade;
  for (const [x, dy] of [[13, pose.armL], [35, pose.armR]] as const) {
    b.fillEllipse(x, oy + 42 + dy, 3, 4, sleeve);
    b.fillEllipse(x, oy + 45 + dy, 2, 2, p.palette.skin);
  }
}

function drawHead(b: PixelBuffer, p: ChogParts, pose: Pose, oy: number) {
  const cy = oy + HEAD_CY + pose.headDy;
  const rx = HEAD_RX + pose.squash;
  const ry = HEAD_RY - pose.squash;
  for (let i = 0; i < 3; i++) {
    spike(b, CX - 16, cy - 6 + i * 6, -1, 6 - i, p.palette.spike);
    spike(b, CX + 16, cy - 6 + i * 6, 1, 6 - i, p.palette.spike);
  }
  b.fillEllipse(CX, cy, rx, ry, p.palette.skin);
  const inHead = (x: number, y: number) => {
    const nx = (x + 0.5 - CX) / (rx - 1);
    const ny = (y + 0.5 - cy) / (ry - 1);
    return nx * nx + ny * ny <= 1;
  };
  b.blit(p.face, FACE_X, cy - HEAD_CY + FACE_Y, inHead);
  if (pose.eyesClosed) {
    const ey = cy - HEAD_CY + FACE_Y;
    b.fillRect(FACE_X, ey + 4, FACE_W, 7, p.palette.skin);
    b.fillRect(FACE_X + 4, ey + 8, 6, 1, p.palette.ink);
    b.fillRect(FACE_X + 17, ey + 8, 6, 1, p.palette.ink);
  }
  drawHat(b, p, cy - ry);
}

function drawHat(b: PixelBuffer, p: ChogParts, top: number) {
  const { hat, hatShade } = p.palette;
  switch (p.hat) {
    case 'cap':
      b.fillEllipse(CX, top + 3, 16, 6, hat);
      b.fillEllipse(CX + 3, top + 8, 17, 2, hatShade);
      break;
    case 'bucket':
      b.fillEllipse(CX, top + 2, 13, 6, hat);
      b.fillEllipse(CX, top + 7, 20, 2.5, hatShade);
      break;
    case 'wizard':
      for (let k = 0; k <= 12; k++) {
        const w = Math.round(k * 0.9);
        b.fillRect(CX - w, top - 9 + k, 2 * w + 1, 1, hat);
      }
      b.fillEllipse(CX, top + 4, 17, 2.5, hatShade);
      break;
    case 'horns':
      spike(b, CX - 9, top + 3, -1, 6, hat);
      spike(b, CX + 9, top + 3, 1, 6, hat);
      break;
    case 'headband':
      b.fillRect(CX - 17, top + 6, 34, 3, hat);
      break;
    case 'crown':
      b.fillRect(CX - 9, top - 1, 18, 4, hat);
      for (const x of [CX - 9, CX - 1, CX + 7]) b.fillRect(x, top - 4, 2, 3, hat);
      break;
    case 'none':
      break;
  }
}

export function drawChogFrame(parts: ChogParts, pose: Pose): PixelBuffer {
  const b = new PixelBuffer(SPRITE_W, SPRITE_H);
  const oy = -pose.lift;
  drawLegs(b, parts, pose, oy + pose.bodyDy);
  drawTorso(b, parts, oy + pose.bodyDy);
  drawArms(b, parts, pose, oy + pose.bodyDy);
  drawHead(b, parts, pose, oy);
  return outline(b, parts.palette.ink);
}
```

The `lift` test compares the topmost filled row (cap outline at y 6 → 3), which never clips at lift 3. The bottom row is not used, because at lift 0 the feet sit on the last row and their outline falls outside the buffer.

- [ ] **Step 4: Implement the atlas**

`packages/core/src/sprite/atlas.ts`:
```ts
import { PixelBuffer, mirrorX, scaleNearest } from './pixels';
import { REST, SPRITE_H, SPRITE_W, drawChogFrame, type ChogParts, type Pose } from './kit';

export const FRAME_W = 192;
export const FRAME_H = 208;
export const ATLAS_COLS = 8;
export const ATLAS_ROW_COUNT = 9;
const SCALE = FRAME_W / SPRITE_W; // 4 (SPRITE_H * 4 = 208)

export type AnimName = 'idle' | 'walkEast' | 'walkWest' | 'react' | 'hop' | 'sleep' | 'talk' | 'sad' | 'celebrate';

type RowSpec = { row: number; durationsMs: number[]; poses: Partial<Pose>[]; mirror?: boolean };

const WALK: Partial<Pose>[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
  const cycle = [0, 1, 2, 1, 0, 0, 0, 0];
  const legL = cycle[i];
  const legR = cycle[(i + 4) % 8];
  return { legL, legR, bodyDy: legL || legR ? -1 : 0, armL: legR ? -1 : 0, armR: legL ? -1 : 0 };
});

const ROWS: Record<AnimName, RowSpec> = {
  idle: { row: 0, durationsMs: [280, 110, 110, 140, 140, 320], poses: [{}, { headDy: -1 }, { headDy: -1 }, {}, {}, { eyesClosed: true }] },
  walkEast: { row: 1, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220], poses: WALK },
  walkWest: { row: 2, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220], poses: WALK, mirror: true },
  react: { row: 3, durationsMs: [140, 140, 140, 280], poses: [{ squash: 1 }, { headDy: 1, squash: 1 }, { lift: 2, armL: -2, armR: -2 }, {}] },
  hop: { row: 4, durationsMs: [140, 140, 140, 140, 280], poses: [{ squash: 1 }, { lift: 3 }, { lift: 5, armL: -2, armR: -2 }, { lift: 3 }, { squash: 1 }] },
  sleep: { row: 5, durationsMs: [400, 400, 400, 400, 400, 400], poses: [0, 0, 1, 1, 1, 0].map((d) => ({ headDy: d, eyesClosed: true })) },
  talk: { row: 6, durationsMs: [150, 150, 150, 150, 150, 280], poses: [-3, -4, -3, -4, -3, 0].map((a, i) => ({ armR: a, headDy: i % 2 ? -1 : 0 })) },
  sad: { row: 7, durationsMs: [300, 300, 300, 300, 300, 300], poses: [0, 0, 1, 1, 0, 0].map((d) => ({ headDy: 1 + d, armL: 1, armR: 1 })) },
  celebrate: { row: 8, durationsMs: [150, 150, 150, 150, 150, 280], poses: [0, 3, 5, 3, 0, 0].map((l) => ({ lift: l, armL: -4, armR: -4 })) },
};

export const ATLAS_ROWS: Record<AnimName, { row: number; durationsMs: number[] }> = Object.fromEntries(
  Object.entries(ROWS).map(([k, v]) => [k, { row: v.row, durationsMs: v.durationsMs }]),
) as Record<AnimName, { row: number; durationsMs: number[] }>;

export function buildAtlas(parts: ChogParts): PixelBuffer {
  if (SPRITE_H * SCALE !== FRAME_H) throw new Error('sprite/frame aspect mismatch');
  const atlas = new PixelBuffer(ATLAS_COLS * FRAME_W, ATLAS_ROW_COUNT * FRAME_H);
  for (const spec of Object.values(ROWS))
    spec.poses.forEach((p, col) => {
      let frame = drawChogFrame(parts, { ...REST, ...p });
      if (spec.mirror) frame = mirrorX(frame);
      atlas.blit(scaleNearest(frame, SCALE), col * FRAME_W, spec.row * FRAME_H);
    });
  return atlas;
}

export function frameAt(durationsMs: number[], elapsedMs: number): number {
  const total = durationsMs.reduce((a, b) => a + b, 0);
  let t = ((Math.max(0, elapsedMs) % total) + total) % total;
  for (let i = 0; i < durationsMs.length; i++) {
    if (t < durationsMs[i]) return i;
    t -= durationsMs[i];
  }
  return durationsMs.length - 1;
}
```

Append to `packages/core/src/sprite/index.ts`:
```ts
export * from './kit';
export * from './atlas';
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npm test -w @chog/core && npm run typecheck -w @chog/core`
Expected: PASS. `buildAtlas` takes a few hundred ms; that's fine.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sprite packages/core/test/sprite-kit.test.ts
git commit -m "feat(core): pixel Chog body kit and Petdex-format atlas"
```

---

### Task 5: Animation chooser (doze, pause, react, talk)

**Files:**
- Create: `app/src/main/animState.ts`
- Test: `app/test/animState.test.ts`

**Interfaces:**
- Consumes: `AnimName` from `@chog/core`.
- Produces:
  - `DOZE_SEC = 120`, `PAUSE_SEC = 900`, `REACT_MS = 700`, `TALK_MS = 2500`
  - `type AnimInput = { now: number; walking: boolean; dir: 1 | -1; dragging: boolean; userIdleSec: number; reactUntil: number; talkUntil: number }`
  - `chooseAnimation(i: AnimInput): { anim: AnimName; paused: boolean; canWalk: boolean }`

- [ ] **Step 1: Write the failing test**

`app/test/animState.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DOZE_SEC, PAUSE_SEC, chooseAnimation, type AnimInput } from '../src/main/animState';

const base: AnimInput = { now: 1000, walking: true, dir: 1, dragging: false, userIdleSec: 0, reactUntil: 0, talkUntil: 0 };

describe('chooseAnimation', () => {
  it('walks east/west while walking', () => {
    expect(chooseAnimation(base).anim).toBe('walkEast');
    expect(chooseAnimation({ ...base, dir: -1 }).anim).toBe('walkWest');
  });
  it('idles while the walker is paused', () => {
    expect(chooseAnimation({ ...base, walking: false }).anim).toBe('idle');
  });
  it('dozes after DOZE_SEC and stops walking', () => {
    const r = chooseAnimation({ ...base, userIdleSec: DOZE_SEC });
    expect(r).toEqual({ anim: 'sleep', paused: false, canWalk: false });
  });
  it('pauses playback after PAUSE_SEC', () => {
    expect(chooseAnimation({ ...base, userIdleSec: PAUSE_SEC })).toEqual({ anim: 'sleep', paused: true, canWalk: false });
  });
  it('wakes as soon as the owner is active again', () => {
    expect(chooseAnimation({ ...base, userIdleSec: 3 }).anim).toBe('walkEast');
  });
  it('drag shows hop, react beats talk, talk beats walk', () => {
    expect(chooseAnimation({ ...base, dragging: true }).anim).toBe('hop');
    expect(chooseAnimation({ ...base, reactUntil: 2000, talkUntil: 2000 }).anim).toBe('react');
    expect(chooseAnimation({ ...base, talkUntil: 2000 })).toEqual({ anim: 'talk', paused: false, canWalk: false });
  });
  it('a poke wakes a dozing Chog for the react window', () => {
    expect(chooseAnimation({ ...base, userIdleSec: DOZE_SEC + 10, reactUntil: 2000 }).anim).toBe('react');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL. Vitest cannot resolve `../src/main/animState`.

- [ ] **Step 3: Implement**

`app/src/main/animState.ts`:
```ts
import type { AnimName } from '@chog/core';

export const DOZE_SEC = 120;
export const PAUSE_SEC = 900;
export const REACT_MS = 700;
export const TALK_MS = 2500;

export type AnimInput = { now: number; walking: boolean; dir: 1 | -1; dragging: boolean; userIdleSec: number; reactUntil: number; talkUntil: number };

export function chooseAnimation(i: AnimInput): { anim: AnimName; paused: boolean; canWalk: boolean } {
  if (i.dragging) return { anim: 'hop', paused: false, canWalk: false };
  if (i.now < i.reactUntil) return { anim: 'react', paused: false, canWalk: false };
  if (i.userIdleSec >= PAUSE_SEC) return { anim: 'sleep', paused: true, canWalk: false };
  if (i.userIdleSec >= DOZE_SEC) return { anim: 'sleep', paused: false, canWalk: false };
  if (i.now < i.talkUntil) return { anim: 'talk', paused: false, canWalk: false };
  if (i.walking) return { anim: i.dir === 1 ? 'walkEast' : 'walkWest', paused: false, canWalk: true };
  return { anim: 'idle', paused: false, canWalk: true };
}
```

Note: `canWalk` is true for idle, so the walker can leave its pause.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/animState.ts app/test/animState.test.ts
git commit -m "feat(app): choose Pet animation incl. doze and pause"
```

---

### Task 6: Wire the sprite into the Electron app

**Files:**
- Modify: `app/src/main/main.ts`, `app/src/preload.ts`, `app/src/renderer/index.html`, `app/src/renderer/pet.ts`

**Interfaces:**
- Consumes:
  - From `@chog/core`: `PixelBuffer`, `samplePalette`, `extractFace`, `outfitStyle`, `hatStyle`, `traitValue`, `buildAtlas`, `ATLAS_ROWS`, `FRAME_W`, `FRAME_H`, `frameAt`, `ipfsToHttp`.
  - From Task 5: `chooseAnimation`, `REACT_MS`, `TALK_MS`.
- Produces the IPC contract that Task 7 uses:
  - main → renderer `init { imageBytes: Uint8Array; attributes: Trait[]; side: 'Left'|'Right'; name: string }`
  - main → renderer `anim { anim: AnimName; paused: boolean }`
  - renderer → main `atlas-ready (png: Uint8Array)`, `atlas-error (message: string)`
  - main keeps `let atlasPng: Buffer | null`

- [ ] **Step 1: Preload**

Replace `app/src/preload.ts` with:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { AnimName, Trait } from '@chog/core';

export type InitPayload = { imageBytes: Uint8Array; attributes: Trait[]; side: 'Left' | 'Right'; name: string };
export type AnimPayload = { anim: AnimName; paused: boolean };

const api = {
  onInit: (cb: (p: InitPayload) => void) => { ipcRenderer.on('init', (_e, p) => cb(p)); },
  onSay: (cb: (text: string) => void) => { ipcRenderer.on('say', (_e, t) => cb(t)); },
  onAnim: (cb: (a: AnimPayload) => void) => { ipcRenderer.on('anim', (_e, a) => cb(a)); },
  atlasReady: (png: Uint8Array) => ipcRenderer.send('atlas-ready', png),
  atlasError: (message: string) => ipcRenderer.send('atlas-error', message),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (x: number, y: number) => ipcRenderer.send('drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  petClick: () => ipcRenderer.send('pet-click'),
};

contextBridge.exposeInMainWorld('chog', api);
export type ChogApi = typeof api;
```

The old `onFacing` is gone. Walking direction now selects the walkEast/walkWest row.

- [ ] **Step 2: Renderer HTML**

Replace `app/src/renderer/index.html` with:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'" />
    <style>
      html, body { margin: 0; background: transparent; overflow: hidden; user-select: none; font-family: system-ui, sans-serif; }
      #pet { position: absolute; bottom: 0; left: 0; width: 192px; height: 208px; image-rendering: pixelated; cursor: grab; }
      #bubble { position: absolute; top: 0; left: 6px; right: 6px; padding: 6px 8px; border-radius: 10px; background: #fff; color: #222;
        font-size: 12px; line-height: 1.3; box-shadow: 0 2px 6px rgba(0,0,0,.25); opacity: 0; transition: opacity .2s; pointer-events: none; }
      #bubble.show { opacity: 1; }
    </style>
  </head>
  <body>
    <div id="bubble"></div>
    <canvas id="pet" width="192" height="208"></canvas>
    <script src="pet.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Renderer script**

Replace `app/src/renderer/pet.ts` with:
```ts
import { ATLAS_ROWS, FRAME_H, FRAME_W, PixelBuffer, buildAtlas, extractFace, frameAt, hatStyle, outfitStyle, samplePalette, type AnimName } from '@chog/core';
import type { ChogApi, InitPayload } from '../preload';

declare global {
  interface Window { chog: ChogApi }
}

const pet = document.getElementById('pet') as HTMLCanvasElement;
const ctx = pet.getContext('2d')!;
const bubble = document.getElementById('bubble') as HTMLDivElement;
let atlas: HTMLCanvasElement | null = null;
let anim: AnimName = 'idle';
let animStart = performance.now();
let paused = false;
let hideTimer: number | undefined;

async function decode(bytes: Uint8Array): Promise<PixelBuffer> {
  const bmp = await createImageBitmap(new Blob([bytes]));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height);
  return new PixelBuffer(d.width, d.height, d.data);
}

async function build(p: InitPayload) {
  const nft = await decode(p.imageBytes);
  const atlasBuf = buildAtlas({
    palette: samplePalette(nft, p.side),
    face: extractFace(nft, p.side),
    outfit: outfitStyle(p.attributes),
    hat: hatStyle(p.attributes),
  });
  const c = document.createElement('canvas');
  c.width = atlasBuf.width;
  c.height = atlasBuf.height;
  c.getContext('2d')!.putImageData(new ImageData(atlasBuf.data, atlasBuf.width, atlasBuf.height), 0, 0);
  atlas = c;
  pet.title = p.name;
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (blob) window.chog.atlasReady(new Uint8Array(await blob.arrayBuffer()));
}

window.chog.onInit((p) => {
  build(p).catch((e) => window.chog.atlasError(String(e)));
});

window.chog.onAnim((a) => {
  if (a.anim !== anim) {
    anim = a.anim;
    animStart = performance.now();
  }
  paused = a.paused;
});

function draw(now: number) {
  requestAnimationFrame(draw);
  if (!atlas || paused) return;
  const spec = ATLAS_ROWS[anim];
  const col = frameAt(spec.durationsMs, now - animStart);
  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, col * FRAME_W, spec.row * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
}
requestAnimationFrame(draw);

window.chog.onSay((text) => {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => bubble.classList.remove('show'), 6000);
});

// Drag vs click: movement over 4px means drag.
let down: { x: number; y: number } | null = null;
let dragging = false;
pet.addEventListener('pointerdown', (e) => {
  down = { x: e.screenX, y: e.screenY };
  dragging = false;
  pet.setPointerCapture(e.pointerId);
});
pet.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (!dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
    dragging = true;
    window.chog.dragStart();
  }
  if (dragging) window.chog.dragMove(e.screenX, e.screenY);
});
pet.addEventListener('pointerup', () => {
  if (dragging) window.chog.dragEnd();
  else window.chog.petClick();
  down = null;
  dragging = false;
});
function cancelDrag() {
  if (dragging) window.chog.dragEnd();
  down = null;
  dragging = false;
}
pet.addEventListener('pointercancel', cancelDrag);
pet.addEventListener('lostpointercapture', cancelDrag);
```

- [ ] **Step 4: Main process changes**

In `app/src/main/main.ts` make these edits, keeping all existing fixes (single-instance guard, `start().catch`, finite drag check, navigation guards, poll re-entrancy guard, save throttle, same-display perch).

1. **Imports.** Add `writeFileSync` and the new names:
```ts
import { writeFileSync } from 'node:fs';
import { chooseAnimation, REACT_MS, TALK_MS } from './animState';
```
(`ipfsToHttp` stays imported; it is used for the image URL.)

2. **Window size.** Replace `const W = 160;` / `const H = 190;` with:
```ts
const W = 192;
const H = 260; // 208 sprite + room for the speech bubble
```

3. **State.** Add below `let tray`:
```ts
let atlasPng: Buffer | null = null;
let reactUntil = 0;
let talkUntil = 0;
let lastAnimKey = '';
```

4. **Talking and poking.** Replace `say` and `poke` with:
```ts
function say(trigger: Trigger) {
  win?.webContents.send('say', pickLine(archetype, trigger, lastCategory));
  talkUntil = Date.now() + TALK_MS;
}

function poke() {
  say('pet');
  reactUntil = Date.now() + REACT_MS;
  reactions = { ...reactions, lastSpokeAt: Date.now() };
}
```

5. **Image download.** Add next to `loadChog`:
```ts
async function loadImageBytes(url: string): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`image ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}
```

6. **Loading the Chog.** In `start()`, replace the try block that loads metadata so it also loads the image:
```ts
  let meta: ChogMetadata;
  let imageBytes: Uint8Array;
  try {
    meta = await loadChog(tokenId);
    imageBytes = await loadImageBytes(ipfsToHttp(meta.image));
  } catch (e) {
    dialog.showErrorBox('Chog Buddy', `Could not load Chog #${tokenId}.\n\n${(e as Error).message}`);
    app.quit();
    return;
  }
```

7. **Init message.** Replace the `win.webContents.send('init', ...)` line with:
```ts
  win.webContents.send('init', { imageBytes, attributes: meta.attributes, side, name: meta.name });
```

8. **Walk tick.** In the walk interval:
   - Right after `if (!win || dragging) return;`, compute the animation.
   - Replace the `facing` send with an `anim` send.

   The tick becomes:
```ts
  setInterval(() => {
    const now = Date.now();
    const dt = now - last;
    last = now;
    if (!win) return;
    const choice = chooseAnimation({
      now, walking: now >= walk.pauseUntil, dir: walk.dir, dragging,
      userIdleSec: powerMonitor.getSystemIdleTime(), reactUntil, talkUntil,
    });
    const key = `${choice.anim}:${choice.paused}`;
    if (key !== lastAnimKey) {
      lastAnimKey = key;
      win.webContents.send('anim', { anim: choice.anim, paused: choice.paused });
    }
    if (dragging || !choice.canWalk) return;
    if (perch && now > perch.until) perch = null;
    const [, curY] = win.getPosition();
    const a = workAreaFor(walk.x, curY);
    if (perch && (Math.max(a.x, perch.bounds.x) > Math.min(a.x + a.width, perch.bounds.x + perch.bounds.width) - W)) perch = null;
    const minX = perch ? Math.max(a.x, perch.bounds.x) : a.x;
    const maxX = perch ? Math.min(a.x + a.width, perch.bounds.x + perch.bounds.width) - W : a.x + a.width - W;
    const y = perch ? perch.bounds.y - H + 24 : groundY(a);
    walk = stepWalk({ ...walk, x: clampX(walk.x, minX, maxX) }, now, dt, minX, maxX);
    win.setPosition(Math.round(walk.x), Math.round(y));
  }, TICK_MS);
```

9. **Atlas IPC.** Add the handlers below `ipcMain.on('pet-click', ...)`:
```ts
ipcMain.on('atlas-ready', (_e, png: Uint8Array) => {
  if (!(png instanceof Uint8Array) || png.byteLength > 20_000_000) return;
  atlasPng = Buffer.from(png);
  if (process.env.CHOG_DUMP_ATLAS) writeFileSync(path.join(app.getPath('userData'), 'atlas.png'), atlasPng);
});
ipcMain.on('atlas-error', (_e, message: string) => {
  dialog.showErrorBox('Chog Buddy', `Could not draw your Chog.\n\n${String(message).slice(0, 500)}`);
  app.quit();
});
```

10. **Pause timers while asleep.** At the top of the Activity poll callback, after `if (inFlight) return;`, skip the work while asleep:
```ts
    if (powerMonitor.getSystemIdleTime() >= 900) return; // paused: nothing to observe
```

- [ ] **Step 5: Typecheck, test, build**

Run: `npm run typecheck -w chog-buddy-app && npm test -w @chog/core -w chog-buddy-app && npm run build -w chog-buddy-app`
Expected: clean typecheck, all tests PASS, build OK.

- [ ] **Step 6: Verify the real atlas by eye**

Run, for each token, on a background launch for about 20 s, then kill all Electron processes:
```bash
CHOG_DUMP_ATLAS=1 CHOG_TOKEN_ID=5 npm start -w chog-buddy-app
```
Repeat with `CHOG_TOKEN_ID=300`, `77`, and `1200` (1200 is Side=Left with Base Radioactive).

After each run, open `~/Library/Application Support/chog-buddy-app/atlas.png` with an image viewer, or the Read tool, and check:
- row 0 shows a whole Chog with the real NFT face on its head, spikes on both sides, the right hat style (#5 cap, #77 wizard, #300 cap, #1200 horns), and outfit colour close to the NFT
- row 2 is a mirror of row 1
- #1200's face looks the same way as #5's in row 1

Failure path: run `CHOG_TOKEN_ID=5` with Wi-Fi off. Expected: an error box after about 10 s, then the app quits with no leftover Electron process.

Record what you saw in the report. If a palette colour is clearly wrong on a token, note the token and the region. Do not tune the regions in this task.

- [ ] **Step 7: Commit**

```bash
git add app/src
git commit -m "feat(app): render the Pet from the pixel sprite atlas with doze/pause"
```

---

### Task 7: Export for Codex/Petdex

**Files:**
- Create: `app/src/main/petdex.ts`
- Modify: `app/src/main/main.ts` (tray menu)
- Test: `app/test/petdex.test.ts`

**Interfaces:**
- Consumes: `ChogMetadata` (core), `atlasPng` (Task 6), `FRAME_W`, `FRAME_H`, `ATLAS_COLS`, `ATLAS_ROW_COUNT` (core).
- Produces: `petdexManifest(meta: ChogMetadata, archetypeName: string): PetdexManifest`, `petdexFolderName(tokenId: number): string`

The format is **unverified** against petdex.dev. The manifest copies the geometry Sato validates: 8 columns, 192×208 frames, 9 rows. Mark it `"formatVersion": "unverified-2026-10"` so nobody claims compatibility before it has been tested in Sato.

- [ ] **Step 1: Write the failing test**

`app/test/petdex.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL. Vitest cannot resolve `../src/main/petdex`.

- [ ] **Step 3: Implement**

`app/src/main/petdex.ts`:
```ts
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
```

In `app/src/main/main.ts`:
- Add imports:
  ```ts
  import { mkdirSync } from 'node:fs';
  import { petdexFolderName, petdexManifest } from './petdex';
  ```
  Merge `mkdirSync` into the existing `node:fs` import.
- Add this tray menu item before the final separator:
```ts
        {
          label: 'Export for Codex/Petdex…',
          click: async () => {
            if (!atlasPng) return;
            const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose a folder for your Chog sprite' });
            if (r.canceled || !r.filePaths[0]) return;
            const dir = path.join(r.filePaths[0], petdexFolderName(meta.tokenId));
            mkdirSync(dir, { recursive: true });
            writeFileSync(path.join(dir, 'spritesheet.png'), atlasPng);
            writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(petdexManifest(meta, ARCHETYPES[archetype].name), null, 2));
          },
        },
```

- [ ] **Step 4: Run tests, typecheck, build**

Run: `npm test -w chog-buddy-app && npm run typecheck -w chog-buddy-app && npm run build -w chog-buddy-app`
Expected: PASS, clean, built.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/petdex.ts app/src/main/main.ts app/test/petdex.test.ts
git commit -m "feat(app): export the Chog sprite atlas for Codex/Petdex"
```

---

## Not in this plan

- Tuning the colour-sampling regions per Base trait (Skull, Radioactive, 1:1). Do it after looking at the atlases from Task 6, step 6.
- Verifying the export in Sato/Petdex.
- Using the sad and celebrate rows. They exist in the atlas; focus bets will drive them later.
