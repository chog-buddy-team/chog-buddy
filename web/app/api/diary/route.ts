import { assertTokenId, fetchChogMetadata, parseDailyTotals, pickArchetype } from '@chog/core';
import { sql } from '@/lib/db';
import { generateDiary } from '@/lib/diary';
import { ownerOf } from '@/lib/owner';
import { requireSession, unauthorized } from '@/lib/session';

// Per wallet per day; past this the Owner still gets a diary, from the template, so one wallet can't drain the shared Gemini quota.
const GEMINI_DIARIES_PER_DAY = 5;

export async function POST(req: Request) {
  let address;
  try {
    address = await requireSession(req);
  } catch (e) {
    return unauthorized(e);
  }
  let tokenId: number, totals;
  try {
    const b = await req.json();
    tokenId = b.tokenId;
    totals = parseDailyTotals(b.totals);
    assertTokenId(tokenId); // out-of-range id is a 400, not a 500 from ownerOf
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  if ((await ownerOf(tokenId)) !== address) return Response.json({ error: 'not your Chog' }, { status: 403 });
  const [{ count }] = await sql`
    insert into diary_usage (address, day, count) values (${address}, current_date, 1)
    on conflict (address, day) do update set count = diary_usage.count + 1
    returning count`;
  const meta = await fetchChogMetadata(tokenId);
  // Text is returned, never stored (ADR 0001).
  return Response.json(await generateDiary(pickArchetype(meta), meta.name, totals, fetch, undefined, count <= GEMINI_DIARIES_PER_DAY));
}
