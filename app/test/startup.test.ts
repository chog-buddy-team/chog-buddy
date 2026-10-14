import { describe, expect, it } from 'vitest';
import { JUDGE_TOKEN_ID, OWNERSHIP_CHECK_MS, chooseStartup, decideOwnership, ownershipCheckDue } from '../src/main/startup';

const base = { judgeMode: false, signedIn: true, owned: [5, 9] as number[] | null, savedTokenId: 9 as number | null };

describe('chooseStartup', () => {
  it('dev env override wins', () => expect(chooseStartup({ ...base, envTokenId: 1200 })).toEqual({ kind: 'pet', tokenId: 1200, judge: false }));
  it('judge mode loads the demo Chog read-only', () =>
    expect(chooseStartup({ ...base, judgeMode: true, signedIn: false, owned: null })).toEqual({ kind: 'pet', tokenId: JUDGE_TOKEN_ID, judge: true }));
  it('not signed in and not judge -> choose', () => expect(chooseStartup({ ...base, signedIn: false, owned: null })).toEqual({ kind: 'choose' }));
  it('saved Chog still owned -> pet', () => expect(chooseStartup(base)).toEqual({ kind: 'pet', tokenId: 9, judge: false }));
  it('saved Chog no longer owned -> pick from what is owned', () => expect(chooseStartup({ ...base, savedTokenId: 77 })).toEqual({ kind: 'pick', tokenIds: [5, 9] }));
  it('exactly one owned -> pet directly', () => expect(chooseStartup({ ...base, owned: [5], savedTokenId: null })).toEqual({ kind: 'pet', tokenId: 5, judge: false }));
  it('owns none -> no-chog', () => expect(chooseStartup({ ...base, owned: [] })).toEqual({ kind: 'no-chog' }));
  it('backend down but a saved Chog exists -> keep showing it', () =>
    expect(chooseStartup({ ...base, owned: null })).toEqual({ kind: 'pet', tokenId: 9, judge: false }));
  it('backend down and nothing saved -> choose', () => expect(chooseStartup({ ...base, owned: null, savedTokenId: null })).toEqual({ kind: 'choose' }));
});

describe('decideOwnership', () => {
  it.each([
    [9, [5, 9], 'keep'],
    [9, [5], 'lost'],
    [9, [], 'lost'],
    [9, null, 'unknown'],
  ] as const)('token %i with %j -> %s', (id, owned, out) => expect(decideOwnership(id, owned as number[] | null)).toBe(out));
});

describe('ownershipCheckDue', () => {
  it('is due on first run and after 24h', () => {
    expect(ownershipCheckDue(0, 1_700_000_000_000)).toBe(true); // real-clock "now"; last=0 means never checked
    expect(ownershipCheckDue(1000, 1000 + OWNERSHIP_CHECK_MS - 1)).toBe(false);
    expect(ownershipCheckDue(1000, 1000 + OWNERSHIP_CHECK_MS)).toBe(true);
  });
});
