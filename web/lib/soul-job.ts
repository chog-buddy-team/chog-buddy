import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARCHETYPES, fetchChogMetadata, monadTestnet, nextSoul, parseDailyTotals, pickArchetype, type Axes, type Soul } from '@chog/core';
import { sql } from './db';
import { soulAbi } from './soul-abi';

export type ActivityRow = { tokenId: number; day: string; owner: string; totals: unknown };
export type StoredSoul = Soul & { lastOwner: string; lastDay: string };

const BATCH = 100;

export async function computeSoulUpdates(
  rows: ActivityRow[],
  existing: Map<number, StoredSoul>,
  baseFor: (tokenId: number) => Promise<Axes>,
): Promise<Map<number, StoredSoul>> {
  const sorted = [...rows].sort((a, b) => a.tokenId - b.tokenId || a.day.localeCompare(b.day));
  const current = new Map(existing);
  const changed = new Map<number, StoredSoul>();
  for (const r of sorted) {
    const prev = current.get(r.tokenId) ?? null;
    if (prev && r.day <= prev.lastDay) continue; // already applied
    let totals;
    try {
      totals = parseDailyTotals(r.totals);
    } catch {
      continue; // corrupt row: skip, don't block everyone else
    }
    const base = prev ?? (await baseFor(r.tokenId));
    const soul = nextSoul(prev, base, totals, prev !== null && prev.lastOwner !== r.owner);
    const next = { ...soul, lastOwner: r.owner, lastDay: r.day };
    current.set(r.tokenId, next);
    changed.set(r.tokenId, next);
  }
  return changed;
}

async function baseFromChain(tokenId: number): Promise<Axes> {
  return ARCHETYPES[pickArchetype(await fetchChogMetadata(tokenId))].base;
}

export async function runSoulJob(): Promise<{ updated: number; tx: string | null }> {
  const rows = (await sql`
    select a.token_id, to_char(a.day, 'YYYY-MM-DD') as day, a.owner, a.totals
    from activity a left join souls s on s.token_id = a.token_id
    where a.day < current_date - 1 -- 2-day lag: every timezone has finished the day
      and (s.last_day is null or a.day > s.last_day)`) as Array<{ token_id: number; day: string; owner: string; totals: unknown }>;
  if (rows.length === 0) return { updated: 0, tx: null };

  const ids = [...new Set(rows.map((r) => r.token_id))];
  const soulRows = (await sql`select *, to_char(last_day, 'YYYY-MM-DD') as last_day_s from souls where token_id = any(${ids})`) as Array<Record<string, any>>;
  const existing = new Map<number, StoredSoul>(
    soulRows.map((s) => [
      s.token_id,
      { nightOwl: s.night_owl, grinder: s.grinder, social: s.social, creator: s.creator, level: s.level, ownerCount: s.owner_count, lastOwner: s.last_owner, lastDay: s.last_day_s },
    ]),
  );

  const changed = await computeSoulUpdates(
    rows.map((r) => ({ tokenId: r.token_id, day: r.day, owner: r.owner, totals: r.totals })),
    existing,
    baseFromChain,
  );
  if (changed.size === 0) return { updated: 0, tx: null };

  const account = privateKeyToAccount(process.env.SOUL_WRITER_KEY as Hex);
  // SOUL_RPC_URL overrides the public Monad testnet RPC (e.g. a local anvil for end-to-end checks).
  const transport = http(process.env.SOUL_RPC_URL || undefined);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport });
  const reader = createPublicClient({ chain: monadTestnet, transport });
  const entries = [...changed.entries()];
  let lastTx: string | null = null;
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const hash = await wallet.writeContract({
      address: process.env.SOUL_CONTRACT as Hex,
      abi: soulAbi,
      functionName: 'batchSet',
      args: [
        chunk.map(([id]) => BigInt(id)),
        chunk.map(([, s]) => ({ nightOwl: s.nightOwl, grinder: s.grinder, social: s.social, creator: s.creator, level: s.level, ownerCount: s.ownerCount })),
      ],
    });
    await reader.waitForTransactionReceipt({ hash });
    lastTx = hash;
  }

  // Only mirror to the DB after the chain write succeeded, so a failed tx is retried next run.
  for (const [id, s] of entries) {
    await sql`
      insert into souls (token_id, night_owl, grinder, social, creator, level, owner_count, last_owner, last_day)
      values (${id}, ${s.nightOwl}, ${s.grinder}, ${s.social}, ${s.creator}, ${s.level}, ${s.ownerCount}, ${s.lastOwner}, ${s.lastDay})
      on conflict (token_id) do update set night_owl = excluded.night_owl, grinder = excluded.grinder, social = excluded.social,
        creator = excluded.creator, level = excluded.level, owner_count = excluded.owner_count,
        last_owner = excluded.last_owner, last_day = excluded.last_day`;
  }
  return { updated: entries.length, tx: lastTx };
}
