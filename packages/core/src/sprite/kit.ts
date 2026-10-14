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
