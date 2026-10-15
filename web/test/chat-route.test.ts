import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateChat = vi.fn().mockResolvedValue({ text: 'hi', source: 'groq' });
let usage: Record<string, number> = {};
vi.mock('@/lib/chat', async (orig) => ({ ...(await orig<typeof import('@/lib/chat')>()), generateChat }));
vi.mock('@/lib/caps', () => ({
  chatCaps: () => ({ perCaller: 2, global: 3 }),
  callerKey: () => 'ip:x',
  bumpChatUsage: async (k: string) => (usage[k] = (usage[k] ?? 0) + 1),
}));
vi.mock('@chog/core', async (orig) => ({ ...(await orig<typeof import('@chog/core')>()), fetchChogMetadata: async () => ({ tokenId: 5, name: 'CHOG #5', image: '', attributes: [] }) }));

const call = async () => {
  const { POST } = await import('@/app/api/chat/route');
  return POST(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify({ tokenId: 5, messages: [{ role: 'user', text: 'hi' }] }) }));
};

describe('chat route caps', () => {
  beforeEach(() => { usage = {}; generateChat.mockClear(); });
  it('global cap hit but caller under cap: Gemini off, backups on', async () => {
    usage.global = 3; // next bump makes 4 > 3
    await call();
    expect(generateChat.mock.calls[0].slice(5, 7)).toEqual([false, true]);
  });
  it('caller over cap: everything off', async () => {
    usage['ip:x'] = 2;
    await call();
    expect(generateChat.mock.calls[0].slice(5, 7)).toEqual([false, false]);
  });
});
