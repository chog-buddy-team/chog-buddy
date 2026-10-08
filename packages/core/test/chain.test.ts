import { describe, expect, it, vi } from 'vitest';
import { assertTokenId, fetchChogMetadata, ipfsToHttp } from '../src/chain';

describe('ipfsToHttp', () => {
  it('rewrites ipfs:// to the Chog gateway', () => {
    expect(ipfsToHttp('ipfs://abc/1.webp')).toBe('https://chog-genesis.mypinata.cloud/ipfs/abc/1.webp');
  });
  it('leaves https untouched', () => {
    expect(ipfsToHttp('https://x/y.png')).toBe('https://x/y.png');
  });
});

describe('assertTokenId', () => {
  it.each([0, 1970, -1, 1.5, NaN])('rejects %s', (id) => {
    expect(() => assertTokenId(id)).toThrow(RangeError);
  });
  it.each([1, 1969])('accepts %s', (id) => {
    expect(() => assertTokenId(id)).not.toThrow();
  });
});

describe('fetchChogMetadata', () => {
  it('resolves tokenURI then fetches json through the gateway', async () => {
    const readTokenURI = vi.fn().mockResolvedValue('ipfs://meta/1462.json');
    const fetchJson = vi.fn().mockResolvedValue({
      name: 'CHOG #1462',
      image: 'ipfs://img/1462.webp',
      attributes: [{ trait_type: 'Eyes', value: 'Happy' }],
    });
    const meta = await fetchChogMetadata(1, { readTokenURI, fetchJson });
    expect(readTokenURI).toHaveBeenCalledWith(1n);
    expect(fetchJson).toHaveBeenCalledWith('https://chog-genesis.mypinata.cloud/ipfs/meta/1462.json');
    expect(meta).toEqual({
      tokenId: 1,
      name: 'CHOG #1462',
      image: 'ipfs://img/1462.webp',
      attributes: [{ trait_type: 'Eyes', value: 'Happy' }],
    });
  });

  it('rejects metadata without image or attributes', async () => {
    const deps = { readTokenURI: async () => 'ipfs://m/1.json', fetchJson: async () => ({ name: 'x' }) };
    await expect(fetchChogMetadata(1, deps)).rejects.toThrow(/malformed/i);
  });

  it('rejects bad token ids before any network call', async () => {
    const readTokenURI = vi.fn();
    await expect(fetchChogMetadata(0, { readTokenURI })).rejects.toThrow(RangeError);
    expect(readTokenURI).not.toHaveBeenCalled();
  });
});
