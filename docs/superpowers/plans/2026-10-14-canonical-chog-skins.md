# Canonical Chog + Skins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pasted NFT face with one hand-designed canonical pixel Chog, drawn from the official art: purple spiky hood, cream face, big glossy eyes, pink blush, nose and hands. It changes expression per animation and wears selectable skins, including an exclusive "My NFT skin" built from the owner's traits.

**Architecture:**
- `@chog/core/sprite` gains `canon.ts`, which draws the canonical head with five expressions, hats on the hood and outfits on the body.
- `skins.ts` defines preset skins and builds the NFT skin from traits and sampled colours.
- `kit.ts` now composes these parts instead of pasting a face, and `atlas.ts` maps an expression to each animation row.
- The face extraction code (`face.ts`, `quantize`) is deleted.
- The app adds a tray "Skin" menu and a `set-skin` IPC message. The renderer rebuilds the atlas when the skin changes.

**Tech Stack:** TypeScript, vitest, Electron. No new dependencies.

**Spec:**
- `docs/designs/chog-buddy.md`, section "Pet visuals v2: canonical Chog + skins (decided 2026-10-09)"
- The rulings below, made 2026-10-14 under the owner's instruction "fix the sprite's face"
- `docs/adr/0005-canonical-chog-skins.md`, which is created in Task 3

## Design rulings (2026-10-14)
- **Art style: pixel.** It keeps the existing 48×52 kit, the 9-row atlas, the Petdex geometry and the ChatGPT/Codex pet look the owner liked. The prototype is at `/private/tmp/.../scratchpad/face/v3.png` and was reviewed by eye.
- **Skins:**
  - `classic` is the purple bodysuit and the default.
  - `hoodie` is a blue zip hoodie with white sleeves.
  - `jacket` is a red blazer over a white shirt with dark pants.
  - `dress` is lavender with white polka dots.
  - `nft` maps the owner's traits onto the canonical body.
- **NFT skin mapping:**
  - Body trait → outfit, via the existing `outfitStyle`: bare→classic, suit→jacket, robe→dress, hoodie→hoodie, shirt→tee.
  - Head trait → hat, via the existing `hatStyle`.
  - Outfit and hat colours come from `samplePalette` on the NFT image. When no image is available, defaults are used.
- **Expressions by row:**
  - idle: open, with a blink on the last frame
  - walk: open
  - react, hop and celebrate: happy
  - sleep: closed
  - talk: talk and open alternating
  - sad: sad
- **The NFT stays essential:**
  - `nft` is only meaningful for the owner's own Chog. Judge Mode shows the demo Chog's skin.
  - No Chog NFT means no Pet. That rule is enforced in the integration plan.
  - The Soul and personality stay tied to the token.

## Global Constraints
- No new dependencies. Sprite 48×52, scaled ×4 to 192×208 frames, in an 8×9 atlas (1536×1872), with the row map unchanged.
- Canonical colours:

  | Part | Hex |
  |---|---|
  | hood | `#6c4ab6` |
  | face | `#f6e9c7` |
  | face shade | `#e4d2ac` |
  | eye | `#18121e` |
  | white | `#ffffff` |
  | blush | `#f48caa` |
  | nose | `#ec7896` |
  | mouth | `#5a283c` |
  | pink (hands and feet) | `#f496b4` |
  | suit | `#6c4ab6` |
  | suit shade | `#563a98` |
  | ink outline | `#2a1842` |

- Every hat and outfit at the worst atlas poses (`{ lift: 3 }` and `{ headDy: -1 }`) keeps the topmost filled row ≥ 1.
- Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Expression geometry overlaps the face edge or the blush.** The open eyes, closed eyes, happy arcs and sad brows must stay inside the cream face. Test in Task 1.
2. **An NFT with no image, or one whose palette is unreadable.** `nftSkin` must still return a complete skin. Test in Task 2.
3. **Switching skin at runtime.** The atlas must rebuild, `atlas-ready` must be re-sent so export uses the new skin, and a mid-animation switch must not freeze the Pet. Verified in Task 3.
4. **An old settings file without `skin`, or with an unknown skin id.** Fall back to `classic`. Test in Task 3.
5. **Removing `face.ts`.** No import may remain anywhere (renderer, tests, index). Typecheck must stay clean in core and app. Verified in Task 2.

---

## File Structure
```
packages/core/src/sprite/pixels.ts   + fillTriangle()
packages/core/src/sprite/canon.ts    NEW canonical head, expressions, hats, body/outfits
packages/core/src/sprite/skins.ts    NEW Outfit, SkinId, PRESET_SKINS, outfitFor, nftSkin, skinFor
packages/core/src/sprite/kit.ts      REWRITE: Pose.expr, ChogParts = Skin, drawChogFrame composes canon
packages/core/src/sprite/atlas.ts    rows use expr
packages/core/src/sprite/face.ts     DELETE (and quantize in palette.ts)
packages/core/src/sprite/index.ts    exports
packages/core/test/sprite-*.test.ts  updated
app/src/main/store.ts                + skin: SkinId (default 'classic')
app/src/main/main.ts                 tray Skin submenu, init payload skin, set-skin IPC
app/src/preload.ts, app/src/renderer/pet.ts   build from skin; rebuild on set-skin
docs/adr/0005-canonical-chog-skins.md, docs/designs/chog-buddy.md
```

---

### Task 1: Canonical head, hats and body in core

**Files:**
- Modify: `packages/core/src/sprite/pixels.ts` (add `fillTriangle`)
- Create: `packages/core/src/sprite/canon.ts`
- Test: `packages/core/test/sprite-canon.test.ts`

**Interfaces:**
- Produces:
  - `PixelBuffer.fillTriangle(a: [number, number], b: [number, number], c: [number, number], col: Rgba): void`
  - `type Expr = 'open' | 'closed' | 'happy' | 'talk' | 'sad'`
  - `CANON`, a record of the canonical colours listed in the global constraints, with keys `hood, face, faceShade, eye, white, blush, nose, mouth, pink, suit, suitShade, ink`
  - `HEAD_CY = 21`, `EYE_X = [19, 30] as const`
  - `drawCanonHead(b: PixelBuffer, cy: number, expr: Expr, squash: 0 | 1): void`
  - `drawHat(b: PixelBuffer, hat: HatStyle, cy: number, main: Rgba, shade: Rgba): void`, where `cy` is the head centre and the hat sits on the hood top at `cy - 12`
  - `type Outfit = 'classic' | 'tee' | 'hoodie' | 'jacket' | 'dress'`
  - `type SkinColors = { outfit: Rgba; outfitShade: Rgba; pants: Rgba; hat: Rgba; hatShade: Rgba }`
  - `drawBody(b: PixelBuffer, outfit: Outfit, colors: SkinColors, oy: number, legs: { l: number; r: number }, arms: { l: number; r: number }): void`

- [ ] **Step 1: Write the failing test**

`packages/core/test/sprite-canon.test.ts`:
```ts
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
  it('every expression keeps eyes inside the cream face (no eye pixel touches hood)', () => {
    for (const e of ['open', 'closed', 'happy', 'talk', 'sad'] as Expr[]) {
      const b = head(e);
      for (let y = 0; y < 52; y++) for (let x = 0; x < 48; x++) {
        if (!same(b.get(x, y), CANON.eye)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(same(b.get(x + dx, y + dy), CANON.hood)).toBe(false);
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w @chog/core`
Expected: FAIL, because `../src/sprite/canon` is not found.

- [ ] **Step 3: Implement**

Add to `PixelBuffer` in `packages/core/src/sprite/pixels.ts`:
```ts
  fillTriangle(a: [number, number], b: [number, number], c: [number, number], col: Rgba): void {
    const s = (p: [number, number], q: [number, number], r: [number, number]) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
    for (let y = Math.floor(Math.min(a[1], b[1], c[1])); y <= Math.ceil(Math.max(a[1], b[1], c[1])); y++)
      for (let x = Math.floor(Math.min(a[0], b[0], c[0])); x <= Math.ceil(Math.max(a[0], b[0], c[0])); x++) {
        const p: [number, number] = [x + 0.5, y + 0.5];
        const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) this.set(x, y, col);
      }
  }
```

`packages/core/src/sprite/canon.ts`:
```ts
import { hex, type PixelBuffer, type Rgba } from './pixels';
import type { HatStyle } from './traits';

export type Expr = 'open' | 'closed' | 'happy' | 'talk' | 'sad';
export type Outfit = 'classic' | 'tee' | 'hoodie' | 'jacket' | 'dress';
export type SkinColors = { outfit: Rgba; outfitShade: Rgba; pants: Rgba; hat: Rgba; hatShade: Rgba };

export const CANON = {
  hood: hex('#6c4ab6'), face: hex('#f6e9c7'), faceShade: hex('#e4d2ac'), eye: hex('#18121e'), white: hex('#ffffff'),
  blush: hex('#f48caa'), nose: hex('#ec7896'), mouth: hex('#5a283c'), pink: hex('#f496b4'),
  suit: hex('#6c4ab6'), suitShade: hex('#563a98'), ink: hex('#2a1842'),
} as const;

export const HEAD_CY = 21;
export const EYE_X = [19, 30] as const;
const CX = 24;
const same = (a: Rgba, b: Rgba) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

function spike(b: PixelBuffer, cy: number, angDeg: number, r0: number, r1: number, half: number, col: Rgba) {
  const a = ((angDeg - 90) * Math.PI) / 180;
  const n = a + Math.PI / 2;
  const bx = CX + Math.cos(a) * r0, by = cy + Math.sin(a) * r0;
  b.fillTriangle([bx + Math.cos(n) * half, by + Math.sin(n) * half], [bx - Math.cos(n) * half, by - Math.sin(n) * half], [CX + Math.cos(a) * r1, cy + Math.sin(a) * r1], col);
}

// Spiky hood: [angle from straight up, tip radius, half base width]
const SPIKES: Array<[number, number, number]> = [[-80, 16, 4.5], [-48, 17, 5], [-16, 16, 5], [16, 16, 5], [48, 17, 5], [80, 16, 4.5], [-108, 15, 4], [108, 15, 4]];
const BANGS: Array<[number, number, number]> = [[13, 6, 4], [18.5, 5, 3], [23, 6, 4.5], [29, 5, 3], [33, 4, 2]];

export function drawCanonHead(b: PixelBuffer, cy: number, expr: Expr, squash: 0 | 1): void {
  const C = CANON;
  for (const [ang, r1, half] of SPIKES) spike(b, cy, ang, 8, r1, half, C.hood);
  b.fillEllipse(CX, cy + 1, 15 + squash, 12.5 - squash, C.hood);
  b.fillEllipse(CX, cy + 5.5, 12, 9.5, C.face);
  // Hood covers the top of the face, then bangs dip into the forehead.
  for (let y = cy - 6; y <= cy - 3; y++) for (let x = 10; x <= 38; x++) if (b.inBounds(x, y) && same(b.get(x, y), C.face)) b.set(x, y, C.hood);
  for (const [x0, w, d] of BANGS) b.fillTriangle([x0, cy - 3], [x0 + w, cy - 3], [x0 + w / 2, cy - 3 + d], C.hood);
  // One-pixel chin shade along the bottom rim of the face.
  for (let y = Math.max(0, cy + 9); y < b.height; y++)
    for (let x = 0; x < b.width; x++)
      if (same(b.get(x, y), C.face) && y + 1 < b.height && !same(b.get(x, y + 1), C.face) && !same(b.get(x, y + 1), C.faceShade)) b.set(x, y, C.faceShade);

  const ey = cy + 5;
  for (const ex of EYE_X) {
    if (expr === 'closed') {
      for (let dx = -2; dx <= 2; dx++) b.set(ex + dx, ey, C.eye);
    } else if (expr === 'happy') {
      b.set(ex - 2, ey, C.eye); b.set(ex - 1, ey - 1, C.eye); b.set(ex, ey - 1, C.eye); b.set(ex + 1, ey - 1, C.eye); b.set(ex + 2, ey, C.eye);
    } else if (expr === 'sad') {
      for (let dy = -1; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!((dy === -1 || dy === 2) && Math.abs(dx) === 2)) b.set(ex + dx, ey + dy, C.eye);
      b.set(ex - 1, ey, C.white);
      const inner = ex < CX ? 1 : -1; // brows tilt up toward the middle
      b.set(ex + 2 * inner, ey - 3, C.eye); b.set(ex + inner, ey - 2, C.eye);
    } else {
      for (let dy = -3; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!((dy === -3 || dy === 2) && Math.abs(dx) === 2)) b.set(ex + dx, ey + dy, C.eye);
      b.set(ex - 1, ey - 2, C.white); b.set(ex, ey - 2, C.white); b.set(ex - 1, ey - 1, C.white); b.set(ex + 1, ey + 1, C.white);
    }
  }
  b.fillEllipse(15, cy + 9, 2.2, 1.3, C.blush);
  b.fillEllipse(33.5, cy + 9, 2.2, 1.3, C.blush);
  b.set(24, cy + 8, C.nose); b.set(25, cy + 8, C.nose);
  if (expr === 'happy' || expr === 'talk') {
    for (const x of [23, 24, 25, 26]) b.set(x, cy + 10, C.mouth);
    b.set(24, cy + 11, C.mouth); b.set(25, cy + 11, C.mouth);
  } else if (expr === 'sad') {
    b.set(23, cy + 11, C.mouth); b.set(24, cy + 10, C.mouth); b.set(25, cy + 10, C.mouth); b.set(26, cy + 11, C.mouth);
  } else {
    b.set(23, cy + 10, C.mouth); b.set(24, cy + 11, C.mouth); b.set(25, cy + 11, C.mouth); b.set(26, cy + 10, C.mouth);
  }
}

export function drawHat(b: PixelBuffer, hat: HatStyle, cy: number, main: Rgba, shade: Rgba): void {
  const top = cy - 12;
  switch (hat) {
    case 'cap':
      b.fillEllipse(CX, top + 4, 13, 5, main);
      b.fillRect(CX - 13, top + 5, 26, 3, main);
      b.fillEllipse(CX + 6, top + 8, 11, 1.8, shade);
      break;
    case 'bucket':
      b.fillEllipse(CX, top + 3, 11, 5, main);
      b.fillEllipse(CX, top + 8, 17, 2.2, shade);
      break;
    case 'wizard':
      for (let k = 0; k <= 9; k++) {
        const w = Math.round(k * 1.25);
        b.fillRect(CX - w, top - 4 + k, 2 * w + 1, 1, main);
      }
      b.fillEllipse(CX, top + 6, 16, 2.2, shade);
      break;
    case 'horns':
      for (const side of [-1, 1] as const) {
        const a = ((side * 30 - 90) * Math.PI) / 180;
        const n = a + Math.PI / 2;
        const bx = CX + side * 9, by = top + 6;
        b.fillTriangle([bx + Math.cos(n) * 2.5, by + Math.sin(n) * 2.5], [bx - Math.cos(n) * 2.5, by - Math.sin(n) * 2.5], [bx + Math.cos(a) * 9, by + Math.sin(a) * 9], main);
      }
      break;
    case 'headband':
      b.fillRect(CX - 14, top + 7, 28, 3, main);
      break;
    case 'crown':
      b.fillRect(CX - 8, top + 1, 16, 4, main);
      for (const x of [CX - 8, CX - 1, CX + 6]) b.fillRect(x, top - 2, 2, 3, main);
      break;
    case 'none':
      break;
  }
}

export function drawBody(b: PixelBuffer, outfit: Outfit, colors: SkinColors, oy: number, legs: { l: number; r: number }, arms: { l: number; r: number }): void {
  const C = CANON;
  const torso = outfit === 'classic' ? C.suit : colors.outfit;
  const legCol = outfit === 'jacket' ? colors.pants : C.suit;
  for (const [x, lift] of [[19, legs.l], [26, legs.r]] as const) {
    b.fillRect(x, oy + 44 - lift, 3, 5, legCol);
    b.fillEllipse(x + 1.5, oy + 49.6 - lift, 2.6, 1.6, C.pink);
  }
  if (outfit === 'dress') b.fillTriangle([24, oy + 33], [13, oy + 47], [35, oy + 47], colors.outfit);
  b.fillEllipse(CX, oy + 39, 8.5, 7, torso);
  if (outfit === 'hoodie') {
    b.fillRect(23, oy + 33, 1, 12, colors.outfitShade);
    b.fillRect(21, oy + 33, 1, 3, C.white);
    b.fillRect(26, oy + 33, 1, 3, C.white);
  } else if (outfit === 'jacket') {
    b.fillRect(21, oy + 33, 6, 12, C.white);
    b.fillRect(23, oy + 34, 2, 3, colors.outfitShade);
  } else if (outfit === 'dress') {
    for (const [x, y] of [[19, 41], [25, 43], [29, 39], [22, 37], [27, 45], [17, 45]] as const) b.set(x, oy + y, C.white);
  } else if (outfit === 'classic') {
    b.fillRect(17, oy + 35, 1, 9, C.suitShade);
  }
  const sleeve = outfit === 'classic' ? C.suit : outfit === 'hoodie' ? C.white : colors.outfit;
  for (const [x, dy] of [[15, arms.l], [33, arms.r]] as const) {
    b.fillEllipse(x, oy + 38.5 + dy, 2.4, 4, sleeve);
    b.fillEllipse(x, oy + 42.5 + dy, 2.2, 2.2, C.pink);
  }
}
```

The `drawHat` hat colours are only guaranteed to show when drawn on an empty buffer, which is what the test does. On the real head they overlay the hood.

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w @chog/core && npm run typecheck -w @chog/core`
Expected: PASS. If an expression test fails, check that the eye stays inside the face. Do NOT weaken the test.

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/sprite/pixels.ts packages/core/src/sprite/canon.ts packages/core/test/sprite-canon.test.ts
git commit -m "feat(core): canonical pixel Chog head, expressions, hats and outfits"
```

---

### Task 2: Skins, new kit and atlas expressions; remove face extraction

**Files:**
- Create: `packages/core/src/sprite/skins.ts`
- Modify: `packages/core/src/sprite/kit.ts` (rewrite), `packages/core/src/sprite/atlas.ts`, `packages/core/src/sprite/palette.ts` (remove `quantize`), `packages/core/src/sprite/index.ts`, `app/src/renderer/pet.ts` (minimal: build from `PRESET_SKINS.classic` so the app compiles until Task 3)
- Delete: `packages/core/src/sprite/face.ts`
- Test: `packages/core/test/sprite-skins.test.ts`. Update `packages/core/test/sprite-kit.test.ts` and `packages/core/test/sprite-palette.test.ts`.

**Interfaces:**
- Consumes: Task 1 `canon.ts`. Also `ChogPalette`, `samplePalette`, `outfitStyle`, `hatStyle`, `OutfitStyle`, `HatStyle`, `Trait`.
- Produces:
  - `type Skin = { outfit: Outfit; hat: HatStyle; colors: SkinColors }`
  - `type SkinId = 'classic' | 'hoodie' | 'jacket' | 'dress' | 'nft'`
  - `SKIN_IDS: SkinId[]`
  - `isSkinId(x: unknown): x is SkinId`
  - `PRESET_SKINS: Record<Exclude<SkinId, 'nft'>, Skin>`
  - `outfitFor(style: OutfitStyle): Outfit`
  - `nftSkin(attributes: Trait[], palette: ChogPalette | null): Skin`
  - `skinFor(id: SkinId, nft: { attributes: Trait[]; palette: ChogPalette | null }): Skin`
  - `kit.ts`:
    - `Pose` replaces `eyesClosed` with `expr: Expr`
    - `REST.expr = 'open'`
    - `type ChogParts = Skin`
    - `drawChogFrame(parts: ChogParts, pose: Pose): PixelBuffer`
    - `SPRITE_W = 48` and `SPRITE_H = 52` are unchanged
  - `atlas.ts`: `buildAtlas(parts: ChogParts)`. `ATLAS_ROWS`, `frameAt`, the constants and `AnimName` are unchanged.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/sprite-skins.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hex } from '../src/sprite/pixels';
import { PRESET_SKINS, SKIN_IDS, isSkinId, nftSkin, outfitFor, skinFor } from '../src/sprite/skins';

const t = (o: Record<string, string>) => Object.entries(o).map(([trait_type, value]) => ({ trait_type, value }));
const palette = { skin: hex('#6a3d2b'), spike: hex('#2a2a2a'), hat: hex('#b8c4d6'), hatShade: hex('#8090a0'), outfit: hex('#b3262b'), outfitShade: hex('#7d1b1f'), shoes: hex('#3e0d0f'), ink: hex('#1b1420') };

describe('skins', () => {
  it('lists five skins and validates ids', () => {
    expect(SKIN_IDS).toEqual(['classic', 'hoodie', 'jacket', 'dress', 'nft']);
    expect(isSkinId('hoodie')).toBe(true);
    expect(isSkinId('nope')).toBe(false);
    expect(isSkinId(null)).toBe(false);
  });
  it('presets have the expected outfits and no hat', () => {
    expect(PRESET_SKINS.classic.outfit).toBe('classic');
    expect(PRESET_SKINS.hoodie.outfit).toBe('hoodie');
    expect(PRESET_SKINS.jacket.outfit).toBe('jacket');
    expect(PRESET_SKINS.dress.outfit).toBe('dress');
    for (const s of Object.values(PRESET_SKINS)) expect(s.hat).toBe('none');
  });
  it.each([['bare', 'classic'], ['suit', 'jacket'], ['robe', 'dress'], ['hoodie', 'hoodie'], ['shirt', 'tee']] as const)('outfitFor(%s) = %s', (style, outfit) => {
    expect(outfitFor(style)).toBe(outfit);
  });
  it('nft skin maps traits and sampled colours', () => {
    const s = nftSkin(t({ Body: 'Red Tuxedo', Head: 'MMGA Cap' }), palette);
    expect(s.outfit).toBe('jacket');
    expect(s.hat).toBe('cap');
    expect(s.colors.outfit).toEqual(palette.outfit);
    expect(s.colors.hat).toEqual(palette.hat);
  });
  it('nft skin without a palette still returns a complete skin', () => {
    const s = nftSkin(t({ Head: 'Wizard Hat' }), null);
    expect(s.outfit).toBe('classic');
    expect(s.hat).toBe('wizard');
    for (const c of Object.values(s.colors)) expect(c).toHaveLength(4);
  });
  it('skinFor picks preset or nft', () => {
    expect(skinFor('dress', { attributes: [], palette: null })).toBe(PRESET_SKINS.dress);
    expect(skinFor('nft', { attributes: t({ Head: 'Crown' }), palette: null }).hat).toBe('crown');
  });
});
```

In `packages/core/test/sprite-kit.test.ts`, replace the `parts()` helper and the face-specific tests with skin-based ones. Keep every atlas test (geometry, filled cells, mirror, row counts, `frameAt`). Make these changes:
- `parts(outfit = 'classic', hat = 'cap')` returns `{ outfit, hat, colors: PRESET_SKINS.hoodie.colors }`. Import `PRESET_SKINS` and the `Outfit` type.
- Replace "puts the real face pixels on the head" with: the head shows canonical face and hood colours (`CANON.face` count > 100 and `CANON.hood` count > 200).
- Replace the eyesClosed test with: `{ ...REST, expr: 'closed' }` differs from REST, and at `(EYE_X[0] + 1, HEAD_CY + 3)` REST has `CANON.eye` while closed does not.
- In the hat/outfit loops, iterate outfits `['classic', 'tee', 'hoodie', 'jacket', 'dress']`.
- Keep the "keeps every hat inside the frame at the worst atlas poses" test, iterating all outfits × hats, with poses `REST`, `{ lift: 3 }` and `{ headDy: -1 }`, and assert topmost ≥ 1.
- Add an atlas test: the sleep row (row 5) frame 0 differs from the idle row frame 0, since the eyes are closed.

In `packages/core/test/sprite-palette.test.ts`, delete the `quantize` and `extractFace` describes and their imports. Keep the `samplePalette` tests.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -w @chog/core`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/core/src/sprite/skins.ts`:
```ts
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
```

Rewrite `packages/core/src/sprite/kit.ts` as:
```ts
import { PixelBuffer, outline } from './pixels';
import { CANON, HEAD_CY, drawBody, drawCanonHead, drawHat, type Expr } from './canon';
import type { Skin } from './skins';

export const SPRITE_W = 48;
export const SPRITE_H = 52;

export type Pose = { lift: number; headDy: number; bodyDy: number; legL: number; legR: number; armL: number; armR: number; squash: 0 | 1; expr: Expr };
export const REST: Pose = { lift: 0, headDy: 0, bodyDy: 0, legL: 0, legR: 0, armL: 0, armR: 0, squash: 0, expr: 'open' };

export type ChogParts = Skin;

export function drawChogFrame(parts: ChogParts, pose: Pose): PixelBuffer {
  const b = new PixelBuffer(SPRITE_W, SPRITE_H);
  const oy = -pose.lift;
  drawBody(b, parts.outfit, parts.colors, oy + pose.bodyDy, { l: pose.legL, r: pose.legR }, { l: pose.armL, r: pose.armR });
  const cy = HEAD_CY + oy + pose.headDy;
  drawCanonHead(b, cy, pose.expr, pose.squash);
  drawHat(b, parts.hat, cy, parts.colors.hat, parts.colors.hatShade);
  return outline(b, CANON.ink);
}
```

In `atlas.ts`, set `expr` on the rows. Every other field stays as it is today:
```ts
  idle: { row: 0, durationsMs: [280, 110, 110, 140, 140, 320], poses: [{}, { headDy: -1 }, { headDy: -1 }, {}, {}, { expr: 'closed' }] },
  react: { row: 3, durationsMs: [140, 140, 140, 280], poses: [{ squash: 1, expr: 'happy' }, { headDy: 1, squash: 1, expr: 'happy' }, { lift: 2, armL: -2, armR: -2, expr: 'happy' }, { expr: 'happy' }] },
  hop: { row: 4, durationsMs: [140, 140, 140, 140, 280], poses: [{ squash: 1 }, { lift: 2, expr: 'happy' }, { lift: 3, armL: -2, armR: -2, expr: 'happy' }, { lift: 2, expr: 'happy' }, { squash: 1 }] },
  sleep: { row: 5, durationsMs: [400, 400, 400, 400, 400, 400], poses: [0, 0, 1, 1, 1, 0].map((d) => ({ headDy: d, expr: 'closed' as const })) },
  talk: { row: 6, durationsMs: [150, 150, 150, 150, 150, 280], poses: [-3, -4, -3, -4, -3, 0].map((a, i) => ({ armR: a, headDy: i % 2 ? -1 : 0, expr: (i % 2 ? 'open' : 'talk') as Expr })) },
  sad: { row: 7, durationsMs: [300, 300, 300, 300, 300, 300], poses: [0, 0, 1, 1, 0, 0].map((d) => ({ headDy: 1 + d, armL: 1, armR: 1, expr: 'sad' as const })) },
  celebrate: { row: 8, durationsMs: [150, 150, 150, 150, 150, 280], poses: [0, 2, 3, 2, 0, 0].map((l) => ({ lift: l, armL: -4, armR: -4, expr: 'happy' as const })) },
```
Import `type Expr` from `./canon`.

`palette.ts`: delete `quantize` (only `face.ts` used it). Delete `face.ts`.

`index.ts`:
```ts
export * from './pixels';
export * from './palette';
export * from './traits';
export * from './canon';
export * from './skins';
export * from './kit';
export * from './atlas';
```

In `app/src/renderer/pet.ts`, keep the build working until Task 3. Remove `extractFace` from the import, import `PRESET_SKINS`, and pass `buildAtlas(PRESET_SKINS.classic)` in place of the old parts object. Leave `samplePalette`, `outfitStyle` and `hatStyle` imported only if they are still used; remove them otherwise. The full skin selection comes in Task 3.

- [ ] **Step 4: Run tests and typecheck, and confirm they pass**

Run: `npm test -w @chog/core && npm run typecheck -w @chog/core && npm run typecheck -w chog-buddy-app && npm test -w chog-buddy-app && npm run build -w chog-buddy-app`
Expected: everything PASS and clean. `grep -rn "extractFace\|FACE_W\|quantize" packages app/src` returns nothing.

- [ ] **Step 5: Render the atlas and look at it**

Write a throwaway script under `/tmp` that renders `buildAtlas` for `classic`, `hoodie`, and `nftSkin` with a Wizard Hat and Red Tuxedo to PNG. Use stdlib zlib and import core through `npx tsx`. Read the PNGs and describe in the report what rows 0 (idle), 5 (sleep), 6 (talk) and 8 (celebrate) look like. Do not commit the script.

- [ ] **Step 6: Commit**
```bash
git add -A packages/core/src/sprite packages/core/test app/src/renderer/pet.ts
git commit -m "feat(core): skins and canonical kit; atlas rows get expressions; drop face pasting"
```

---

### Task 3: Skin selection in the app, plus docs

**Files:**
- Modify: `app/src/main/store.ts`, `app/src/main/main.ts`, `app/src/preload.ts`, `app/src/renderer/pet.ts`, `docs/designs/chog-buddy.md`
- Create: `docs/adr/0005-canonical-chog-skins.md`
- Test: `app/test/store.test.ts`

**Interfaces:**
- Consumes: `SkinId`, `SKIN_IDS`, `isSkinId`, `skinFor`, `samplePalette` (core).
- Produces:
  - `Settings.skin: SkinId`, default `'classic'`. An unknown or missing value becomes `'classic'`.
  - The `init` payload gains `skin: SkinId`.
  - New main → renderer message: `set-skin (id: SkinId)`.
  - The renderer rebuilds the atlas and re-sends `atlas-ready`.

- [ ] **Step 1: Write the failing store test**

Append to `app/test/store.test.ts`:
```ts
  it('defaults skin to classic and rejects unknown skins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chog-'));
    expect(loadSettings(dir).skin).toBe('classic');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ skin: 'banana' }));
    expect(loadSettings(dir).skin).toBe('classic');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ skin: 'nft' }));
    expect(loadSettings(dir).skin).toBe('nft');
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -w chog-buddy-app`
Expected: FAIL.

- [ ] **Step 3: Implement**

`store.ts`:
- Import `isSkinId` and `type SkinId` from `'@chog/core'`.
- Add `skin: SkinId` to `Settings` and `skin: 'classic'` to the defaults.
- After the merge, set `skin: isSkinId(saved?.skin) ? saved.skin : 'classic'`. Leave every other field as it is.

`preload.ts`:
- `InitPayload` gains `skin: SkinId`, importing the type from `@chog/core`.
- Add `onSetSkin: (cb: (id: SkinId) => void) => { ipcRenderer.on('set-skin', (_e, id) => cb(id)); }`.

`pet.ts`:
- Keep `nft: PixelBuffer | null` and the latest `InitPayload` in module state.
- `build(p)` decodes the NFT image into `nft`. If decoding fails, set `nft = null` and keep going, because the classic skin needs no image.
- Then call `rebuild(p.skin)`.
- `rebuild(id)` computes `skinFor(id, { attributes: p.attributes, palette: nft ? samplePalette(nft, p.side) : null })`, builds the atlas, replaces `atlas`, keeps `anim`, `animStart` and `paused` as they are, draws one frame right away if paused, and re-sends `atlas-ready` with the new PNG.
- `window.chog.onSetSkin((id) => rebuild(id).catch((e) => window.chog.atlasError(String(e))))`.
- Import from the sprite path already used (`'../../../packages/core/src/sprite'`), so viem stays out of the bundle.

`main.ts`:
- Include `skin: settings.skin` in the `init` payload.
- Add a tray submenu right after the first label line:
```ts
        {
          label: 'Skin',
          submenu: SKIN_IDS.map((id) => ({
            label: { classic: 'Classic Chog', hoodie: 'Hoodie', jacket: 'Jacket', dress: 'Dress', nft: "My NFT skin (your Chog's traits)" }[id],
            type: 'radio' as const,
            checked: settings.skin === id,
            click: () => {
              settings.skin = id;
              saveSettings(app.getPath('userData'), settings);
              win?.webContents.send('set-skin', id);
            },
          })),
        },
```
  Import `SKIN_IDS` from `'@chog/core'`. Main bundles core already, so viem in main is fine.

`docs/adr/0005-canonical-chog-skins.md`:
```md
# Canonical pixel Chog with skins; NFT traits become a skin

Supersedes the face-pasting part of ADR 0004. The pasted NFT faces were small, blurry and inconsistent at pet size, and official full-body Chog art now exists. Every Pet is the same hand-designed pixel Chog: purple spiky hood, cream face, glossy eyes, pink blush, nose and hands. It changes expression per animation (blink, sleep, happy, talk, sad). Skins dress it: Classic, Hoodie, Jacket, Dress, and "My NFT skin", which maps the owner's Body and Head traits and sampled colours onto the canonical body. The NFT stays essential through the ownership gate, the exclusive NFT skin and the token-bound Soul. Pixel style was chosen over flat cartoon to keep the existing atlas, the Petdex geometry and the Codex-pet look.
```

`docs/designs/chog-buddy.md`: in "Pet visuals v2", replace the line "Still open (needs a short design round before planning): …" with: "Decided 2026-10-14 (ADR 0005): pixel style; skins Classic/Hoodie/Jacket/Dress/My NFT skin; NFT skin = Body→outfit, Head→hat, colours sampled from the NFT image."

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w chog-buddy-app && npm test -w @chog/core -w chog-buddy-app && npm run build -w chog-buddy-app`
Expected: clean.

Launch `CHOG_DUMP_ATLAS=1 npx electron . --user-data-dir=<temp>` from `app/` for 20 s, then read the dumped atlas (classic skin). Next, write `{"skin":"nft"}` into the temp `settings.json`, relaunch for 20 s, and read the dumped atlas: it should show a hat or outfit from Chog #5's traits. Copy both PNGs to the workspace and describe them in the report. Kill only the processes you started.

- [ ] **Step 5: Commit**
```bash
git add app/src docs/adr/0005-canonical-chog-skins.md docs/designs/chog-buddy.md app/test/store.test.ts
git commit -m "feat(app): pick a Chog skin from the tray; ADR 0005"
```
