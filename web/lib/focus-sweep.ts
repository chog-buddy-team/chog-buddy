import { sql } from './db';
import { decideCheck } from './focus';
import { nextBetId, readBet, settleBet } from './focus-chain';

const MAX_PER_RUN = 300;

export async function storedMinutes(betId: bigint): Promise<number | null> {
  const rows = await sql`select minutes from focus_progress where bet_id = ${betId.toString()}`;
  return rows.length ? (rows[0].minutes as number) : null;
}

// Settles every open bet whose time is up. Walks from the lowest bet id that was still open last run.
export async function sweepExpiredBets(nowMs = Date.now()): Promise<{ checked: number; settled: number }> {
  const [cursor] = await sql`select next_open from focus_cursor where id = 1`;
  const from = cursor ? BigInt(cursor.next_open) : 1n;
  const end = await nextBetId();
  let firstStillOpen: bigint | null = null;
  let checked = 0;
  let settled = 0;
  for (let id = from; id < end && checked < MAX_PER_RUN; id++, checked++) {
    const bet = await readBet(id);
    const decision = decideCheck(bet, await storedMinutes(id), nowMs);
    if (decision === 'win' || decision === 'lose') {
      await settleBet(id, decision === 'win');
      settled++;
    } else if (decision === 'wait' && firstStillOpen === null) {
      firstStillOpen = id;
    }
  }
  const next = firstStillOpen ?? from + BigInt(checked);
  await sql`insert into focus_cursor (id, next_open) values (1, ${next.toString()}) on conflict (id) do update set next_open = excluded.next_open`;
  return { checked, settled };
}
