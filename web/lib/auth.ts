import { getAddress, verifyMessage, type Address, type Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';

export class AuthError extends Error {}

const MAX_AGE_MS = 10 * 60_000;

// EOA signatures only (offline ecrecover). Smart-contract wallets are out of scope for the hackathon.
// SIWE_DOMAIN may list several hosts (comma separated), e.g. the old and the new Vercel address.
export const siweDomains = (env: string | undefined): string[] => (env ?? '').split(',').map((d) => d.trim()).filter(Boolean);

export async function verifyLogin(message: string, signature: Hex, expected: { domain: string | string[]; now?: Date }): Promise<{ address: Address; nonce: string }> {
  const f = parseSiweMessage(message);
  if (!f.address || !f.nonce || !f.domain) throw new AuthError('malformed SIWE message');
  if (![expected.domain].flat().includes(f.domain)) throw new AuthError('wrong domain');
  const now = expected.now ?? new Date();
  if (f.expirationTime && f.expirationTime.getTime() < now.getTime()) throw new AuthError('expired');
  if (!f.issuedAt || now.getTime() - f.issuedAt.getTime() > MAX_AGE_MS) throw new AuthError('stale message');
  let ok = false;
  try {
    ok = await verifyMessage({ address: f.address, message, signature });
  } catch {
    ok = false;
  }
  if (!ok) throw new AuthError('bad signature');
  return { address: getAddress(f.address), nonce: f.nonce };
}
