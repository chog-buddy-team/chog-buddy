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
      for (let k = 0; k <= 8; k++) {
        const w = Math.round(k * 1.25);
        b.fillRect(CX - w, top - 5 + k, 2 * w + 1, 1, hat);
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
