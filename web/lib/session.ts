import { getAddress, type Address } from 'viem';
import { sql } from './db';
import { AuthError } from './auth';

export async function createSession(address: Address): Promise<string> {
  const token = crypto.randomUUID();
  await sql`insert into sessions (token, address) values (${token}, ${address})`;
  return token;
}

export async function requireSession(req: Request): Promise<Address> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new AuthError('missing session');
  const rows = await sql`select address from sessions where token = ${token} and created_at > now() - interval '30 days'`;
  if (rows.length === 0) throw new AuthError('invalid session');
  return getAddress(rows[0].address as string);
}

export const unauthorized = (e: unknown) =>
  Response.json({ error: e instanceof AuthError ? e.message : 'unauthorized' }, { status: 401 });
