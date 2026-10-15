import { decideProgress, parseProgressBody } from '@/lib/focus';
import { readBet } from '@/lib/focus-chain';
import { saveProgress, settleOnce, storedProgress } from '@/lib/focus-store';

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
  const nowMs = Date.now();
  const decision = decideProgress(bet, body, await storedProgress(body.betId), nowMs);
  if (decision.action === 'reject') return Response.json({ error: decision.error }, { status: decision.status });

  if (!(await saveProgress(body.betId, decision, MIN_REPORT_GAP_MS, nowMs))) return Response.json({ error: 'too many reports, wait 20 seconds' }, { status: 429 });

  if (decision.action === 'win') {
    try {
      await settleOnce(body.betId, true);
    } catch {
      // Another request holds the settle, or it failed; /api/focus/check and the sweep retry.
    }
    return Response.json({ status: (await readBet(body.betId)).status, minutes: decision.minutes });
  }
  return Response.json({ status: 'Open', minutes: decision.minutes });
}
