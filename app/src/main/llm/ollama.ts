import { readLines } from './stream';
import { ProviderError, type ChatMessage, type ChatProvider } from './types';

export function createOllama(opts: { model: string; baseUrl?: string; fetchImpl?: typeof fetch }): ChatProvider & { listModels(): Promise<string[]> } {
  const base = opts.baseUrl ?? 'http://127.0.0.1:11434';
  const f = opts.fetchImpl ?? fetch;

  async function listModels(): Promise<string[]> {
    const res = await f(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    return (json.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string');
  }

  return {
    id: 'ollama',
    listModels,
    async available() {
      try {
        return (await listModels()).length > 0;
      } catch {
        return false;
      }
    },
    async stream(system: string, history: ChatMessage[], onToken: (t: string) => void) {
      let res: Response;
      try {
        res = await f(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: opts.model, stream: true, messages: [{ role: 'system', content: system }, ...history] }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        throw new ProviderError(`ollama unreachable: ${(e as Error).message}`, 'network');
      }
      if (!res.ok || !res.body) throw new ProviderError(`ollama HTTP ${res.status}`, 'bad-response');
      let out = '';
      try {
        await readLines(res.body, (line) => {
          if (!line.trim()) return;
          let parsed: { message?: { content?: string }; error?: string };
          try {
            parsed = JSON.parse(line);
          } catch {
            // ignore a malformed line rather than aborting the reply
            return;
          }
          if (parsed.error) throw new ProviderError(`ollama error: ${parsed.error}`, 'bad-response');
          const t = parsed.message?.content;
          if (t) {
            out += t;
            onToken(t);
          }
        });
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        throw new ProviderError(`stream error: ${(e as Error).message}`, 'network');
      }
      if (!out) throw new ProviderError('empty reply', 'bad-response');
      return out;
    },
  };
}
