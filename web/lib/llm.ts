export type LlmTurn = { role: 'user' | 'model'; text: string };
export type LlmSource = 'gemini' | 'groq' | 'openrouter';
type Req = { system?: string; turns: LlmTurn[]; maxTokens: number };
type Opts = { fetchImpl?: typeof fetch; timeoutMs?: number; allowGemini?: boolean; allowBackup?: boolean; env?: Record<string, string | undefined> };

const clean = (t: unknown) => (typeof t === 'string' && t.trim() ? t.trim() : null);

async function gemini(r: Req, key: string, model: string, f: typeof fetch, ms: number): Promise<string | null> {
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      ...(r.system ? { systemInstruction: { parts: [{ text: r.system }] } } : {}),
      contents: r.turns.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { maxOutputTokens: r.maxTokens },
    }),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) return null;
  return clean((await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function openaiCompatible(url: string, r: Req, key: string, model: string, f: typeof fetch, ms: number): Promise<string | null> {
  const messages = [
    ...(r.system ? [{ role: 'system', content: r.system }] : []),
    ...r.turns.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
  ];
  const res = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, max_tokens: r.maxTokens }),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) return null;
  return clean((await res.json())?.choices?.[0]?.message?.content);
}

// Gemini first, then free backups. Each step is skipped when its key is unset; any failure moves on. Never throws.
export async function generateText(r: Req, o: Opts = {}): Promise<{ text: string; source: LlmSource } | null> {
  const env = o.env ?? process.env;
  const f = o.fetchImpl ?? fetch;
  const ms = o.timeoutMs ?? 10_000;
  const allowGemini = o.allowGemini ?? true;
  const allowBackup = o.allowBackup ?? true;
  const steps: Array<[LlmSource, string | undefined, boolean, () => Promise<string | null>]> = [
    ['gemini', env.GEMINI_API_KEY, allowGemini, () => gemini(r, env.GEMINI_API_KEY!, env.GEMINI_MODEL || 'gemini-flash-lite-latest', f, ms)],
    ['groq', env.GROQ_API_KEY, allowBackup, () => openaiCompatible('https://api.groq.com/openai/v1/chat/completions', r, env.GROQ_API_KEY!, env.GROQ_MODEL || 'llama-3.1-8b-instant', f, ms)],
    ['openrouter', env.OPENROUTER_API_KEY, allowBackup, () => openaiCompatible('https://openrouter.ai/api/v1/chat/completions', r, env.OPENROUTER_API_KEY!, env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', f, ms)],
  ];
  for (const [source, key, allowed, call] of steps) {
    if (!key || !allowed) continue;
    try {
      const text = await call();
      if (text) return { text, source };
    } catch {
      // next provider
    }
  }
  return null;
}
