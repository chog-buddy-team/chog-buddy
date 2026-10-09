import type { Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { verifyLogin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { createSession, unauthorized } from '@/lib/session';

export async function POST(req: Request) {
  try {
    const { message, signature } = (await req.json()) as { message: string; signature: Hex };
    // Burn the nonce first: single use, valid for 10 minutes.
    const nonce = parseSiweMessage(message).nonce ?? '';
    const burned = await sql`delete from nonces where nonce = ${nonce} and created_at > now() - interval '10 minutes' returning nonce`;
    if (burned.length === 0) return Response.json({ error: 'unknown or used nonce' }, { status: 401 });
    const { address } = await verifyLogin(message, signature, { domain: process.env.SIWE_DOMAIN! });
    return Response.json({ token: await createSession(address), address });
  } catch (e) {
    return unauthorized(e);
  }
}
