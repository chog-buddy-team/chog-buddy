import { generateSiweNonce } from 'viem/siwe';
import { sql } from '@/lib/db';

// Global cap, far above real sign-in traffic; stops a script from filling the free DB with nonces.
const NONCES_PER_MINUTE = 120;

export async function POST() {
  const [{ n }] = await sql`select count(*)::int as n from nonces where created_at > now() - interval '1 minute'`;
  if (n >= NONCES_PER_MINUTE) return Response.json({ error: 'too many sign-ins, try again in a minute' }, { status: 429 });
  const nonce = generateSiweNonce();
  await sql`insert into nonces (nonce) values (${nonce})`;
  return Response.json({ nonce });
}
