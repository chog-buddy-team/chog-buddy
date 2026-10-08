import { describe, expect, it } from 'vitest';
import { addSample, dayKey, emptyTotals } from '../src/main/tally';

describe('tally', () => {
  it('adds seconds as minutes to the category', () => {
    const t = addSample(emptyTotals(), 'coding', 300, 14);
    expect(t.minutes.coding).toBe(5);
  });
  it('counts late and early active minutes', () => {
    let t = addSample(emptyTotals(), 'coding', 60, 23);
    t = addSample(t, 'coding', 60, 2);
    t = addSample(t, 'coding', 60, 6);
    t = addSample(t, 'coding', 60, 12);
    expect(t.lateMinutes).toBe(2);
    expect(t.earlyMinutes).toBe(1);
  });
  it('idle never counts as late or early', () => {
    const t = addSample(emptyTotals(), 'idle', 600, 23);
    expect(t.lateMinutes).toBe(0);
    expect(t.minutes.idle).toBe(10);
  });
  it('does not mutate the input', () => {
    const a = emptyTotals();
    addSample(a, 'chat', 60, 10);
    expect(a.minutes.chat).toBe(0);
  });
  it('dayKey uses local date', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
