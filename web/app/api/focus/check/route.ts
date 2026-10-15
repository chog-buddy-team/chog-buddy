import { decideCheck } from '@/lib/focus';
import { readBet } from '@/lib/focus-chain';
import { settleOnce, storedMinutes } from '@/lib/focus-store';

// Anyone may ask; settles a bet whose time is up (or a win whose settle failed) and returns its status.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { betId?: unknown } | null;
  if (!/^\d+$/.test(String(b?.betId ?? '')) || BigInt(String(b!.betId)) < 1n) return Response.json({ error: 'betId must be a positive integer' }, { status: 400 });
  const betId = BigInt(String(b!.betId));
  const bet = await readBet(betId);
  if (bet.status === 'None') return Response.json({ error: 'no such bet' }, { status: 404 });
  const minutes = await storedMinutes(betId);
  const decision = decideCheck(bet, minutes, Date.now());
  if (decision === 'win' || decision === 'lose') {
    try {
      await settleOnce(betId, decision === 'win');
    } catch {
      // Another request holds the settle, or it failed; the fresh read below shows the status.
    }
    return Response.json({ status: (await readBet(betId)).status, minutes: minutes ?? 0, deadline: bet.deadline, goal: bet.goal });
  }
  return Response.json({ status: bet.status, minutes: minutes ?? 0, deadline: bet.deadline, goal: bet.goal });
}
