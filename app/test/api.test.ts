import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../src/main/api';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  it('sends the bearer token and parses myChogs', async () => {
    const f = vi.fn().mockResolvedValue(json({ tokenIds: [5, 9] }));
    const api = createApi({ baseUrl: 'https://x.test/', token: 'T', fetchImpl: f });
    expect(await api.myChogs()).toEqual([5, 9]);
    expect(f.mock.calls[0][0]).toBe('https://x.test/api/me/chogs');
    expect(f.mock.calls[0][1].headers.authorization).toBe('Bearer T');
  });
  it('drops non-integer ids from a sloppy response', async () => {
    const api = createApi({ baseUrl: 'https://x.test', token: 'T', fetchImpl: vi.fn().mockResolvedValue(json({ tokenIds: [5, '6', null, 7.5] })) });
    expect(await api.myChogs()).toEqual([5]);
  });
  it.each([401, 403, 500])('HTTP %i -> ApiError with status', async (status) => {
    const api = createApi({ baseUrl: 'https://x.test', token: 'T', fetchImpl: vi.fn().mockResolvedValue(json({ error: 'nope' }, status)) });
    await expect(api.myChogs()).rejects.toMatchObject({ status });
  });
  it('network failure -> ApiError status 0', async () => {
    const api = createApi({ baseUrl: 'https://x.test', fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
    const e = await api.myChogs().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(0);
  });
  it('uploadActivity posts JSON', async () => {
    const f = vi.fn().mockResolvedValue(json({ ok: true }));
    const totals = { minutes: { coding: 5 }, lateMinutes: 0, earlyMinutes: 0 } as never;
    await createApi({ baseUrl: 'https://x.test', token: 'T', fetchImpl: f }).uploadActivity({ tokenId: 5, day: '2026-10-09', totals });
    expect(f.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ tokenId: 5, day: '2026-10-09', totals });
  });
  it('diary returns text', async () => {
    const api = createApi({ baseUrl: 'https://x.test', token: 'T', fetchImpl: vi.fn().mockResolvedValue(json({ text: 'Dear diary', source: 'gemini' })) });
    expect(await api.diary({ tokenId: 5, totals: {} as never })).toBe('Dear diary');
  });
});
