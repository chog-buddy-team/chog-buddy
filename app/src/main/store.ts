import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSkinId, type DailyTotals, type SkinId } from '@chog/core';
import { dayKey, emptyTotals } from './tally';

export type ChatPrefs = { provider: 'auto' | 'ollama' | 'gemini'; ollamaModel: string; geminiKeyEnc: string | null };
export type Settings = { tokenId: number; focusMode: boolean; today: { day: string; totals: DailyTotals }; chat: ChatPrefs; skin: SkinId };

const DEMO_TOKEN_ID = 5; // replaced by the signed-in Owner's choice in the integration plan
const CHAT_DEFAULTS: ChatPrefs = { provider: 'auto', ollamaModel: 'llama3.2', geminiKeyEnc: null };

export function loadSettings(dir: string): Settings {
  const defaults: Settings = { tokenId: DEMO_TOKEN_ID, focusMode: false, today: { day: dayKey(new Date()), totals: emptyTotals() }, chat: { ...CHAT_DEFAULTS }, skin: 'classic' };
  try {
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    return { ...defaults, ...saved, chat: { ...CHAT_DEFAULTS, ...(saved?.chat && typeof saved.chat === 'object' && !Array.isArray(saved.chat) ? saved.chat : {}) }, skin: isSkinId(saved?.skin) ? saved.skin : 'classic' };
  } catch {
    return defaults;
  }
}

export function saveSettings(dir: string, s: Settings): void {
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(s, null, 2));
}
