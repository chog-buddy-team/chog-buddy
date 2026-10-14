import { describe, expect, it } from 'vitest';
import { startSignIn } from '../src/main/signin';

const API = 'https://chog.test';
function begin(timeoutMs = 2000) {
  let opened = '';
  const p = startSignIn({ apiUrl: API, open: (u) => { opened = u; }, timeoutMs });
  const ready = new Promise<{ port: string; state: string }>((resolve) => {
    const t = setInterval(() => {
      if (!opened) return;
      clearInterval(t);
      const u = new URL(opened);
      resolve({ port: u.searchParams.get('port')!, state: u.searchParams.get('state')! });
    }, 5);
  });
  return { p, ready, opened: () => opened };
}
const post = (port: string, body: string, origin = API) =>
  fetch(`http://127.0.0.1:${port}/callback`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body });

describe('startSignIn', () => {
  it('opens the connect page with port and a 32-hex state', async () => {
    const s = begin();
    const { state } = await s.ready;
    expect(s.opened().startsWith(`${API}/connect?port=`)).toBe(true);
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    await post(s.opened().split('port=')[1]!.split('&')[0]!, JSON.stringify({ state, token: 'tok', address: '0xabc' }));
    await expect(s.p).resolves.toEqual({ token: 'tok', address: '0xabc' });
  });
  it('resolves on a matching callback and returns CORS for the api origin', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    const res = await post(port, JSON.stringify({ state, token: 'tok', address: '0xabc' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(API);
    await expect(s.p).resolves.toEqual({ token: 'tok', address: '0xabc' });
  });
  it('rejects a wrong state with 403 and keeps waiting', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    expect((await post(port, JSON.stringify({ state: 'f'.repeat(32), token: 't', address: 'a' }))).status).toBe(403);
    expect((await post(port, 'not json')).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${port}/callback`)).status).toBe(405);
    await post(port, JSON.stringify({ state, token: 'ok', address: '0x1' }));
    await expect(s.p).resolves.toMatchObject({ token: 'ok' });
  });
  it('times out', async () => {
    const s = begin(50);
    await s.ready;
    await expect(s.p).rejects.toThrow('sign-in timed out');
  });
  it('null body returns 400 and the server keeps working', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    expect((await post(port, 'null')).status).toBe(400);
    await post(port, JSON.stringify({ state, token: 'ok', address: '0x1' }));
    await expect(s.p).resolves.toMatchObject({ token: 'ok' });
  });
  it('oversized body returns 413', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    const oversized = JSON.stringify({ state: 'x'.repeat(10_001), token: 't', address: 'a' });
    const res = await post(port, oversized);
    expect(res.status).toBe(413);
    await post(port, JSON.stringify({ state, token: 'ok', address: '0x1' }));
    await expect(s.p).resolves.toMatchObject({ token: 'ok' });
  });
  it('wrong origin returns 403', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    const res = await post(port, JSON.stringify({ state, token: 'tok', address: '0xabc' }), 'https://wrong.origin');
    expect(res.status).toBe(403);
    await post(port, JSON.stringify({ state, token: 'ok', address: '0x1' }));
    await expect(s.p).resolves.toMatchObject({ token: 'ok' });
  });
  it('text/plain body returns 415', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    const res = await fetch(`http://127.0.0.1:${port}/callback`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: API },
      body: JSON.stringify({ state, token: 'tok', address: '0xabc' })
    });
    expect(res.status).toBe(415);
    await post(port, JSON.stringify({ state, token: 'ok', address: '0x1' }));
    await expect(s.p).resolves.toMatchObject({ token: 'ok' });
  });
  it('OPTIONS returns 204 with CORS headers', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    const res = await fetch(`http://127.0.0.1:${port}/callback`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(API);
    expect(res.headers.get('access-control-allow-private-network')).toBe('true');
    await post(port, JSON.stringify({ state, token: 'ok', address: '0x1' }));
    await expect(s.p).resolves.toMatchObject({ token: 'ok' });
  });
  it('after successful callback, second POST fails', async () => {
    const s = begin();
    const { port, state } = await s.ready;
    await post(port, JSON.stringify({ state, token: 'tok', address: '0xabc' }));
    await expect(s.p).resolves.toEqual({ token: 'tok', address: '0xabc' });

    await expect(post(port, '{}')).rejects.toThrow();
  });
});
