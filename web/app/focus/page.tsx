'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPublicClient, createWalletClient, custom, formatUnits, http, parseAbi, parseEventLogs, parseUnits, type Address, type Hex } from 'viem';
import { monadTestnet } from '@chog/core';
import { GOALS, STATUSES, keyHashOf, type GoalId } from '@/lib/focus';
import { canPickGoal, estimatedBonus, keyForBet, localMidnightDeadline, minBonusFor, newProgressKey, parseSavedBets, rememberBet, type SavedBet } from '@/lib/focus-page';
import ui from '../ui/sticker.module.css';
import { Arrow } from '../ui/Arrow';
import f from './focus.module.css';

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
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
]);
const poolAbi = parseAbi([
  'function stake(uint8 goal, uint96 amount, uint40 deadline, bytes32 progressKeyHash, uint96 minBonus) returns (uint256)',
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
    run('Approve the stake amount, then confirm the stake…', async () => {
      if (!(await pingApp())) throw new Error('Could not reach the Chog Buddy app. Keep it open and try again.');
      const a = account!;
      const value = parseUnits(amount, 18);
      const key = newProgressKey();
      const deadline = goal === 0 ? 0 : localMidnightDeadline(new Date());
      // A plain approve for exactly the stake, not a permit signature: wallets flag permit signatures as high risk.
      const allowed = await reader.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'allowance', args: [a, POOL] });
      if (allowed < value) {
        const approveHash = await wallet().writeContract({ account: a, address: TOKEN, abi: tokenAbi, functionName: 'approve', args: [POOL, value] });
        setLinks((l) => [...l, { label: 'Approve', hash: approveHash }]);
        await mined(approveHash);
      }
      const pot = await reader.readContract({ address: POOL, abi: poolAbi, functionName: 'potAvailable' });
      const minBonus = minBonusFor(estimatedBonus(value, goal, pot));
      if (minBonus === 0n) throw new Error('The reward pot is empty right now.');
      // Saved before the tx, so a failed receipt wait or a closed tab can't lose the key; connect() finds it by hash.
      saveBet(a, { betId: '0', key });
      const hash = await wallet().writeContract({
        account: a, address: POOL, abi: poolAbi, functionName: 'stake',
        args: [goal, value, deadline, keyHashOf(key), minBonus],
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

  const st = live && live.status !== 'None' ? live.status : null;
  const sprite = st === 'Won' || st === 'Claimed' ? 'chog-happy' : st === 'Lost' ? 'chog-sad' : 'chog-classic';
  const progress = live && needed ? Math.min(100, (live.minutes / needed) * 100) : 0;

  return (
    <main className={`${ui.page} ${f.main}`}>
      <header className={f.header}>
        <img key={sprite} className={`${ui.cutout} ${f.chog}`} src={`/chog/${sprite}.png`} alt="" width={256} height={376} />
        <div>
          <h1 className={`${ui.lettering} ${f.title}`}>Bet on your focus</h1>
          <p className={f.intro}>Stake test $CHOG that you&apos;ll focus. Your Chog watches. Hit the goal and win your stake plus a bonus; miss it and most of it feeds the reward pot. Testnet only, no real money.</p>
        </div>
      </header>

      <div className={f.layout}>
        <div className={f.flow}>
          {!fromApp && search !== null && (
            <p className={`${ui.sticker} ${f.notice}`}><strong>Open this page from your Chog&apos;s tray menu: Bet on my focus.</strong> Your Chog reports your focus, so a bet staked here alone could never win.</p>
          )}
          {fromApp && !appOk && (
            <div className={`${ui.sticker} ${f.notice} ${f.warn}`}>
              <p><strong>Can&apos;t reach the Chog Buddy app.</strong> Keep it open, then check again.</p>
              <button className={ui.btnQuiet} onClick={pingApp}>Check again</button>
            </div>
          )}

          {!account ? (
            <section className={`${ui.sticker} ${f.card}`}>
              <h2 className={f.h2}>Connect to start</h2>
              <p>Use the wallet you want to bet from. Bets run on Monad testnet with free mock tokens.</p>
              <button className={ui.btn} onClick={connect} disabled={busy}>Connect wallet</button>
            </section>
          ) : (
            <>
              <section className={`${ui.sticker} ${f.wallet}`} aria-label="Balances">
                <div className={f.bal}>
                  <span className={ui.label}>MON (gas)</span>
                  <b>{fmt(balances.mon)}</b>
                  <a href={FAUCET_URL} target="_blank" rel="noreferrer" className={f.link}>Get testnet MON <Arrow dir="out" /></a>
                </div>
                <div className={f.bal}>
                  <span className={ui.label}>mCHOG</span>
                  <b>{fmt(balances.chog)}</b>
                  <button className={f.mini} onClick={faucet} disabled={busy}>Get 100 test $CHOG</button>
                </div>
                <div className={f.bal}>
                  <span className={ui.label}>Reward pot</span>
                  <b>{fmt(balances.pot)}</b>
                  <span className={f.unit}>mCHOG</span>
                </div>
              </section>

              {live && live.status !== 'None' ? (
                <section className={`${ui.sticker} ${live.status === 'Open' ? ui.peel : ''} ${f.card}`} data-status={live.status}>
                  <h2 className={f.h2}>{live.status === 'Open' ? 'Your Chog is counting' : live.status === 'Won' ? 'You did it!' : live.status === 'Lost' ? 'Missed it this time' : live.status === 'Claimed' ? 'Claimed. Nice focus.' : live.status}</h2>
                  <p className={`${ui.label} ${f.code}`}>Bet #{live.betId.toString()} · {GOALS[live.goal].id === 0 ? 'Sprint' : GOALS[live.goal].name}</p>
                  {live.status === 'Open' && (
                    <>
                      <div className={f.meter}>
                        <div className={f.count}><b>{live.minutes}</b><span>/ {needed} min focus</span></div>
                        <div className={f.clock} aria-label={`${clock} left`}>{clock}<span className={ui.label}>left</span></div>
                      </div>
                      <div className={f.track} role="progressbar" aria-valuemin={0} aria-valuemax={needed} aria-valuenow={live.minutes}><span style={{ '--p': progress / 100 } as React.CSSProperties} /><b className={f.trackVal}>{Math.round(progress)}%</b></div>
                    </>
                  )}
                  {live.status === 'Open' && fromApp && hasKey && (
                    <p className={f.aside}>
                      {handoffFailed ? 'Could not reach the Chog Buddy app. Keep it open and send the bet again.' : 'App not reporting?'}
                      <button className={f.mini} onClick={resend} disabled={busy}>Send to the app again</button>
                    </p>
                  )}
                  {live.status === 'Open' && live.canRefund && <p className={f.aside}>The server never settled this bet. <button className={f.mini} onClick={refund} disabled={busy}>Refund my stake</button></p>}
                  {live.status === 'Won' && <><p>Your stake comes back with the bonus.</p><button className={ui.btn} onClick={claim} disabled={busy}>Claim</button></>}
                  {live.status === 'Lost' && <p>10% was burned, 90% went to the reward pot that pays future bonuses.</p>}
                  {(live.status === 'Lost' || live.status === 'Claimed' || live.status === 'Refunded') && <button className={ui.btnQuiet} onClick={() => setLive(null)}>New bet</button>}
                </section>
              ) : (
                <section className={`${ui.sticker} ${f.card}`}>
                  <h2 className={f.h2}>New bet</h2>
                  <div className={f.goals} role="group" aria-label="Goal">
                    {GOALS.map((g) => (
                      <button key={g.id} className={f.goal} aria-pressed={goal === g.id} onClick={() => setGoal(g.id)} disabled={!canPickGoal(g.id, new Date(now))}>
                        <b>{g.id === 0 ? 'Sprint' : g.name}</b>
                        <span>{g.id === 0 ? `${g.focusMinutes} min in 5` : 'by midnight'}</span>
                        <span className={ui.label}>+{g.bonusBps / 100}%</span>
                      </button>
                    ))}
                  </div>
                  <label className={f.amount}>
                    <span>Stake</span>
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-describedby="amount-hint" />
                    <span id="amount-hint" className={ui.label}>mCHOG · 1 to 100</span>
                  </label>
                  {amountOk && <p className={f.win}>Win and you get your stake back plus about <b>{fmt(bonus)} mCHOG</b>.</p>}
                  <button className={ui.btn} onClick={stake} disabled={busy || !fromApp || !appOk || !amountOk || bonus === 0n || !canPickGoal(goal, new Date(now))}>Stake</button>
                </section>
              )}
            </>
          )}

          {msg && <p role="status" className={f.status}>{msg}</p>}
          {links.length > 0 && (
            <p className={f.txs}>{links.map((l) => <a key={l.hash} href={tx(l.hash)} target="_blank" rel="noreferrer">{l.label} tx <Arrow dir="out" /></a>)}</p>
          )}
        </div>

        <aside className={`${ui.sticker} ${f.table}`} aria-labelledby="goals-title">
          <h2 id="goals-title" className={f.h3}>The goals</h2>
          <table>
            <thead><tr><th>Goal</th><th>Focus</th><th>Window</th><th>Bonus</th></tr></thead>
            <tbody>
              {GOALS.map((g) => (
                <tr key={g.id}><td>{g.id === 0 ? 'Sprint' : g.name}</td><td>{g.focusMinutes} min</td><td>{g.id === 0 ? '5 min' : 'till midnight'}</td><td>+{g.bonusBps / 100}%</td></tr>
              ))}
            </tbody>
          </table>
          <p className={f.fine}>Only coding and design time counts, reported by your Chog every 30 s. Lose and 10% burns, 90% refills the reward pot.</p>
        </aside>
      </div>
    </main>
  );
}
