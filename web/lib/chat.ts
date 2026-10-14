import { ARCHETYPES, assertTokenId, type ArchetypeId } from '@chog/core';
import { VOICE } from './diary';

export type ChatMessage = { role: 'user' | 'model'; text: string };

const MAX_TURNS = 20;
const MAX_CHARS = 500;

export function parseChatBody(x: unknown): { tokenId: number; messages: ChatMessage[] } {
  const b = x as { tokenId?: unknown; messages?: unknown } | null;
  if (typeof b?.tokenId !== 'number') throw new TypeError('tokenId must be a number');
  try {
    assertTokenId(b.tokenId);
  } catch (e) {
    throw new TypeError((e as Error).message);
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > MAX_TURNS) throw new TypeError(`messages must have 1-${MAX_TURNS} turns`);
  const messages = b.messages.map((m: { role?: unknown; text?: unknown }): ChatMessage => {
    if (m?.role !== 'user' && m?.role !== 'model') throw new TypeError('role must be user or model');
    const text = typeof m.text === 'string' ? m.text.trim() : '';
    if (!text || text.length > MAX_CHARS) throw new TypeError(`text must be 1-${MAX_CHARS} characters`);
    return { role: m.role, text };
  });
  if (messages.at(-1)!.role !== 'user') throw new TypeError('last message must be from the user');
  return { tokenId: b.tokenId, messages };
}

// Built on the server from the Chog's real Traits; the client never supplies the persona.
export function buildChatSystemPrompt(archetype: ArchetypeId, chogName: string): string {
  return [
    `You are ${chogName}, a ${ARCHETYPES[archetype].name}: ${VOICE[archetype]}.`,
    `You are a small pixel creature living on your owner's computer screen as a desktop pet. Stay in character.`,
    `Your reply shows in a tiny speech bubble: 1-2 short sentences, at most 25 words. Match the length of the owner's message; a quick greeting gets a quick answer. Plain text only, no markdown.`,
    `You cannot see the owner's screen, files or apps; never claim to.`,
  ].join('\n');
}

const FALLBACK: Record<ArchetypeId, string> = {
  hype: "MY BRAIN IS RECHARGING!! Hit me up again in a bit, it's gonna be HUGE.",
  grump: "Not now. My thinking department is closed. Try again later.",
  lazySage: 'The mind, like a river, is resting. Speak to me again soon.',
  chaos: 'ERROR 404: brain went to buy snacks. brb maybe.',
  sweetheart: "I'm a little too sleepy to think right now. Talk to me again soon?",
};

export const fallbackReply = (archetype: ArchetypeId) => FALLBACK[archetype];

export async function generateChat(
  archetype: ArchetypeId,
  chogName: string,
  messages: ChatMessage[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
  allowGemini = true, // false once a daily cap is hit
): Promise<{ text: string; source: 'gemini' | 'fallback' }> {
  const key = allowGemini ? process.env.GEMINI_API_KEY : undefined;
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  if (key) {
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildChatSystemPrompt(archetype, chogName) }] },
          contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
          generationConfig: { maxOutputTokens: 100 }, // backstop; the prompt asks for 25 words
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.trim()) return { text: text.trim(), source: 'gemini' };
      }
    } catch {
      // fall through to the in-character fallback
    }
  }
  return { text: fallbackReply(archetype), source: 'fallback' };
}
