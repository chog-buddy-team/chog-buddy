import { sql } from '@/lib/db';
import { decideProgress, parseProgressBody } from '@/lib/focus';
import { readBet, settleBet } from '@/lib/focus-chain';
import { storedMinutes } from '@/lib/focus-sweep';

const MIN_REPORT_GAP_MS = 20_000;

// The Pet reports focus minutes since the stake, proving it holds the bet's progress key.
export async function POST(req: Request) {
  let body;
  try {
    body = parseProgressBody(await req.json());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const bet = await readBet(body.betId);
  if (bet.status === 'None') return Response.json({ error: 'no such bet' }, { status: 404 });
  const decision = decideProgress(bet, body, await storedMinutes(body.betId), Date.now());
  if (decision.action === 'reject') return Response.json({ error: decision.error }, { status: decision.status });

  const id = body.betId.toString();
  const accepted = await sql`
    insert into focus_progress (bet_id, minutes, reported_at) values (${id}, ${decision.minutes}, now())
    on conflict (bet_id) do update set minutes = greatest(focus_progress.minutes, excluded.minutes), reported_at = now()
    where focus_progress.reported_at < now() - make_interval(secs => ${MIN_REPORT_GAP_MS / 1000})
    returning minutes`;
  if (accepted.length === 0) return Response.json({ error: 'too many reports, wait 20 seconds' }, { status: 429 });

  if (decision.action === 'win') {
    try {
      await settleBet(body.betId, true);
    } catch {
      // A parallel report may have settled it already; /api/focus/check retries otherwise.
    }
    return Response.json({ status: (await readBet(body.betId)).status, minutes: decision.minutes });
  }
  return Response.json({ status: 'Open', minutes: decision.minutes });
}
