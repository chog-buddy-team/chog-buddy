import { createPublicClient, getAddress, http, type Address } from 'viem';
import { CHOG_CONTRACT, CHOG_SUPPLY, chogAbi, monad } from '@chog/core';

const client = createPublicClient({ chain: monad, transport: http() });

export async function ownerOf(tokenId: number): Promise<Address> {
  return getAddress(await client.readContract({ address: CHOG_CONTRACT, abi: chogAbi, functionName: 'ownerOf', args: [BigInt(tokenId)] }));
}

export function parseOwnedTokenIds(json: unknown): number[] {
  const nfts = (json as { ownedNfts?: Array<{ tokenId?: string }> } | null)?.ownedNfts ?? [];
  return nfts.map((n) => Number(n.tokenId)).filter((id) => Number.isInteger(id) && id >= 1 && id <= CHOG_SUPPLY);
}

// The contract is not enumerable, so ask Alchemy's indexer (free tier) which Chogs a wallet holds.
export async function listOwnedChogs(owner: Address): Promise<number[]> {
  const ids: number[] = [];
  let pageKey: string | undefined;
  do {
    const url = new URL(`https://monad-mainnet.g.alchemy.com/nft/v3/${process.env.ALCHEMY_KEY}/getNFTsForOwner`);
    url.searchParams.set('owner', owner);
    url.searchParams.append('contractAddresses[]', CHOG_CONTRACT);
    url.searchParams.set('withMetadata', 'false');
    if (pageKey) url.searchParams.set('pageKey', pageKey);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alchemy ${res.status}`);
    const json = await res.json();
    ids.push(...parseOwnedTokenIds(json));
    pageKey = json.pageKey ?? undefined;
  } while (pageKey);
  return ids;
}
