import { ProviderError, type ChatMessage, type ChatProvider } from './types';

const COOLDOWN_MS = 60_000;
const MAX_TURNS = 20;
const MAX_CHARS = 500;
const downUntil = new Map<string, number>();

export const resetServerBreaker = () => downUntil.clear();

export function createServerChat(opts: { apiUrl: string; tokenId: number; token?: string | null; fetchImpl?: typeof fetch; now?: () => number }): ChatProvider {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const base = opts.apiUrl.replace(/\/+$/, '');
  const trip = () => downUntil.set(base, now() + COOLDOWN_MS);
  return {
    id: 'server',
    async available() {
      return now() >= (downUntil.get(base) ?? 0);
    },
    async stream(_system: string, history: ChatMessage[], onToken: (t: string) => void) {
      const messages = history
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.content.trim().slice(0, MAX_CHARS) }))
        .filter((m) => m.text.length > 0)
        .slice(-MAX_TURNS);
      // A full session (20 turns + the new message) trims to a window that opens on a model turn; start on a user turn.
      while (messages[0]?.role === 'model') messages.shift();
      let res: Response;
      try {
        res = await f(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
          body: JSON.stringify({ tokenId: opts.tokenId, messages }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        trip();
        throw new ProviderError(`chog server unreachable: ${(e as Error).message}`, 'network');
      }
      if (res.status === 429) throw new ProviderError('chog server busy', 'quota');
      if (res.status === 400) throw new ProviderError('chog server rejected the message', 'bad-response');
      if (!res.ok) {
        trip();
        throw new ProviderError(`chog server HTTP ${res.status}`, 'network');
      }
      const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof body?.text !== 'string' || !body.text.trim()) throw new ProviderError('chog server: empty reply', 'bad-response');
      const text = body.text.trim();
      onToken(text);
      return text;
    },
  };
}
