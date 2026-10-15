'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPublicClient, createWalletClient, custom, formatUnits, http, parseAbi, parseEventLogs, parseSignature, parseUnits, type Address, type Hex } from 'viem';
import { monadTestnet } from '@chog/core';
import { GOALS, STATUSES, keyHashOf, type GoalId } from '@/lib/focus';
import { canPickGoal, estimatedBonus, keyForBet, localMidnightDeadline, minBonusFor, newProgressKey, parseSavedBets, rememberBet, type SavedBet } from '@/lib/focus-page';

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
  'function stakeWithPermit(uint8 goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash, uint96 minBonus, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s) returns (uint256)',
  'event Staked(uint256 indexed betId, address indexed bettor, uint8 goal, uint96 amount, uint40 deadline, uint96 bonus, bytes32 progressKeyHash)',
  'function claim(uint256 betId)',
  'function refund(uint256 betId)',
  'function canRefund(uint256 betId) view returns (bool)',
  'struct Bet { address bettor; uint96 amount; uint40 start; uint40 deadline; uint96 bonus; uint8 goal; uint8 status; bytes32 progressKeyHash; }',
  'function getBet(uint256 betId) view returns (Bet)',
  'function openBetOf(address) view returns (uint256)',
  'function potAvailable() view returns (uint256)',
]);

const reader = createPublicClient({ chain: monadTestnet, transport: http() });
const noSubscribe = () => () => {};
const clientSearch = () => window.location.search;
const serverSearch = () => null;

// A reverted tx still gets a receipt; treat it as an error so the page never shows a false success.
async function mined(hash: Hex) {
  const r = await reader.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('The transaction reverted.');
  return r;
}

const savedKey = (a: Address) => `focus-bets:${POOL}:${a}`.toLowerCase();
function loadSaved(a: Address): SavedBet[] {
  try {
    return parseSavedBets(localStorage.getItem(savedKey(a)));
  } catch {
    return [];
  }
}
function saveBet(a: Address, bet: SavedBet) {
  try {
    localStorage.setItem(savedKey(a), JSON.stringify(rememberBet(loadSaved(a), bet)));
  } catch {}
}

// A link can carry any port/state, so staking waits until the app on that port answers for that state.
const appAnswers = (port: string, state: string) =>
  fetch(`http://127.0.0.1:${port}/focus?state=${state}`).then((r) => r.ok, () => false);

type Live = { betId: bigint; status: string; minutes: number; deadline: number; goal: GoalId; canRefund: boolean };

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
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [appOk, setAppOk] = useState(false);
  const [hasKey, setHasKey] = useState(false);

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
    const canRefund = j.status === 'Open' && (await reader.readContract({ address: POOL, abi: poolAbi, functionName: 'canRefund', args: [betId] }).catch(() => false));
    setLive({ betId, status: j.status, minutes: j.minutes, deadline: j.deadline, goal: (j.goal ?? g) as GoalId, canRefund });
  }, []);

  const pingApp = useCallback(async () => {
    const ok = await appAnswers(port, state);
    setAppOk(ok);
    return ok;
  }, [port, state]);

  useEffect(() => {
    if (!fromApp) return;
    let current = true;
    appAnswers(port, state).then((ok) => current && setAppOk(ok));
    return () => {
      current = false;
    };
  }, [fromApp, port, state]);

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
      if (open > 0n) {
        // The key may have been saved before the stake was mined; match it by the onchain hash.
        const bet = await reader.readContract({ address: POOL, abi: poolAbi, functionName: 'getBet', args: [open] });
        const key = keyForBet(loadSaved(a), open, bet.progressKeyHash);
        if (key) saveBet(a, { betId: open.toString(), key });
        setHasKey(key !== null);
        return poll(open, bet.goal as GoalId);
      }
      // No open bet: look for a win this browser staked that still waits for Claim.
      const saved = loadSaved(a);
      const bets = await Promise.all(saved.map((b) => reader.readContract({ address: POOL, abi: poolAbi, functionName: 'getBet', args: [BigInt(b.betId)] }).catch(() => null)));
      const won = saved.find((_, i) => bets[i] && STATUSES[bets[i]!.status] === 'Won' && bets[i]!.bettor.toLowerCase() === a.toLowerCase());
      if (won) await poll(BigInt(won.betId), 0);
    });

  async function sendToApp(betId: bigint, key: Hex) {
    const ok = await fetch(`http://127.0.0.1:${port}/focus`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, betId: betId.toString(), key }),
    }).then((r) => r.ok, () => false);
    setHandoffFailed(!ok);
  }

  const resend = () =>
    run('Sending the bet to the Chog Buddy app…', async () => {
      const saved = loadSaved(account!).find((b) => b.betId === live!.betId.toString());
      if (!saved) throw new Error('This browser does not have the key for this bet.');
      await sendToApp(live!.betId, saved.key);
    });

  const faucet = () =>
    run('Getting 100 test $CHOG…', async () => {
      const hash = await wallet().writeContract({ account: account!, address: TOKEN, abi: tokenAbi, functionName: 'faucet' });
      setLinks((l) => [...l, { label: 'Faucet', hash }]);
      await mined(hash);
      await refresh(account!);
    });

  const stake = () =>
    run('Sign the permit, then confirm the stake…', async () => {
      if (!(await pingApp())) throw new Error('Could not reach the Chog Buddy app. Keep it open and try again.');
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
      const pot = await reader.readContract({ address: POOL, abi: poolAbi, functionName: 'potAvailable' });
      const minBonus = minBonusFor(estimatedBonus(value, goal, pot));
      if (minBonus === 0n) throw new Error('The reward pot is empty right now.');
      // Saved before the tx, so a failed receipt wait or a closed tab can't lose the key; connect() finds it by hash.
      saveBet(a, { betId: '0', key });
      const hash = await wallet().writeContract({
        account: a, address: POOL, abi: poolAbi, functionName: 'stakeWithPermit',
        args: [goal, value, deadline, keyHashOf(key), minBonus, permitDeadline, Number(v), r, s],
      });
      setLinks((l) => [...l, { label: 'Stake', hash }]);
      const receipt = await mined(hash);
      const [staked] = parseEventLogs({ abi: poolAbi, eventName: 'Staked', logs: receipt.logs });
      const id = staked.args.betId;
      saveBet(a, { betId: id.toString(), key });
      setHasKey(true);
      await sendToApp(id, key);
      await refresh(a);
      await poll(id, goal);
    });

  const claim = () =>
    run('Claiming…', async () => {
      const hash = await wallet().writeContract({ account: account!, address: POOL, abi: poolAbi, functionName: 'claim', args: [live!.betId] });
      setLinks((l) => [...l, { label: 'Claim', hash }]);
      await mined(hash);
      await refresh(account!);
      await poll(live!.betId, live!.goal);
    });

  const refund = () =>
    run('Refunding…', async () => {
      const hash = await wallet().writeContract({ account: account!, address: POOL, abi: poolAbi, functionName: 'refund', args: [live!.betId] });
      setLinks((l) => [...l, { label: 'Refund', hash }]);
      await mined(hash);
      await refresh(account!);
      await poll(live!.betId, live!.goal);
    });

  const fmt = (x: bigint) => Number(formatUnits(x, 18)).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const amt = Number(amount);
  const amountOk = /^\d+(\.\d{1,18})?$/.test(amount) && amt >= 1 && amt <= 100;
  const left = live ? Math.max(0, live.deadline * 1000 - now) : 0;
  const clock = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;
  const needed = live ? GOALS[live.goal].focusMinutes : 0;
  const bonus = amountOk ? estimatedBonus(parseUnits(amount, 18), goal, balances.pot) : 0n;

  return (
    <main style={{ maxWidth: 460, margin: '48px auto', padding: '0 16px', fontFamily: 'system-ui', lineHeight: 1.5 }}>
      <h1>Bet on your focus</h1>
      <p>Stake test $CHOG that you&apos;ll focus. Your Chog watches. Hit the goal and win your stake plus a bonus; miss it and most of it feeds the reward pot. Testnet only, no real money.</p>
      {!fromApp && search !== null && <p><b>Open this page from the Chog Buddy app</b> (tray menu: Bet on my focus). Your Chog reports your focus, so a bet staked here alone could never win.</p>}
      {fromApp && !appOk && <p>Can&apos;t reach the Chog Buddy app. Keep it open, then <button onClick={pingApp}>Check again</button></p>}

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
              {live.status === 'Open' && fromApp && hasKey && (
                <p>
                  {handoffFailed ? 'Could not reach the Chog Buddy app. Keep it open, then ' : 'App not reporting? '}
                  <button onClick={resend} disabled={busy}>Send to the app again</button>
                </p>
              )}
              {live.status === 'Open' && live.canRefund && <p>The server never settled this bet. <button onClick={refund} disabled={busy}>Refund my stake</button></p>}
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
              {amountOk && <p>Win and you get your stake back plus about {fmt(bonus)} mCHOG.</p>}
              <button onClick={stake} disabled={busy || !fromApp || !appOk || !amountOk || bonus === 0n || !canPickGoal(goal, new Date(now))}>Stake</button>
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
