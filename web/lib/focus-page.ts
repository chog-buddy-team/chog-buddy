import type { Hex } from 'viem';
import { GOALS, type GoalId } from './focus';

const nextLocalMidnight = (now: Date) =>
  Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0).getTime() / 1000);

// Capped at 24h: the contract rejects longer windows, and a daylight-saving day can make midnight 25h away.
export function localMidnightDeadline(now: Date, midnightOf: (now: Date) => number = nextLocalMidnight): number {
  return Math.min(midnightOf(now), Math.floor(now.getTime() / 1000) + 24 * 3600);
}

// Margin for the stake tx to be mined; the contract checks the deadline against the block time.
const MINING_MARGIN_S = 120;

// Hour goals run until local midnight, so they need enough of the day left; the sprint always fits.
export function canPickGoal(goalId: GoalId, now: Date): boolean {
  if (goalId === 0) return true;
  return localMidnightDeadline(now) - Math.floor(now.getTime() / 1000) >= GOALS[goalId].focusMinutes * 60 + MINING_MARGIN_S;
}

// Same math as FocusPool._stake: the goal's share of the stake, capped at 1% of the free pot.
export function estimatedBonus(amount: bigint, goalId: GoalId, potAvailable: bigint): bigint {
  const bonus = (amount * BigInt(GOALS[goalId].bonusBps)) / 10_000n;
  const cap = (potAvailable * 100n) / 10_000n;
  return bonus < cap ? bonus : cap;
}

// Bets this browser staked, so a Won bet can be found for Claim and the key re-sent to the app.
export type SavedBet = { betId: string; key: Hex };
const SAVED_MAX = 20;

export function parseSavedBets(raw: string | null): SavedBet[] {
  try {
    const list = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((b): b is SavedBet => /^\d+$/.test(b?.betId) && /^0x[0-9a-f]{64}$/i.test(b?.key));
  } catch {
    return [];
  }
}

export function rememberBet(list: SavedBet[], bet: SavedBet): SavedBet[] {
  return [bet, ...list.filter((b) => b.betId !== bet.betId)].slice(0, SAVED_MAX);
}

export function newProgressKey(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
