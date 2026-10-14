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
export const EYE_X = [18, 29] as const;
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
  b.fillEllipse(33, cy + 9, 2.2, 1.3, C.blush);
  b.set(23, cy + 8, C.nose); b.set(24, cy + 8, C.nose);
  if (expr === 'happy' || expr === 'talk') {
    for (const x of [22, 23, 24, 25]) b.set(x, cy + 10, C.mouth);
    b.set(23, cy + 11, C.mouth); b.set(24, cy + 11, C.mouth);
  } else if (expr === 'sad') {
    b.set(22, cy + 11, C.mouth); b.set(23, cy + 10, C.mouth); b.set(24, cy + 10, C.mouth); b.set(25, cy + 11, C.mouth);
  } else {
    b.set(22, cy + 10, C.mouth); b.set(23, cy + 11, C.mouth); b.set(24, cy + 11, C.mouth); b.set(25, cy + 10, C.mouth);
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
