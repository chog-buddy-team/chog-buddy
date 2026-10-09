import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export function startSignIn(opts: { apiUrl: string; open: (url: string) => void; timeoutMs?: number }): Promise<{ token: string; address: string }> {
  const origin = new URL(opts.apiUrl).origin;
  const state = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    let done = false;
    const cors = (res: ServerResponse) => {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
    };
    const finish = (err: Error | null, value?: { token: string; address: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      if (err) reject(err);
      else resolve(value!);
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      cors(res);
      if (req.url !== '/callback') return void res.writeHead(404).end();
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      if (req.method !== 'POST') return void res.writeHead(405).end();

      // Check origin header if present
      if (req.headers.origin && req.headers.origin !== origin) {
        return void res.writeHead(403).end();
      }

      // Check content-type header
      const contentType = req.headers['content-type'];
      if (!contentType || !contentType.startsWith('application/json')) {
        return void res.writeHead(415).end();
      }

      // Check content-length early
      const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
      if (contentLength > 10_000) {
        return void res.writeHead(413, { 'connection': 'close' }).end();
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      req.on('data', (c: Buffer) => {
        totalBytes += c.length;
        if (totalBytes > 10_000) {
          req.removeAllListeners('data');
          return void res.writeHead(413, { 'connection': 'close' }).end(() => req.destroy());
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let body: { state?: unknown; token?: unknown; address?: unknown };
        try {
          body = JSON.parse(raw);
        } catch {
          return void res.writeHead(400).end();
        }
        if (!body || typeof body !== 'object') return void res.writeHead(400).end();
        if (body.state !== state) return void res.writeHead(403).end();
        if (typeof body.token !== 'string' || typeof body.address !== 'string') return void res.writeHead(400).end();
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        finish(null, { token: body.token, address: body.address });
      });
    });

    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 1_000;
    server.on('error', (e) => finish(e));

    const timer = setTimeout(() => finish(new Error('sign-in timed out')), opts.timeoutMs ?? 300_000);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      opts.open(`${opts.apiUrl.replace(/\/+$/, '')}/connect?port=${port}&state=${state}`);
    });
  });
}
