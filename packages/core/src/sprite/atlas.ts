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
