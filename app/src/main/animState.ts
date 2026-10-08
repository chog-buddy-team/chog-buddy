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
