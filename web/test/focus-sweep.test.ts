import { describe, expect, it } from 'vitest';
import { keccak256, type Hex } from 'viem';
import { sweepExpiredBets, type SweepDeps } from '@/lib/focus-sweep';
import type { OnchainBet } from '@/lib/focus';

const start = 1_800_000_000;
const expired = (id: bigint): OnchainBet => ({
  betId: id, bettor: '0x0000000000000000000000000000000000000001', amount: 10n ** 19n, start, deadline: start + 300,
  bonus: 0n, goal: 0, status: 'Open', progressKeyHash: keccak256(`0x${'ab'.repeat(32)}` as Hex),
});

function fakes(failOn: bigint) {
  let cursor: bigint | null = null;
  const settled: bigint[] = [];
  const deps: SweepDeps = {
    nextBetId: async () => 4n,
    readBet: async (id) => expired(id),
    storedMinutes: async () => 0,
    settleBet: async (id) => {
      if (id === failOn) throw new Error('rpc down');
      settled.push(id);
      return '0x' as Hex;
    },
    getCursor: async () => cursor,
    setCursor: async (c) => { cursor = c; },
  };
  return { deps, settled, cursor: () => cursor };
}

describe('sweepExpiredBets', () => {
  it('keeps going past a bet whose settle fails, and retries it next run', async () => {
    const f = fakes(1n);
    const r = await sweepExpiredBets((start + 1000) * 1000, f.deps);
    expect(f.settled).toEqual([2n, 3n]);
    expect(r).toMatchObject({ checked: 3, settled: 2, failed: 1 });
    expect(f.cursor()).toBe(1n); // the failed bet is still open, so the next run starts there
  });
});
