import { describe, expect, it } from 'vitest';
import { createWipeGuard } from '../src/main/wipe';

describe('wipe guard', () => {
  it('marks writes that started before a wipe as stale', () => {
    const g = createWipeGuard();
    const started = g.epoch();
    expect(g.stale(started)).toBe(false);
    g.bump();
    expect(g.stale(started)).toBe(true);
    expect(g.stale(g.epoch())).toBe(false);
  });
});
