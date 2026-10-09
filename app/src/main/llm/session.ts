import { ProviderError, type ChatMessage, type ChatProvider } from './types';

export type ProviderPref = 'auto' | 'ollama' | 'gemini';
export const HISTORY_CAP = 20;
export const MAX_INPUT = 500;

const LINES: Record<ProviderError['kind'] | 'none', string> = {
  none: "I can't think yet! Install Ollama, or add a Gemini key from my tray menu.",
  auth: "My Gemini key isn't working. Set a new one from the tray menu?",
  quota: "I'm all talked out for now (free tier limit). Try again in a bit!",
  network: "I can't reach my brain right now. Is the internet (or Ollama) on?",
  'bad-response': 'Brain glitch. Say that again?',
};

export const errorLine = (kind: ProviderError['kind'] | 'none') => LINES[kind];

export async function pickProvider(pref: ProviderPref, providers: ChatProvider[]): Promise<ChatProvider | null> {
  const order = pref === 'auto' ? ['ollama', 'gemini'] : [pref];
  for (const id of order) {
    const p = providers.find((x) => x.id === id);
    if (p && (await p.available())) return p;
  }
  return null;
}

export class ChatSession {
  history: ChatMessage[] = [];

  constructor(
    private getProviders: () => ChatProvider[],
    private getPref: () => ProviderPref,
    private getSystem: () => string,
  ) {}

  async send(text: string, onToken: (t: string) => void): Promise<{ reply: string; provider: ChatProvider['id'] | null; failed: boolean }> {
    const content = text.trim().slice(0, MAX_INPUT);
    if (!content) return { reply: '', provider: null, failed: false };
    const turn: ChatMessage[] = [...this.history, { role: 'user', content }];
    let provider: ChatProvider | null = null;
    try {
      provider = await pickProvider(this.getPref(), this.getProviders());
      if (!provider) return { reply: errorLine('none'), provider: null, failed: true };
      const reply = await provider.stream(this.getSystem(), turn, onToken);
      this.history = [...turn, { role: 'assistant' as const, content: reply }].slice(-HISTORY_CAP);
      return { reply, provider: provider.id, failed: false };
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : 'bad-response';
      return { reply: errorLine(kind), provider: provider?.id ?? null, failed: true };
    }
  }
}
