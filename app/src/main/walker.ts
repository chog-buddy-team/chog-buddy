export type WalkState = { x: number; dir: 1 | -1; pauseUntil: number };

const SPEED_PX_PER_SEC = 40;
const PAUSE_CHANCE_PER_STEP = 0.003;

export const clampX = (x: number, minX: number, maxX: number) => Math.min(maxX, Math.max(minX, x));

export function stepWalk(s: WalkState, now: number, dtMs: number, minX: number, maxX: number, rand: () => number = Math.random): WalkState {
  if (now < s.pauseUntil) return s;
  if (rand() < PAUSE_CHANCE_PER_STEP) return { ...s, pauseUntil: now + 2000 + rand() * 4000 };
  const x = s.x + s.dir * SPEED_PX_PER_SEC * (dtMs / 1000);
  if (x >= maxX) return { x: maxX, dir: -1, pauseUntil: 0 };
  if (x <= minX) return { x: minX, dir: 1, pauseUntil: 0 };
  return { ...s, x };
}
