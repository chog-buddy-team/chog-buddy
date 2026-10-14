'use client';

import { useState, useSyncExternalStore } from 'react';
import { createWalletClient, custom, getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';

declare global {
  interface Window { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }
}

// The query string is null on the server and during hydration, then the real value once mounted.
const noSubscribe = () => () => {};
const clientSearch = () => window.location.search;
const serverSearch = () => null;
const offline = (): never => { throw new Error('Could not reach Chog Buddy. Check your internet and try again.'); };

export default function Connect() {
  const [status, setStatus] = useState('Connect the wallet that holds your Chog.');
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
      setStatus('Done! Go back to your desktop — your Chog is waking up.');
      setPhase('done');
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string } | undefined;
      setStatus(err?.shortMessage ?? err?.message ?? 'Sign-in failed. Try again.');
      setPhase('idle');
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '80px auto', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1>Chog Buddy</h1>
      <p role="status">{search === null ? 'Loading…' : valid ? status : 'Open this page from the Chog Buddy app.'}</p>
      {valid && phase !== 'done' && <button onClick={signIn} disabled={phase === 'busy'} style={{ padding: '10px 20px', fontSize: 16 }}>Connect wallet</button>}
    </main>
  );
}
