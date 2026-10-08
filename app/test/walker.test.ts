import { describe, expect, it } from 'vitest';
import { clampX, stepWalk } from '../src/main/walker';

const never = () => 0.5; // never triggers a pause

describe('stepWalk', () => {
  it('moves 40px per second in its direction', () => {
    expect(stepWalk({ x: 100, dir: 1, pauseUntil: 0 }, 1000, 1000, 0, 500, never).x).toBe(140);
    expect(stepWalk({ x: 100, dir: -1, pauseUntil: 0 }, 1000, 1000, 0, 500, never).x).toBe(60);
  });
  it('turns around at the edges', () => {
    expect(stepWalk({ x: 495, dir: 1, pauseUntil: 0 }, 1000, 1000, 0, 500, never)).toMatchObject({ x: 500, dir: -1 });
    expect(stepWalk({ x: 5, dir: -1, pauseUntil: 0 }, 1000, 1000, 0, 500, never)).toMatchObject({ x: 0, dir: 1 });
  });
  it('stays still while paused', () => {
    expect(stepWalk({ x: 100, dir: 1, pauseUntil: 5000 }, 1000, 1000, 0, 500, never).x).toBe(100);
  });
  it('sometimes pauses', () => {
    const s = stepWalk({ x: 100, dir: 1, pauseUntil: 0 }, 1000, 50, 0, 500, () => 0);
    expect(s.pauseUntil).toBeGreaterThan(1000);
  });
});

describe('clampX', () => {
  it('pulls off-screen positions back', () => {
    expect(clampX(-300, 0, 500)).toBe(0);
    expect(clampX(9000, 0, 500)).toBe(500);
    expect(clampX(42, 0, 500)).toBe(42);
  });
});
