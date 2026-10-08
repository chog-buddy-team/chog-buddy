import { createPublicClient, defineChain, http, parseAbi } from 'viem';
import type { ChogMetadata, Trait } from './types';

export const CHOG_CONTRACT = '0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763' as const;
export const CHOG_SUPPLY = 1969;
export const IPFS_GATEWAY = 'https://chog-genesis.mypinata.cloud/ipfs/';

export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  testnet: true,
});

export const chogAbi = parseAbi([
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
]);

export function ipfsToHttp(uri: string): string {
  return uri.startsWith('ipfs://') ? IPFS_GATEWAY + uri.slice('ipfs://'.length) : uri;
}

export function assertTokenId(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > CHOG_SUPPLY) throw new RangeError(`Chog token id must be 1-${CHOG_SUPPLY}, got ${id}`);
}

export type MetadataDeps = {
  readTokenURI?: (id: bigint) => Promise<string>;
  fetchJson?: (url: string) => Promise<unknown>;
};

const mainnetClient = createPublicClient({ chain: monad, transport: http() });

const defaultReadTokenURI = (id: bigint) =>
  mainnetClient.readContract({ address: CHOG_CONTRACT, abi: chogAbi, functionName: 'tokenURI', args: [id] });

const defaultFetchJson = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Metadata fetch failed: ${res.status} ${url}`);
  return res.json();
};

export async function fetchChogMetadata(tokenId: number, deps: MetadataDeps = {}): Promise<ChogMetadata> {
  assertTokenId(tokenId);
  const uri = await (deps.readTokenURI ?? defaultReadTokenURI)(BigInt(tokenId));
  const json = (await (deps.fetchJson ?? defaultFetchJson)(ipfsToHttp(uri))) as Partial<{
    name: string;
    image: string;
    attributes: Trait[];
  }>;
  if (typeof json?.image !== 'string' || !Array.isArray(json.attributes)) throw new Error(`Malformed metadata for Chog ${tokenId}`);
  return { tokenId, name: json.name ?? `CHOG #${tokenId}`, image: json.image, attributes: json.attributes };
}
