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
    s.p.catch(() => {});
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
});
