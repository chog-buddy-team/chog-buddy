import { describe, expect, it } from 'vitest';
import { clampToArea, clampX, inArea, stepWalk } from '../src/main/walker';

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

describe('clampToArea', () => {
  const area = { x: 0, y: 25, width: 1000, height: 800 };
  const size = { width: 192, height: 260 };
  it('leaves a rect that fits where it is', () => {
    expect(clampToArea({ x: 300, y: 200 }, size, area)).toEqual({ x: 300, y: 200 });
  });
  it('pulls every edge back inside', () => {
    expect(clampToArea({ x: -50, y: 0 }, size, area)).toEqual({ x: 0, y: 25 });
    expect(clampToArea({ x: 900, y: 700 }, size, area)).toEqual({ x: 808, y: 565 });
  });
  it('works on a display left of and above the primary', () => {
    expect(clampToArea({ x: -100, y: -2000 }, size, { x: -1920, y: -1080, width: 1920, height: 1080 })).toEqual({ x: -192, y: -1080 });
  });
  it('pins a rect bigger than the area to its top-left', () => {
    expect(clampToArea({ x: 50, y: 50 }, { width: 2000, height: 2000 }, area)).toEqual({ x: 0, y: 25 });
  });
});

describe('inArea', () => {
  const area = { x: 0, y: 25, width: 1000, height: 800 };
  it('includes the top-left edge and excludes the far edges', () => {
    expect(inArea({ x: 0, y: 25 }, area)).toBe(true);
    expect(inArea({ x: 999, y: 824 }, area)).toBe(true);
    expect(inArea({ x: 1000, y: 100 }, area)).toBe(false);
    expect(inArea({ x: 100, y: 24 }, area)).toBe(false);
  });
});
