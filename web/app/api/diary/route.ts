import { assertTokenId, fetchChogMetadata, parseDailyTotals, pickArchetype } from '@chog/core';
import { generateDiary } from '@/lib/diary';
import { ownerOf } from '@/lib/owner';
import { requireSession, unauthorized } from '@/lib/session';

// No per-user rate limit; add one if the Gemini free quota runs out during judging.
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
  const meta = await fetchChogMetadata(tokenId);
  // Text is returned, never stored (ADR 0001).
  return Response.json(await generateDiary(pickArchetype(meta), meta.name, totals));
}
