import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/chat/route';

// vi.hoisted: the mocks below are hoisted above the static route import, so their state must be too.
const { generateChat, state } = vi.hoisted(() => ({
  generateChat: vi.fn().mockResolvedValue({ text: 'hi', source: 'groq' }),
  state: { usage: {} as Record<string, number> },
}));
vi.mock('@/lib/chat', async (orig) => ({ ...(await orig<typeof import('@/lib/chat')>()), generateChat }));
vi.mock('@/lib/caps', () => ({
  chatCaps: () => ({ perCaller: 2, global: 3 }),
  callerKey: () => 'ip:x',
  bumpChatUsage: async (k: string) => (state.usage[k] = (state.usage[k] ?? 0) + 1),
}));
vi.mock('@chog/core', async (orig) => ({ ...(await orig<typeof import('@chog/core')>()), fetchChogMetadata: async () => ({ tokenId: 5, name: 'CHOG #5', image: '', attributes: [] }) }));

// Static import (vi.mock is hoisted above it): a cold dynamic import of the route can exceed the 5 s test timeout.
const call = async () => {
  return POST(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify({ tokenId: 5, messages: [{ role: 'user', text: 'hi' }] }) }));
};

describe('chat route caps', () => {
  beforeEach(() => { state.usage = {}; generateChat.mockClear(); });
  it('global cap hit but caller under cap: Gemini off, backups on', async () => {
    state.usage.global = 3; // next bump makes 4 > 3
    await call();
    expect(generateChat.mock.calls[0].slice(5, 7)).toEqual([false, true]);
  });
  it('caller over cap: everything off', async () => {
    state.usage['ip:x'] = 2;
    await call();
    expect(generateChat.mock.calls[0].slice(5, 7)).toEqual([false, false]);
  });
});
