// Stand-in for the Chog Buddy Pet's Focus Bets part, for trying a bet before the real app has it.
// Run: node web/scripts/fake-pet.mjs [site]   (site defaults to https://chogbuddy.vercel.app)
// It prints a /focus link; open it, stake, and this script reports "focused the whole time" every 30 s.
// This is also the reference for the real app's loopback contract (see the Focus Bets spec).
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const SITE = (process.argv[2] ?? 'https://chogbuddy.vercel.app').replace(/\/$/, '');
// The bet page may be served from either Vercel address.
const ORIGINS = new Set([SITE, 'https://chogbuddy.vercel.app', 'https://chog-buddy-api.vercel.app']);
const state = randomBytes(16).toString('hex');
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function cors(req, res) {
  if (ORIGINS.has(req.headers.origin)) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  // Chrome asks before an https page may call a local address.
  if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

async function report(betId, key, since) {
  const focusMinutes = Math.floor((Date.now() - since) / 60_000);
  const r = await fetch(`${SITE}/api/focus/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ betId, key, focusMinutes }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
  const j = await r.json().catch(() => ({}));
  log(`bet ${betId}: reported ${focusMinutes} min ->`, r.status, j.status ?? j.error, j.minutes !== undefined ? `(server counts ${j.minutes} min)` : '');
  return j.status;
}

let current = null;
function start(betId, key) {
  if (current?.betId === betId) return log(`bet ${betId}: key received again`);
  clearInterval(current?.timer);
  const since = Date.now();
  log(`bet ${betId}: got the progress key, reporting every 30 s`);
  current = { betId, timer: null };
  current.timer = setInterval(async () => {
    const status = await report(betId, key, since);
    if (status && status !== 'Open') {
      clearInterval(current.timer);
      log(`bet ${betId}: ${status}${status === 'Won' ? ' - go back to the page and press Claim' : ''}`);
    }
  }, 30_000);
}

const server = createServer((req, res) => {
  cors(req, res);
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (url.pathname !== '/focus') return res.writeHead(404).end();
  if (req.method === 'GET') return res.writeHead(url.searchParams.get('state') === state ? 200 : 403).end();
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const b = JSON.parse(body);
        if (b.state !== state) return res.writeHead(403).end();
        if (!/^\d+$/.test(String(b.betId)) || !/^0x[0-9a-fA-F]{64}$/.test(b.key)) return res.writeHead(400).end();
        start(String(b.betId), b.key);
        res.writeHead(200).end();
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  res.writeHead(405).end();
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  log('Fake Pet listening on 127.0.0.1:' + port);
  console.log(`\nOpen this link in the browser that has your wallet:\n${SITE}/focus?port=${port}&state=${state}\n`);
  console.log('Keep this window open until the bet ends. Ctrl+C to stop.');
});
