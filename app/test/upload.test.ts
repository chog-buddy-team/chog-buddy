import { describe, expect, it } from 'vitest';
import { UPLOAD_EVERY_MS, rollover, uploadDue, uploadsFor } from '../src/main/upload';
import { emptyTotals } from '../src/main/tally';

const day = (d: string) => ({ day: d, totals: emptyTotals() });

describe('upload timing', () => {
  it('hourly', () => {
    expect(uploadDue(0, 1_700_000_000_000)).toBe(true); // real-clock "now"; last=0 means never uploaded
    expect(uploadDue(1000, 1000 + UPLOAD_EVERY_MS - 1)).toBe(false);
    expect(uploadDue(1000, 1000 + UPLOAD_EVERY_MS)).toBe(true);
  });
  it('rollover moves today to yesterday on a new day', () => {
    const r = rollover(day('2026-10-09'), '2026-10-10');
    expect(r.yesterday?.day).toBe('2026-10-09');
    expect(r.today.day).toBe('2026-10-10');
  });
  it('rollover is a no-op on the same day', () => {
    const t = day('2026-10-09');
    expect(rollover(t, '2026-10-09')).toEqual({ today: t, yesterday: null });
  });
  it('judge mode and signed-out never upload', () => {
    expect(uploadsFor({ judge: true, signedIn: true, tokenId: 5, today: day('a'), yesterday: day('b') })).toEqual([]);
    expect(uploadsFor({ judge: false, signedIn: false, tokenId: 5, today: day('a'), yesterday: null })).toEqual([]);
  });
  it('flushes yesterday first, then today', () => {
    expect(uploadsFor({ judge: false, signedIn: true, tokenId: 9, today: day('d2'), yesterday: day('d1') }).map((u) => u.day)).toEqual(['d1', 'd2']);
  });
});
