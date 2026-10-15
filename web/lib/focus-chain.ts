import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from '@chog/core';
import { STATUSES, type GoalId, type OnchainBet } from './focus';

export const focusPoolAbi = parseAbi([
  'struct Bet { address bettor; uint96 amount; uint40 start; uint40 deadline; uint96 bonus; uint8 goal; uint8 status; bytes32 progressKeyHash; }',
  'function getBet(uint256 betId) view returns (Bet)',
  'function nextBetId() view returns (uint256)',
  'function settle(uint256 betId, bool won)',
]);

// FOCUS_RPC_URL overrides the public Monad testnet RPC (e.g. a local anvil for end-to-end checks).
const transport = () => http(process.env.FOCUS_RPC_URL || undefined);
const pool = () => process.env.FOCUS_POOL as Hex;
const reader = () => createPublicClient({ chain: monadTestnet, transport: transport() });

export async function readBet(betId: bigint): Promise<OnchainBet> {
  const b = await reader().readContract({ address: pool(), abi: focusPoolAbi, functionName: 'getBet', args: [betId] });
  return {
    betId,
    bettor: b.bettor,
    amount: b.amount,
    start: Number(b.start),
    deadline: Number(b.deadline),
    bonus: b.bonus,
    goal: b.goal as GoalId,
    status: STATUSES[b.status],
    progressKeyHash: b.progressKeyHash,
  };
}

export async function nextBetId(): Promise<bigint> {
  return reader().readContract({ address: pool(), abi: focusPoolAbi, functionName: 'nextBetId' });
}

export async function settleBet(betId: bigint, won: boolean): Promise<Hex> {
  const account = privateKeyToAccount(process.env.SETTLER_KEY as Hex);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: transport() });
  const hash = await wallet.writeContract({ address: pool(), abi: focusPoolAbi, functionName: 'settle', args: [betId, won] });
  // Monad blocks are sub-second; 15 s keeps one stuck settle from holding the sweep past its budget.
  const receipt = await reader().waitForTransactionReceipt({ hash, timeout: 15_000 });
  if (receipt.status !== 'success') throw new Error(`settle reverted: ${hash}`);
  return hash;
}
