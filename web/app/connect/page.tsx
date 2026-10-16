'use client';

import { useState, useSyncExternalStore } from 'react';
import { createWalletClient, custom, getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import ui from '../ui/sticker.module.css';
import c from './connect.module.css';

declare global {
  interface Window { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }
}

// The query string is null on the server and during hydration, then the real value once mounted.
const noSubscribe = () => () => {};
const clientSearch = () => window.location.search;
const serverSearch = () => null;
const offline = (): never => { throw new Error('Could not reach Chog Buddy. Check your internet and try again.'); };

export default function Connect() {
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const search = useSyncExternalStore<string | null>(noSubscribe, clientSearch, serverSearch);
  const q = new URLSearchParams(search ?? '');
  const port = q.get('port') ?? '';
  const state = q.get('state') ?? '';
  const portNum = Number(port);
  const valid = /^\d+$/.test(port) && portNum >= 1024 && portNum <= 65535 && /^[0-9a-f]{32}$/.test(state);

  async function signIn() {
    setPhase('busy');
    try {
      if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask, Rabby or Backpack.');
      const wallet = createWalletClient({ transport: custom(window.ethereum) });
      const [raw] = await wallet.requestAddresses();
      const address = getAddress(raw);
      setStatus('Sign the message in your wallet…');
      const nonceRes = await fetch('/api/auth/nonce', { method: 'POST' }).catch(offline);
      const { nonce, error } = await nonceRes.json().catch(() => ({}));
      if (!nonceRes.ok || typeof nonce !== 'string') throw new Error(typeof error === 'string' ? error : 'Could not start sign-in. Try again in a minute.');
      const message = createSiweMessage({
        address, chainId: 143, domain: window.location.host, nonce, uri: window.location.origin, version: '1', issuedAt: new Date(),
        statement: 'Sign in to Chog Buddy. This does not cost gas.',
      });
      const signature = await wallet.signMessage({ account: address, message });
      const r = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }) }).catch(offline);
      if (!r.ok) throw new Error('Sign-in was rejected. Try again.');
      const { token } = await r.json();
      const cb = await fetch(`http://127.0.0.1:${port}/callback`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, token, address }),
      }).catch(() => null);
      if (!cb) throw new Error('Could not reach the Chog Buddy app. Is it still open? Start sign-in again from the app.');
      if (!cb.ok) throw new Error('The app did not accept this sign-in. Start sign-in again from the app.');
      setStatus('Done! Switch back to Chog Buddy to finish.');
      setPhase('done');
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string } | undefined;
      setStatus(err?.shortMessage ?? err?.message ?? 'Sign-in failed. Try again.');
      setPhase('idle');
    }
  }

  const ready = search !== null;
  const done = phase === 'done';
  return (
    <main className={`${ui.page} ${c.main}`}>
      <section className={`${ui.sticker} ${done ? '' : ui.peel} ${c.card}`} data-phase={phase} aria-labelledby="connect-title">
        <img className={`${ui.cutout} ${c.chog}`} src={done ? '/chog/chog-happy.png' : '/chog/chog-classic.png'} alt="" width={256} height={376} />
        <h1 id="connect-title" className={`${ui.lettering} ${c.title}`}>{done ? 'Stuck!' : 'Peel your Chog onto your desktop'}</h1>
        {!ready ? (
          <p role="status" className={c.status}>Loading…</p>
        ) : !valid ? (
          <p role="status" className={c.status}>Open this page from the Chog Buddy app: tray, then Sign in with wallet.</p>
        ) : (
          <>
            {!done && (
              <ol className={c.steps}>
                <li><span className={ui.label}>1</span>Connect the wallet that holds your Chog.</li>
                <li><span className={ui.label}>2</span>Sign a free message. No gas, no transaction.</li>
                <li><span className={ui.label}>3</span>Head back to your desktop. Your Chog wakes up.</li>
              </ol>
            )}
            <p role="status" className={c.status}>{status}</p>
            {!done && (
              <button className={ui.btn} onClick={signIn} disabled={phase === 'busy'}>
                {phase === 'busy' ? 'Waiting for your wallet…' : 'Connect wallet'}
              </button>
            )}
          </>
        )}
      </section>
      <p className={`${ui.sticker} ${c.note}`}><strong>Private by default.</strong> Sign-in only proves you hold the Chog. Your diary and chats stay on your computer.</p>
    </main>
  );
}
