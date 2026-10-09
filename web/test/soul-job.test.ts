import { describe, expect, it, vi } from 'vitest';
import { computeSoulUpdates, type ActivityRow, type StoredSoul } from '@/lib/soul-job';

const base = { nightOwl: 50, grinder: 50, social: 50, creator: 50 };
const t = (coding: number) => ({ minutes: { coding, chat: 60 }, lateMinutes: 0, earlyMinutes: 0 });
const row = (tokenId: number, day: string, owner = '0xA', coding = 480): ActivityRow => ({ tokenId, day, owner, totals: t(coding) });

describe('computeSoulUpdates', () => {
  it('creates a new soul from base for a first-time Chog', async () => {
    const baseFor = vi.fn().mockResolvedValue(base);
    const out = await computeSoulUpdates([row(5, '2026-10-09')], new Map(), baseFor);
    expect(out.get(5)).toMatchObject({ level: 1, ownerCount: 1, grinder: 53, lastOwner: '0xA', lastDay: '2026-10-09' });
    expect(baseFor).toHaveBeenCalledWith(5);
  });

  it('applies multiple missed days in order', async () => {
    const out = await computeSoulUpdates([row(5, '2026-10-09'), row(5, '2026-10-08')], new Map(), async () => base);
    expect(out.get(5)).toMatchObject({ level: 2, grinder: 56, lastDay: '2026-10-09' });
  });

  it('skips days already applied (cron ran twice)', async () => {
    const existing = new Map<number, StoredSoul>([[5, { ...base, level: 3, ownerCount: 1, lastOwner: '0xA', lastDay: '2026-10-09' }]]);
    const out = await computeSoulUpdates([row(5, '2026-10-09'), row(5, '2026-10-08')], existing, async () => base);
    expect(out.size).toBe(0);
  });

  it('counts a new owner', async () => {
    const existing = new Map<number, StoredSoul>([[5, { ...base, level: 3, ownerCount: 1, lastOwner: '0xA', lastDay: '2026-10-08' }]]);
    const out = await computeSoulUpdates([row(5, '2026-10-09', '0xB')], existing, async () => base);
    expect(out.get(5)).toMatchObject({ ownerCount: 2, lastOwner: '0xB', level: 4 });
  });

  it('skips rows with corrupt totals instead of failing the whole batch', async () => {
    const bad: ActivityRow = { tokenId: 9, day: '2026-10-09', owner: '0xA', totals: { minutes: { coding: -1 } } };
    const out = await computeSoulUpdates([bad, row(5, '2026-10-09')], new Map(), async () => base);
    expect([...out.keys()]).toEqual([5]);
  });
});
