import { describe, expect, it } from 'vitest';
import { parseActivityBody } from '@/lib/activity';

const now = new Date('2026-10-10T12:00:00Z');
const totals = { minutes: { coding: 30 }, lateMinutes: 0, earlyMinutes: 0 };

describe('parseActivityBody', () => {
  it('accepts today and yesterday', () => {
    expect(parseActivityBody({ tokenId: 5, day: '2026-10-10', totals }, now).day).toBe('2026-10-10');
    expect(parseActivityBody({ tokenId: 5, day: '2026-10-09', totals }, now).tokenId).toBe(5);
  });
  it.each([
    ['old day', { tokenId: 5, day: '2026-10-01', totals }],
    ['future day', { tokenId: 5, day: '2026-10-12', totals }],
    ['bad day format', { tokenId: 5, day: '10/10/2026', totals }],
    ['bad token', { tokenId: 0, day: '2026-10-10', totals }],
    ['string token', { tokenId: '5', day: '2026-10-10', totals }],
    ['bad totals', { tokenId: 5, day: '2026-10-10', totals: { minutes: { coding: -5 }, lateMinutes: 0, earlyMinutes: 0 } }],
  ])('rejects %s', (_n, body) => {
    expect(() => parseActivityBody(body, now)).toThrow();
  });
});
