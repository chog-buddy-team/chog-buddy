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
