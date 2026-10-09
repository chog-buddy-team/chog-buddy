import { readLines } from './stream';
import { ProviderError, type ChatMessage, type ChatProvider } from './types';

export function createGemini(opts: { apiKey: string | null; model?: string; fetchImpl?: typeof fetch }): ChatProvider {
  const f = opts.fetchImpl ?? fetch;
  const model = opts.model ?? 'gemini-2.5-flash';
  return {
    id: 'gemini',
    async available() {
      return !!opts.apiKey;
    },
    async stream(system: string, history: ChatMessage[], onToken: (t: string) => void) {
      if (!opts.apiKey) throw new ProviderError('no gemini key', 'auth');
      let res: Response;
      try {
        res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        throw new ProviderError(`gemini unreachable: ${(e as Error).message}`, 'network');
      }
      if (res.status === 429) throw new ProviderError('gemini quota', 'quota');
      if ([400, 401, 403].includes(res.status)) throw new ProviderError(`gemini auth ${res.status}`, 'auth');
      if (!res.ok || !res.body) throw new ProviderError(`gemini HTTP ${res.status}`, 'bad-response');
      let out = '';
      await readLines(res.body, (line) => {
        if (!line.startsWith('data:')) return;
        try {
          const json = JSON.parse(line.slice(5).trim()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          for (const p of json.candidates?.[0]?.content?.parts ?? []) {
            if (p.text) {
              out += p.text;
              onToken(p.text);
            }
          }
        } catch {
          // partial or non-JSON event: skip
        }
      });
      return out;
    },
  };
}
