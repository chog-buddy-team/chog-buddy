import { describe, expect, it } from 'vitest';
import { addFocusSample, decideReport, focusMinutes, focusStatusLine, startFocusLoopback, type FocusBet } from '../src/main/focusbet';

const SITE = 'https://chogbuddy.vercel.app';
const KEY = '0x' + 'ab'.repeat(32);

async function begin(onBet: (b: { betId: string; key: string }) => 'ok' | 'busy' = () => 'ok') {
  const calls: Array<{ betId: string; key: string }> = [];
  const s = await startFocusLoopback({ onBet: (b) => { calls.push(b); return onBet(b); } });
  const url = `http://127.0.0.1:${s.port}/focus`;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { ...s, url, post, calls };
}

describe('startFocusLoopback', () => {
  it('makes a 32-hex state and binds 127.0.0.1 only', async () => {
    const s = await begin();
    expect(s.state).toMatch(/^[0-9a-f]{32}$/);
    expect(s.port).toBeGreaterThan(0);
    await expect(fetch(`http://[::1]:${s.port}/focus?state=${s.state}`)).rejects.toThrow();
    s.close();
  });
  it('GET answers 200 for the right state, 403 otherwise', async () => {
    const s = await begin();
    expect((await fetch(`${s.url}?state=${s.state}`)).status).toBe(200);
    expect((await fetch(`${s.url}?state=${'f'.repeat(32)}`)).status).toBe(403);
    expect((await fetch(s.url)).status).toBe(403);
    s.close();
  });
  it('OPTIONS is 204 with CORS; the origin is echoed only when allowed', async () => {
    const s = await begin();
    for (const origin of [SITE, 'https://chog-buddy-api.vercel.app', 'http://localhost:3000']) {
      const r = await fetch(s.url, { method: 'OPTIONS', headers: { origin } });
      expect(r.status).toBe(204);
      expect(r.headers.get('access-control-allow-origin')).toBe(origin);
      expect(r.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
      expect(r.headers.get('access-control-allow-headers')).toBe('content-type');
      expect(r.headers.get('access-control-allow-private-network')).toBe('true');
      expect(r.headers.get('vary')).toBe('Origin');
    }
    const bad = await fetch(s.url, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(204);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    expect(bad.headers.get('access-control-allow-private-network')).toBe('true');
    s.close();
  });
  it('a good POST calls onBet once; the same bet again is 200 and a no-op', async () => {
    const s = await begin();
    const body = { state: s.state, betId: '7', key: KEY };
    const r = await s.post(body);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await s.post(body)).status).toBe(200);
    expect(s.calls).toEqual([{ betId: '7', key: KEY }]);
    s.close();
  });
  it('rejects a bad betId or key with 400 and a wrong state with 403', async () => {
    const s = await begin();
    expect((await s.post({ state: s.state, betId: '7', key: '0x1234' })).status).toBe(400);
    expect((await s.post({ state: s.state, betId: '7a', key: KEY })).status).toBe(400);
    expect((await s.post({ state: s.state, betId: 7, key: KEY })).status).toBe(400);
    expect((await s.post('not json')).status).toBe(400);
    expect((await s.post('null')).status).toBe(400);
    expect((await s.post({ state: 'f'.repeat(32), betId: '7', key: KEY })).status).toBe(403);
    expect(s.calls).toEqual([]);
    s.close();
  });
  it('answers 409 when another bet is open, and still accepts a later good bet', async () => {
    let busy = true;
    const s = await begin(() => (busy ? 'busy' : 'ok'));
    expect((await s.post({ state: s.state, betId: '8', key: KEY })).status).toBe(409);
    busy = false;
    expect((await s.post({ state: s.state, betId: '8', key: KEY })).status).toBe(200);
    expect(s.calls).toHaveLength(2);
    s.close();
  });
  it('415 for a non-JSON content type, 413 for an oversized body', async () => {
    const s = await begin();
    expect((await s.post({ state: s.state, betId: '7', key: KEY }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await s.post({ state: 'x'.repeat(10_001), betId: '7', key: KEY })).status).toBe(413);
    s.close();
  });
  it('404 for another path, 405 for another method', async () => {
    const s = await begin();
    expect((await fetch(`http://127.0.0.1:${s.port}/callback`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${s.port}/`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(s.url, { method: 'PUT' })).status).toBe(405);
    expect((await fetch(s.url, { method: 'DELETE' })).status).toBe(405);
    s.close();
  });
  it('closes at the timeout and calls onClose', async () => {
    let closed = false;
    const s = await startFocusLoopback({ onBet: () => 'ok', timeoutMs: 50, onClose: () => { closed = true; } });
    await new Promise((r) => setTimeout(r, 120));
    expect(closed).toBe(true);
    await expect(fetch(`http://127.0.0.1:${s.port}/focus?state=${s.state}`)).rejects.toThrow();
  });
});

const bet: FocusBet = { betId: '1', keyEnc: 'x', focusMs: 0, startedAt: 0, deadline: null, goal: null, goalMinutes: null };

describe('focus counter', () => {
  it('coding and design add, everything else does not', () => {
    let b = bet;
    b = addFocusSample(b, 'coding', 5000);
    b = addFocusSample(b, 'design', 5000);
    for (const c of ['chat', 'browsing', 'video', 'meeting', 'idle', 'other'] as const) b = addFocusSample(b, c, 5000);
    expect(b.focusMs).toBe(10_000);
    expect(bet.focusMs).toBe(0); // pure
  });
  it('focusMinutes floors', () => {
    expect(focusMinutes({ focusMs: 59_999 })).toBe(0);
    expect(focusMinutes({ focusMs: 60_000 })).toBe(1);
    expect(focusMinutes({ focusMs: 179_999 })).toBe(2);
  });
});

describe('decideReport', () => {
  it.each([
    [200, { status: 'Open' }, 'continue'],
    [200, { status: 'Won' }, 'won'],
    [200, { status: 'Lost' }, 'check'],
    [200, {}, 'check'],
    [400, { error: 'more focus than time since the stake' }, 'continue'],
    [400, { error: 'focusMinutes must be a non-negative integer' }, 'continue'],
    [403, { error: 'wrong progress key' }, 'stop'],
    [404, { error: 'no such bet' }, 'stop'],
    [409, { error: 'bet is Lost' }, 'check'],
    [429, { error: 'too many reports, wait 20 seconds' }, 'continue'],
    [0, {}, 'continue'],
    [500, {}, 'continue'],
    [503, {}, 'continue'],
  ] as const)('%i %j -> %s', (status, body, out) => {
    expect(decideReport(status, body)).toBe(out);
  });
});

describe('focusStatusLine', () => {
  const now = 1_000_000_000;
  it('shows minutes, goal and time left once the deadline is known', () => {
    expect(focusStatusLine({ ...bet, focusMs: 12 * 60_000 + 30_000, deadline: now + 100 * 60_000, goal: 1, goalMinutes: 120 }, now)).toBe('Focus bet: 12 / 120 min, 1h 40m left');
    expect(focusStatusLine({ ...bet, focusMs: 60_000, deadline: now + 4 * 60_000 + 1, goal: 0, goalMinutes: 3 }, now)).toBe('Focus bet: 1 / 3 min, 5m left');
  });
  it('shows minutes so far before the deadline is known', () => {
    expect(focusStatusLine(bet, now)).toBe('Focus bet: 0 min so far');
  });
  it('waits for the result past the deadline', () => {
    expect(focusStatusLine({ ...bet, deadline: now, goal: 0, goalMinutes: 3 }, now)).toBe('Focus bet: waiting for the result');
  });
});
