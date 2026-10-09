import { generateSiweNonce } from 'viem/siwe';
import { sql } from '@/lib/db';

export async function POST() {
  const nonce = generateSiweNonce();
  await sql`insert into nonces (nonce) values (${nonce})`;
  return Response.json({ nonce });
}
