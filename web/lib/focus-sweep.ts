import type { Hex } from 'viem';
import { decideCheck, type OnchainBet } from './focus';
import { nextBetId, readBet } from './focus-chain';
import { getCursor, setCursor, settleOnce, storedMinutes } from './focus-store';

// Stays well inside the 60 s function limit, so the cursor is always saved.
const BUDGET_MS = 30_000;

export type SweepDeps = {
  nextBetId: () => Promise<bigint>;
  readBet: (id: bigint) => Promise<OnchainBet>;
  storedMinutes: (id: bigint) => Promise<number | null>;
  settleBet: (id: bigint, won: boolean) => Promise<Hex>;
  getCursor: () => Promise<bigint | null>;
  setCursor: (next: bigint) => Promise<void>;
  clock: () => number;
};

const liveDeps: SweepDeps = { nextBetId, readBet, storedMinutes, settleBet: settleOnce, clock: Date.now, getCursor, setCursor };

// Settles every open bet whose time is up. Walks from the lowest bet id that was still open last run.
// A failed settle doesn't stop the run; that bet stays open and the next run starts from it.
export async function sweepExpiredBets(nowMs = Date.now(), deps: SweepDeps = liveDeps, budgetMs = BUDGET_MS): Promise<{ checked: number; settled: number; failed: number }> {
  const t0 = deps.clock();
  const from = (await deps.getCursor()) ?? 1n;
  const end = await deps.nextBetId();
  let firstStillOpen: bigint | null = null;
  let checked = 0;
  let settled = 0;
  let failed = 0;
  for (let id = from; id < end && deps.clock() - t0 < budgetMs; id++, checked++) {
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
