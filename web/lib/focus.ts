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

// creditedAtMs: the time up to which focus credit has been spent (see decideProgress).
export type StoredProgress = { minutes: number; creditedAtMs: number };

// Most minutes of credit that can build up, so a late report gains at most this much.
const MAX_CREDIT_MINUTES = 2;

// Focus is self-reported by the Pet, so the server bounds it by real time. Never more minutes than the time
// from the stake to now (or to the deadline). And each minute needs credit: credit builds one minute per real
// minute from the stake, up to MAX_CREDIT_MINUTES, and a report spends only the minutes it adds. A bigger
// jump is clamped, not rejected, so a Pet that was offline catches up; one late report gains 2 minutes, so a
// win needs reports through the whole bet. Time after the deadline builds no credit: grace is for late uploads.
export function decideProgress(
  bet: OnchainBet,
  report: { key: Hex; focusMinutes: number },
  stored: StoredProgress | null,
  nowMs: number,
): Reject | { action: 'store' | 'win'; minutes: number; creditedAtMs: number } {
  const goal = GOALS[bet.goal];
  if (keyHashOf(report.key).toLowerCase() !== bet.progressKeyHash.toLowerCase()) return { action: 'reject', status: 403, error: 'wrong progress key' };
  if (bet.status !== 'Open') return { action: 'reject', status: 409, error: `bet is ${bet.status}` };
  // Same boundary as decideCheck's 'lose', so a win and a loss can never both be due.
  if (nowMs >= bet.deadline * 1000 + goal.graceMs) return { action: 'reject', status: 409, error: 'bet deadline has passed' };
  const until = Math.min(nowMs, bet.deadline * 1000);
  if (report.focusMinutes * 60_000 > until - bet.start * 1000) return { action: 'reject', status: 400, error: 'more focus than time since the stake' };
  const lastMinutes = stored?.minutes ?? 0;
  const from = Math.max(stored?.creditedAtMs ?? bet.start * 1000, until - MAX_CREDIT_MINUTES * 60_000);
  const credit = Math.max(0, Math.floor((until - from) / 60_000));
  const gain = Math.max(0, Math.min(report.focusMinutes - lastMinutes, credit));
  const minutes = lastMinutes + gain;
  return { action: minutes >= goal.focusMinutes ? 'win' : 'store', minutes, creditedAtMs: from + gain * 60_000 };
}

export function decideCheck(bet: OnchainBet, storedMinutes: number | null, nowMs: number): 'win' | 'lose' | 'wait' | 'done' {
  if (bet.status !== 'Open') return 'done';
  const goal = GOALS[bet.goal];
  if ((storedMinutes ?? 0) >= goal.focusMinutes) return 'win'; // an earlier settle failed; retry
  return nowMs >= bet.deadline * 1000 + goal.graceMs ? 'lose' : 'wait';
}
