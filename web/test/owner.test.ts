import { describe, expect, it } from 'vitest';
import { parseOwnedTokenIds } from '@/lib/owner';

describe('parseOwnedTokenIds', () => {
  it('reads Alchemy v3 getNFTsForOwner shape', () => {
    expect(parseOwnedTokenIds({ ownedNfts: [{ tokenId: '5' }, { tokenId: '1462' }] })).toEqual([5, 1462]);
  });
  it('drops ids outside the collection', () => {
    expect(parseOwnedTokenIds({ ownedNfts: [{ tokenId: '0' }, { tokenId: '99999' }, { tokenId: '7' }] })).toEqual([7]);
  });
  it('handles empty / malformed', () => {
    expect(parseOwnedTokenIds({})).toEqual([]);
    expect(parseOwnedTokenIds(null)).toEqual([]);
  });
});
