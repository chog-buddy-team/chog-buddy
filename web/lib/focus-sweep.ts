import type { Hex } from 'viem';
import { sql } from './db';
import { decideCheck, type OnchainBet } from './focus';
import { nextBetId, readBet, settleBet } from './focus-chain';

const MAX_PER_RUN = 300;

export async function storedMinutes(betId: bigint): Promise<number | null> {
  const rows = await sql`select minutes from focus_progress where bet_id = ${betId.toString()}`;
  return rows.length ? (rows[0].minutes as number) : null;
}

export type SweepDeps = {
  nextBetId: () => Promise<bigint>;
  readBet: (id: bigint) => Promise<OnchainBet>;
  storedMinutes: (id: bigint) => Promise<number | null>;
  settleBet: (id: bigint, won: boolean) => Promise<Hex>;
  getCursor: () => Promise<bigint | null>;
  setCursor: (next: bigint) => Promise<void>;
};

const liveDeps: SweepDeps = {
  nextBetId,
  readBet,
  storedMinutes,
  settleBet,
  getCursor: async () => {
    const [row] = await sql`select next_open from focus_cursor where id = 1`;
    return row ? BigInt(row.next_open) : null;
  },
  setCursor: async (next) => {
    await sql`insert into focus_cursor (id, next_open) values (1, ${next.toString()}) on conflict (id) do update set next_open = excluded.next_open`;
  },
};

// Settles every open bet whose time is up. Walks from the lowest bet id that was still open last run.
// A failed settle doesn't stop the run; that bet stays open and the next run starts from it.
export async function sweepExpiredBets(nowMs = Date.now(), deps: SweepDeps = liveDeps): Promise<{ checked: number; settled: number; failed: number }> {
  const from = (await deps.getCursor()) ?? 1n;
  const end = await deps.nextBetId();
  let firstStillOpen: bigint | null = null;
  let checked = 0;
  let settled = 0;
  let failed = 0;
  for (let id = from; id < end && checked < MAX_PER_RUN; id++, checked++) {
    const decision = decideCheck(await deps.readBet(id), await deps.storedMinutes(id), nowMs);
    if (decision === 'win' || decision === 'lose') {
      try {
        await deps.settleBet(id, decision === 'win');
        settled++;
        continue;
      } catch {
        failed++;
      }
    }
    if (decision !== 'done' && firstStillOpen === null) firstStillOpen = id;
  }
  await deps.setCursor(firstStillOpen ?? from + BigInt(checked));
  return { checked, settled, failed };
}
