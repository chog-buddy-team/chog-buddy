export const JUDGE_TOKEN_ID = 5;
export const OWNERSHIP_CHECK_MS = 86_400_000;

export type Startup = { kind: 'pet'; tokenId: number; judge: boolean } | { kind: 'pick'; tokenIds: number[] } | { kind: 'choose' } | { kind: 'no-chog' };

export function chooseStartup(i: { envTokenId?: number; judgeMode: boolean; signedIn: boolean; owned: number[] | null; savedTokenId: number | null }): Startup {
  if (i.envTokenId !== undefined) return { kind: 'pet', tokenId: i.envTokenId, judge: false };
  if (i.judgeMode) return { kind: 'pet', tokenId: JUDGE_TOKEN_ID, judge: true };
  if (!i.signedIn) return { kind: 'choose' };
  if (i.owned === null) return i.savedTokenId !== null ? { kind: 'pet', tokenId: i.savedTokenId, judge: false } : { kind: 'choose' };
  if (i.owned.length === 0) return { kind: 'no-chog' };
  if (i.savedTokenId !== null && i.owned.includes(i.savedTokenId)) return { kind: 'pet', tokenId: i.savedTokenId, judge: false };
  if (i.owned.length === 1) return { kind: 'pet', tokenId: i.owned[0], judge: false };
  return { kind: 'pick', tokenIds: i.owned };
}

export function decideOwnership(activeTokenId: number, owned: number[] | null): 'keep' | 'lost' | 'unknown' {
  if (owned === null) return 'unknown';
  return owned.includes(activeTokenId) ? 'keep' : 'lost';
}

export const ownershipCheckDue = (last: number, now: number) => now - last >= OWNERSHIP_CHECK_MS;
