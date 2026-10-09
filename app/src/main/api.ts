import type { DailyTotals } from '@chog/core';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApi(opts: { baseUrl: string; token?: string | null; fetchImpl?: typeof fetch }) {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ApiError(`backend unreachable: ${(e as Error).message}`, 0);
    }
    if (!res.ok) throw new ApiError(`backend HTTP ${res.status} on ${path}`, res.status);
    return (await res.json()) as T;
  }

  return {
    async myChogs(): Promise<number[]> {
      const r = await call<{ tokenIds?: unknown[] }>('/api/me/chogs');
      return (r.tokenIds ?? []).filter((x): x is number => Number.isInteger(x));
    },
    async uploadActivity(body: { tokenId: number; day: string; totals: DailyTotals }): Promise<void> {
      await call('/api/activity', { method: 'POST', body });
    },
    async diary(body: { tokenId: number; totals: DailyTotals }): Promise<string> {
      const r = await call<{ text?: unknown }>('/api/diary', { method: 'POST', body });
      if (typeof r.text !== 'string') throw new ApiError('diary: malformed response', 502);
      return r.text;
    },
  };
}
