import { parseActivityBody } from '@/lib/activity';
import { sql } from '@/lib/db';
import { ownerOf } from '@/lib/owner';
import { requireSession, unauthorized } from '@/lib/session';

export async function POST(req: Request) {
  let address;
  try {
    address = await requireSession(req);
  } catch (e) {
    return unauthorized(e);
  }
  let body;
  try {
    body = parseActivityBody(await req.json());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  if ((await ownerOf(body.tokenId)) !== address) return Response.json({ error: 'not your Chog' }, { status: 403 });
  await sql`
    insert into activity (token_id, day, owner, totals) values (${body.tokenId}, ${body.day}, ${address}, ${JSON.stringify(body.totals)})
    on conflict (token_id, day) do update set owner = excluded.owner, totals = excluded.totals, updated_at = now()`;
  return Response.json({ ok: true });
}
