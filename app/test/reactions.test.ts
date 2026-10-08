import { describe, expect, it } from 'vitest';
import { COOLDOWN_MS, detectTrigger, initialState, pickLine, type Observation } from '../src/main/reactions';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 7, 14, 0); // fixed start
const obs = (minutesFromT0: number, category: Observation['category'], hour = 14, day = '2026-10-07'): Observation => ({
  at: T0 + minutesFromT0 * MIN,
  category,
  hour,
  day,
});

// Start with lastSpokeAt far in the past so the first trigger is allowed.
const fresh = () => initialState(T0 - 10 * COOLDOWN_MS);

describe('detectTrigger', () => {
  it('fires category_switch when moving to a new real category', () => {
    const r = detectTrigger({ ...fresh(), lastDayGreeted: '2026-10-07' }, obs(0, 'coding'), false);
    expect(r.trigger).toBe('category_switch');
  });

  it('does not fire for idle or other', () => {
    const s = { ...fresh(), lastDayGreeted: '2026-10-07' };
    expect(detectTrigger(s, obs(0, 'other'), false).trigger).toBeNull();
    expect(detectTrigger(s, obs(0, 'idle'), false).trigger).toBeNull();
  });

  it('respects the cooldown between unprompted reactions', () => {
    let s = { ...fresh(), lastDayGreeted: '2026-10-07' };
    s = detectTrigger(s, obs(0, 'coding'), false).state;
    expect(detectTrigger(s, obs(1, 'chat'), false).trigger).toBeNull();
    expect(detectTrigger(s, obs(4, 'video'), false).trigger).toBe('category_switch');
  });

  it('morning greeting fires once per day and is not lost to cooldown', () => {
    let s = { ...fresh(), lastSpokeAt: T0 }; // just spoke
    let r = detectTrigger(s, obs(1, 'coding', 9), false);
    expect(r.trigger).toBeNull(); // blocked by cooldown
    r = detectTrigger(r.state, obs(4, 'coding', 9), false);
    expect(r.trigger).toBe('morning'); // still pending
    r = detectTrigger(r.state, obs(30, 'chat', 9), false);
    expect(r.trigger).toBe('category_switch'); // greeted already
  });

  it('idle_return after 10+ minutes idle beats other triggers', () => {
    let s = { ...fresh(), lastDayGreeted: '2026-10-07' };
    s = detectTrigger(s, obs(0, 'idle'), false).state;
    const r = detectTrigger(s, obs(12, 'video'), true);
    expect(r.trigger).toBe('idle_return');
  });

  it('short idle does not count as idle_return', () => {
    let s = { ...fresh(), lastDayGreeted: '2026-10-07' };
    s = detectTrigger(s, obs(0, 'idle'), false).state;
    expect(detectTrigger(s, obs(5, 'coding'), false).trigger).toBe('category_switch');
  });

  it('focus_violation when switching to video in Focus Mode', () => {
    const s = { ...fresh(), lastDayGreeted: '2026-10-07' };
    expect(detectTrigger(s, obs(0, 'video'), true).trigger).toBe('focus_violation');
    expect(detectTrigger(s, obs(0, 'video'), false).trigger).toBe('category_switch');
  });

  it('long_session after 90 minutes in one category, once', () => {
    let s = { ...fresh(), lastDayGreeted: '2026-10-07' };
    s = detectTrigger(s, obs(0, 'coding'), false).state;
    expect(detectTrigger(s, obs(89, 'coding'), false).trigger).toBeNull();
    const r = detectTrigger(s, obs(91, 'coding'), false);
    expect(r.trigger).toBe('long_session');
    expect(detectTrigger(r.state, obs(200, 'coding'), false).trigger).toBeNull();
  });

  it('late_night once per night between 00:00 and 03:59', () => {
    const s = { ...fresh(), category: 'coding' as const, lastDayGreeted: '2026-10-08' };
    const r = detectTrigger(s, obs(0, 'coding', 2, '2026-10-08'), false);
    expect(r.trigger).toBe('late_night');
    expect(detectTrigger(r.state, obs(30, 'coding', 2, '2026-10-08'), false).trigger).toBeNull();
  });
});

describe('pickLine', () => {
  it('returns a line with the category filled in', () => {
    const line = pickLine('hype', 'category_switch', 'design', () => 0);
    expect(line).not.toContain('{category}');
    expect(line.length).toBeGreaterThan(0);
  });
  it('has lines for every archetype x trigger', () => {
    const archetypes = ['hype', 'grump', 'lazySage', 'chaos', 'sweetheart'] as const;
    const triggers = ['category_switch', 'long_session', 'idle_return', 'late_night', 'morning', 'focus_violation', 'pet'] as const;
    for (const a of archetypes) for (const t of triggers) expect(pickLine(a, t, 'coding', () => 0.99).length).toBeGreaterThan(0);
  });
});
