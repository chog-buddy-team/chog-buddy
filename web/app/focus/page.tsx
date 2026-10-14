'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPublicClient, createWalletClient, custom, formatUnits, http, parseAbi, parseSignature, parseUnits, type Address, type Hex } from 'viem';
import { monadTestnet } from '@chog/core';
import { GOALS, keyHashOf, type GoalId } from '@/lib/focus';
import { canPickGoal, localMidnightDeadline, newProgressKey } from '@/lib/focus-page';

declare global {
  interface Window { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }
}

const POOL = process.env.NEXT_PUBLIC_FOCUS_POOL as Address;
const TOKEN = process.env.NEXT_PUBLIC_MOCK_CHOG as Address;
const FAUCET_URL = 'https://faucet.monad.xyz/';
const tx = (h: string) => `https://testnet.monadvision.com/tx/${h}`;

const tokenAbi = parseAbi([
  'function faucet()',
  'function balanceOf(address) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
]);
const poolAbi = parseAbi([
  'function stakeWithPermit(uint8 goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s) returns (uint256)',
  'function claim(uint256 betId)',
  'function openBetOf(address) view returns (uint256)',
  'function nextBetId() view returns (uint256)',
  'function potAvailable() view returns (uint256)',
]);

const reader = createPublicClient({ chain: monadTestnet, transport: http() });
const noSubscribe = () => () => {};
const clientSearch = () => window.location.search;
const serverSearch = () => null;

type Live = { betId: bigint; status: string; minutes: number; deadline: number; goal: GoalId };

export default function Focus() {
  const search = useSyncExternalStore<string | null>(noSubscribe, clientSearch, serverSearch);
  const q = new URLSearchParams(search ?? '');
  const port = q.get('port') ?? '';
  const state = q.get('state') ?? '';
  const fromApp = /^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535 && /^[0-9a-f]{32}$/.test(state);

  const [account, setAccount] = useState<Address | null>(null);
  const [balances, setBalances] = useState({ mon: 0n, chog: 0n, pot: 0n });
  const [goal, setGoal] = useState<GoalId>(0);
  const [amount, setAmount] = useState('10');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<{ label: string; hash: string }[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const wallet = useCallback(() => createWalletClient({ chain: monadTestnet, transport: custom(window.ethereum!) }), []);

  const refresh = useCallback(async (a: Address) => {
    const [mon, chog, pot] = await Promise.all([
      reader.getBalance({ address: a }),
      reader.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'balanceOf', args: [a] }),
      reader.readContract({ address: POOL, abi: poolAbi, functionName: 'potAvailable' }),
    ]);
    setBalances({ mon, chog, pot });
  }, []);

  const poll = useCallback(async (betId: bigint, g: GoalId) => {
    const r = await fetch('/api/focus/check', { method: 'POST', body: JSON.stringify({ betId: betId.toString() }) }).catch(() => null);
    if (!r?.ok) return;
    const j = await r.json();
    setLive({ betId, status: j.status, minutes: j.minutes, deadline: j.deadline, goal: (j.goal ?? g) as GoalId });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!live || live.status !== 'Open') return;
    const t = setInterval(() => poll(live.betId, live.goal), 10_000);
    return () => clearInterval(t);
  }, [live, poll]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setMsg(label);
    try {
      await fn();
      setMsg('');
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setMsg(err.shortMessage ?? err.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    run('Connecting…', async () => {
      if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask, Rabby or Backpack.');
      const w = wallet();
      const [a] = await w.requestAddresses();
      try {
        await w.switchChain({ id: monadTestnet.id });
      } catch {
        await w.addChain({ chain: monadTestnet });
      }
      setAccount(a);
      await refresh(a);
      const open = await reader.readContract({ address: POOL, abi: poolAbi, functionName: 'openBetOf', args: [a] });
      if (open > 0n) await poll(open, 0);
    });

  const faucet = () =>
    run('Getting 100 test $CHOG…', async () => {
      const hash = await wallet().writeContract({ account: account!, address: TOKEN, abi: tokenAbi, functionName: 'faucet' });
      setLinks((l) => [...l, { label: 'Faucet', hash }]);
      await reader.waitForTransactionReceipt({ hash });
      await refresh(account!);
    });

  const stake = () =>
    run('Sign the permit, then confirm the stake…', async () => {
      const a = account!;
      const value = parseUnits(amount, 18);
      const key = newProgressKey();
      const deadline = goal === 0 ? 0 : localMidnightDeadline(new Date());
      const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await reader.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'nonces', args: [a] });
      const sig = await wallet().signTypedData({
        account: a,
        domain: { name: 'Mock CHOG', version: '1', chainId: monadTestnet.id, verifyingContract: TOKEN },
        types: { Permit: [
          { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
        ] },
        primaryType: 'Permit',
        message: { owner: a, spender: POOL, value, nonce, deadline: permitDeadline },
      });
      const { v, r, s } = parseSignature(sig);
      const betId = await reader.readContract({ address: POOL, abi: poolAbi, functionName: 'nextBetId' });
      const hash = await wallet().writeContract({
        account: a, address: POOL, abi: poolAbi, functionName: 'stakeWithPermit',
        args: [goal, value, deadline, keyHashOf(key), permitDeadline, Number(v), r, s],
      });
      setLinks((l) => [...l, { label: 'Stake', hash }]);
      await reader.waitForTransactionReceipt({ hash });
      // nextBetId may have moved if someone else staked at the same moment; openBetOf is authoritative.
      const mine = await reader.readContract({ address: POOL, abi: poolAbi, functionName: 'openBetOf', args: [a] });
      const id = mine > 0n ? mine : betId;
      if (fromApp) {
        await fetch(`http://127.0.0.1:${port}/focus`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state, betId: id.toString(), key }),
        }).catch(() => setMsg('Could not reach the Chog Buddy app. Keep it open so it can report your focus.'));
      }
      await refresh(a);
      await poll(id, goal);
    });

  const claim = () =>
    run('Claiming…', async () => {
      const hash = await wallet().writeContract({ account: account!, address: POOL, abi: poolAbi, functionName: 'claim', args: [live!.betId] });
      setLinks((l) => [...l, { label: 'Claim', hash }]);
      await reader.waitForTransactionReceipt({ hash });
      await refresh(account!);
      await poll(live!.betId, live!.goal);
    });

  const fmt = (x: bigint) => Number(formatUnits(x, 18)).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const amt = Number(amount);
  const amountOk = Number.isFinite(amt) && amt >= 1 && amt <= 100;
  const left = live ? Math.max(0, live.deadline * 1000 - now) : 0;
  const clock = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;
  const needed = live ? GOALS[live.goal].focusMinutes : 0;

  return (
    <main style={{ maxWidth: 460, margin: '48px auto', padding: '0 16px', fontFamily: 'system-ui', lineHeight: 1.5 }}>
      <h1>Bet on your focus</h1>
      <p>Stake test $CHOG that you&apos;ll focus. Your Chog watches. Hit the goal and win your stake plus a bonus; miss it and most of it feeds the reward pot. Testnet only, no real money.</p>
      {!fromApp && search !== null && <p><b>Tip:</b> open this page from the Chog Buddy app so your Chog can report your focus.</p>}

      {!account ? (
        <button onClick={connect} disabled={busy}>Connect wallet</button>
      ) : (
        <>
          <p>
            MON (gas): {fmt(balances.mon)} · <a href={FAUCET_URL} target="_blank" rel="noreferrer">Get testnet MON</a><br />
            mCHOG: {fmt(balances.chog)} · <button onClick={faucet} disabled={busy}>Get 100 test $CHOG</button><br />
            Reward pot: {fmt(balances.pot)} mCHOG
          </p>

          {live && live.status !== 'None' ? (
            <section>
              <h2>Bet #{live.betId.toString()}: {live.status}</h2>
              {live.status === 'Open' && <p>Focus {live.minutes} / {needed} min · {clock} left</p>}
              {live.status === 'Won' && <p>You did it! <button onClick={claim} disabled={busy}>Claim</button></p>}
              {live.status === 'Lost' && <p>Missed it this time. 10% was burned, 90% went to the reward pot.</p>}
              {live.status === 'Claimed' && <p>Claimed. Nice focus.</p>}
              {(live.status === 'Lost' || live.status === 'Claimed' || live.status === 'Refunded') && <button onClick={() => setLive(null)}>New bet</button>}
            </section>
          ) : (
            <section>
              <h2>New bet</h2>
              <p>
                {GOALS.map((g) => (
                  <button key={g.id} onClick={() => setGoal(g.id)} disabled={!canPickGoal(g.id, new Date(now))}
                    style={{ marginRight: 8, fontWeight: goal === g.id ? 700 : 400 }}>
                    {g.id === 0 ? `Sprint: ${g.focusMinutes} min in 5` : `${g.name} by midnight`} (+{g.bonusBps / 100}%)
                  </button>
                ))}
              </p>
              <p>
                Stake <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ width: 70 }} /> mCHOG (1-100)
              </p>
              <button onClick={stake} disabled={busy || !amountOk || !canPickGoal(goal, new Date(now))}>Stake</button>
            </section>
          )}
        </>
      )}

      {msg && <p role="status">{msg}</p>}
      {links.length > 0 && (
        <p>{links.map((l) => <span key={l.hash}><a href={tx(l.hash)} target="_blank" rel="noreferrer">{l.label} tx</a> </span>)}</p>
      )}
    </main>
  );
}
