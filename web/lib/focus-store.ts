import type { Hex } from 'viem';
import { sql } from './db';
import type { StoredProgress } from './focus';
import { settleBet } from './focus-chain';

// Every row is keyed by the pool address, so a redeployed pool never reads an old pool's bet ids.
const pool = () => (process.env.FOCUS_POOL ?? '').toLowerCase();

export async function storedProgress(betId: bigint): Promise<StoredProgress | null> {
  const [row] = await sql`select minutes, reported_at from focus_reports where pool = ${pool()} and bet_id = ${betId.toString()}`;
  return row ? { minutes: row.minutes as number, reportedAtMs: new Date(row.reported_at as string).getTime() } : null;
}

export async function storedMinutes(betId: bigint): Promise<number | null> {
  return (await storedProgress(betId))?.minutes ?? null;
}

// Returns false when the last accepted report is younger than minGapMs.
export async function saveProgress(betId: bigint, minutes: number, minGapMs: number): Promise<boolean> {
  const rows = await sql`
    insert into focus_reports (pool, bet_id, minutes, reported_at) values (${pool()}, ${betId.toString()}, ${minutes}, now())
    on conflict (pool, bet_id) do update set minutes = greatest(focus_reports.minutes, excluded.minutes), reported_at = now()
    where focus_reports.reported_at < now() - make_interval(secs => ${minGapMs / 1000})
    returning minutes`;
  return rows.length > 0;
}

export async function getCursor(): Promise<bigint | null> {
  const [row] = await sql`select next_open from focus_sweep_cursor where pool = ${pool()}`;
  return row ? BigInt(row.next_open) : null;
}

export async function setCursor(next: bigint): Promise<void> {
  await sql`insert into focus_sweep_cursor (pool, next_open) values (${pool()}, ${next.toString()})
    on conflict (pool) do update set next_open = excluded.next_open`;
}

// One settle per bet at a time, so parallel requests can't make the settler pay for reverted duplicates.
// A lock older than 2 minutes belongs to a request that died, and the next caller takes it over.
export async function settleOnce(betId: bigint, won: boolean): Promise<Hex> {
  const id = betId.toString();
  const got = await sql`
    insert into focus_settling (pool, bet_id, locked_at) values (${pool()}, ${id}, now())
    on conflict (pool, bet_id) do update set locked_at = now()
    where focus_settling.locked_at < now() - interval '2 minutes'
    returning bet_id`;
  if (got.length === 0) throw new Error('settle already in flight');
  try {
    return await settleBet(betId, won);
  } catch (e) {
    await sql`delete from focus_settling where pool = ${pool()} and bet_id = ${id}`;
    throw e;
  }
}
