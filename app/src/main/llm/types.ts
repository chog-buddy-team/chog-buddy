export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type ChatProvider = {
  id: 'ollama' | 'gemini';
  available(): Promise<boolean>;
  stream(system: string, history: ChatMessage[], onToken: (t: string) => void): Promise<string>;
};

export class ProviderError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'quota' | 'network' | 'bad-response') {
    super(message);
    this.name = 'ProviderError';
  }
}
