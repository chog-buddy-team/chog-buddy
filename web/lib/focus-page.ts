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

export function newProgressKey(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
