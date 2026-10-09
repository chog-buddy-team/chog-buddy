'use client';

import { useEffect, useState } from 'react';
import { createWalletClient, custom, getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';

declare global {
  interface Window { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }
}

export default function Connect() {
  const [status, setStatus] = useState('Connect the wallet that holds your Chog.');
  const [p, setP] = useState<{ port: string; state: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setP({ port: q.get('port') ?? '', state: q.get('state') ?? '' });
  }, []);
  const port = p?.port ?? '';
  const state = p?.state ?? '';
  const valid = /^\d{2,5}$/.test(port) && /^[0-9a-f]{32}$/.test(state);

  async function signIn() {
    try {
      if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask, Rabby or Backpack.');
      const wallet = createWalletClient({ transport: custom(window.ethereum) });
      const [raw] = await wallet.requestAddresses();
      const address = getAddress(raw);
      setStatus('Sign the message in your wallet…');
      const { nonce } = await (await fetch('/api/auth/nonce', { method: 'POST' })).json();
      const message = createSiweMessage({
        address, chainId: 143, domain: window.location.host, nonce, uri: window.location.origin, version: '1', issuedAt: new Date(),
        statement: 'Sign in to Chog Buddy. This does not cost gas.',
      });
      const signature = await wallet.signMessage({ account: address, message });
      const r = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }) });
      if (!r.ok) throw new Error('Sign-in was rejected. Try again.');
      const { token } = await r.json();
      const cb = await fetch(`http://127.0.0.1:${port}/callback`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, token, address }),
      });
      if (!cb.ok) throw new Error('Could not reach the Chog Buddy app. Is it still open?');
      setStatus('Done! Go back to your desktop — your Chog is waking up.');
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '80px auto', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1>Chog Buddy</h1>
      <p>{!p ? 'Loading…' : valid ? status : 'Open this page from the Chog Buddy app.'}</p>
      {valid && <button onClick={signIn} style={{ padding: '10px 20px', fontSize: 16 }}>Connect wallet</button>}
    </main>
  );
}
