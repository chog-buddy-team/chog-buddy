import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Category } from '@chog/core';

export const REPORT_EVERY_MS = 30_000;
// After the deadline, how long the server still takes late reports (mirrors web/lib/focus.ts GOALS[].graceMs).
export const GRACE_MS = [120_000, 900_000, 900_000, 900_000] as const;
export const GOAL_MINUTES = [3, 120, 240, 360] as const;

// keyEnc is the progress key sealed with safeStorage. The plain key never leaves main, except to our API.
export type FocusBet = { betId: string; keyEnc: string; focusMs: number; startedAt: number; deadline: number | null; goal: 0 | 1 | 2 | 3 | null; goalMinutes: number | null };

export const focusMinutes = (b: { focusMs: number }) => Math.floor(b.focusMs / 60_000);

// Only coding and design count; the daily totals are never used (they reset at midnight and predate the stake).
export function addFocusSample(b: FocusBet, category: Category, ms: number): FocusBet {
  return category === 'coding' || category === 'design' ? { ...b, focusMs: b.focusMs + ms } : b;
}

export type ProgressOutcome = 'continue' | 'won' | 'stop' | 'check';

// docs/focus-bets-for-farouk.md section 5. Status 0 = network error.
export function decideReport(status: number, body: { status?: string; error?: string }): ProgressOutcome {
  if (status === 200) return body.status === 'Open' ? 'continue' : body.status === 'Won' ? 'won' : 'check';
  if (status === 403 || status === 404) return 'stop';
  if (status === 409) return 'check';
  return 'continue'; // 400 (logged by the caller), 429, network, 5xx
}

export function focusStatusLine(b: FocusBet, nowMs: number): string {
  const n = focusMinutes(b);
  if (b.deadline === null || b.goalMinutes === null) return `Focus bet: ${n} min so far`;
  if (nowMs >= b.deadline) return 'Focus bet: waiting for the result';
  const left = Math.ceil((b.deadline - nowMs) / 60_000);
  const h = Math.floor(left / 60);
  return `Focus bet: ${n} / ${b.goalMinutes} min, ${h ? `${h}h ${left % 60}m` : `${left}m`} left`;
}

const ORIGINS = new Set(['https://chogbuddy.vercel.app', 'https://chog-buddy-api.vercel.app', 'http://localhost:3000']);
const MAX_BODY = 10_000;
const REPEAT_GRACE_MS = 5_000; // the page may "Send to the app again" right after the first POST

// The bet page hands { betId, key } to the app here. Modelled on signin.ts; contract in web/scripts/fake-pet.mjs.
export function startFocusLoopback(opts: {
  onBet: (bet: { betId: string; key: string }) => 'ok' | 'busy';
  timeoutMs?: number;
  onClose?: () => void;
}): Promise<{ port: number; state: string; close: () => void }> {
  const state = randomBytes(16).toString('hex');
  let accepted: string | null = null;
  let done = false;
  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && ORIGINS.has(origin)) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-private-network', 'true');
  };
  const close = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
    opts.onClose?.();
  };
  const server = createServer((req, res) => {
    cors(req, res);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/focus') return void res.writeHead(404).end();
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (req.method === 'GET') return void res.writeHead(url.searchParams.get('state') === state ? 200 : 403).end();
    if (req.method !== 'POST') return void res.writeHead(405).end();

    if (!req.headers['content-type']?.startsWith('application/json')) return void res.writeHead(415).end();
    if (parseInt(req.headers['content-length'] ?? '0', 10) > MAX_BODY) return void res.writeHead(413, { connection: 'close' }).end();
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY) {
        req.removeAllListeners('data');
        return void res.writeHead(413, { connection: 'close' }).end(() => req.destroy());
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (total > MAX_BODY) return;
      let body: { state?: unknown; betId?: unknown; key?: unknown };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      } catch {
        return void res.writeHead(400).end();
      }
      if (!body || typeof body !== 'object') return void res.writeHead(400).end();
      if (body.state !== state) return void res.writeHead(403).end();
      const { betId, key } = body;
      if (typeof betId !== 'string' || !/^\d+$/.test(betId) || typeof key !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(key)) return void res.writeHead(400).end();
      if (betId === accepted) return void res.writeHead(200).end(); // "Send to the app again": no-op
      let r: 'ok' | 'busy';
      try {
        r = opts.onBet({ betId, key });
      } catch {
        return void res.writeHead(500).end();
      }
      if (r === 'busy') return void res.writeHead(409).end();
      accepted = betId;
      res.writeHead(200).end();
      clearTimeout(timer);
      timer = setTimeout(close, REPEAT_GRACE_MS);
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  let timer = setTimeout(close, opts.timeoutMs ?? 30 * 60_000);
  return new Promise((resolve, reject) => {
    server.once('error', (e) => { close(); reject(e); });
    server.listen(0, '127.0.0.1', () => {
      server.on('error', close);
      resolve({ port: (server.address() as { port: number }).port, state, close });
    });
  });
}
