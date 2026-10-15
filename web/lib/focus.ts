import { keccak256, type Address, type Hex } from 'viem';

// Mirrors FocusPool.goalParams; grace = how long after the deadline a late report still counts.
export const GOALS = [
  { id: 0, name: 'sprint', focusMinutes: 3, bonusBps: 500, graceMs: 120_000 },
  { id: 1, name: '2h', focusMinutes: 120, bonusBps: 1000, graceMs: 900_000 },
  { id: 2, name: '4h', focusMinutes: 240, bonusBps: 2500, graceMs: 900_000 },
  { id: 3, name: '6h', focusMinutes: 360, bonusBps: 5000, graceMs: 900_000 },
] as const;

export type GoalId = 0 | 1 | 2 | 3;
export type BetStatus = 'None' | 'Open' | 'Won' | 'Lost' | 'Claimed' | 'Refunded';
export const STATUSES: readonly BetStatus[] = ['None', 'Open', 'Won', 'Lost', 'Claimed', 'Refunded'];

export type OnchainBet = {
  betId: bigint;
  bettor: Address;
  amount: bigint;
  start: number; // unix seconds
  deadline: number; // unix seconds
  bonus: bigint;
  goal: GoalId;
  status: BetStatus;
  progressKeyHash: Hex;
};

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export const keyHashOf = (key: Hex): Hex => keccak256(key);

export function parseProgressBody(x: unknown): { betId: bigint; key: Hex; focusMinutes: number } {
  const b = x as { betId?: unknown; key?: unknown; focusMinutes?: unknown } | null;
  if (typeof b?.betId !== 'string' && typeof b?.betId !== 'number') throw new TypeError('betId required');
  if (!/^\d+$/.test(String(b.betId)) || BigInt(b.betId) < 1n) throw new TypeError('betId must be a positive integer');
  if (typeof b.key !== 'string' || !KEY_RE.test(b.key)) throw new TypeError('key must be 32 bytes hex');
  if (typeof b.focusMinutes !== 'number' || !Number.isInteger(b.focusMinutes) || b.focusMinutes < 0) throw new TypeError('focusMinutes must be a non-negative integer');
  return { betId: BigInt(b.betId), key: b.key as Hex, focusMinutes: b.focusMinutes };
}

type Reject = { action: 'reject'; status: 400 | 403 | 409; error: string };

export type StoredProgress = { minutes: number; reportedAtMs: number };

// Focus is self-reported by the Pet, so the server bounds it by real time twice: never more than the
// time since the stake, and never more new minutes than the time since the last accepted report.
// One forged report at the end cannot win; the reporter has to keep up with the clock the whole way.
export function decideProgress(
  bet: OnchainBet,
  report: { key: Hex; focusMinutes: number },
  stored: StoredProgress | null,
  nowMs: number,
): Reject | { action: 'store' | 'win'; minutes: number } {
  const goal = GOALS[bet.goal];
  if (keyHashOf(report.key).toLowerCase() !== bet.progressKeyHash.toLowerCase()) return { action: 'reject', status: 403, error: 'wrong progress key' };
  if (bet.status !== 'Open') return { action: 'reject', status: 409, error: `bet is ${bet.status}` };
  // Same boundary as decideCheck's 'lose', so a win and a loss can never both be due.
  if (nowMs >= bet.deadline * 1000 + goal.graceMs) return { action: 'reject', status: 409, error: 'bet deadline has passed' };
  if (report.focusMinutes * 60_000 > nowMs - bet.start * 1000) return { action: 'reject', status: 400, error: 'more focus than time since the stake' };
  if (stored && report.focusMinutes > stored.minutes + Math.ceil((nowMs - stored.reportedAtMs) / 60_000)) {
    return { action: 'reject', status: 400, error: 'more focus than time since the last report' };
  }
  const minutes = Math.max(stored?.minutes ?? 0, report.focusMinutes);
  return { action: minutes >= goal.focusMinutes ? 'win' : 'store', minutes };
}

export function decideCheck(bet: OnchainBet, storedMinutes: number | null, nowMs: number): 'win' | 'lose' | 'wait' | 'done' {
  if (bet.status !== 'Open') return 'done';
  const goal = GOALS[bet.goal];
  if ((storedMinutes ?? 0) >= goal.focusMinutes) return 'win'; // an earlier settle failed; retry
  return nowMs >= bet.deadline * 1000 + goal.graceMs ? 'lose' : 'wait';
}
