import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSkinId, type DailyTotals, type SkinId } from '@chog/core';
import { atomicWrite } from './fsutil';
import type { FocusBet } from './focusbet';
import { JUDGE_TOKEN_ID } from './startup';
import { dayKey, emptyTotals } from './tally';

export type ChatPrefs = { provider: 'auto' | 'server' | 'ollama' | 'gemini'; ollamaModel: string; geminiKeyEnc: string | null };
export type Settings = {
  tokenId: number;
  focusMode: boolean;
  today: { day: string; totals: DailyTotals };
  chat: ChatPrefs;
  judgeMode: boolean;
  session: { tokenEnc: string; address: string } | null;
  secrets: { githubEnc: string | null; icalEnc: string | null };
  lastUpload: number;
  lastOwnershipCheck: number;
  yesterday: { day: string; totals: DailyTotals } | null;
  skin: SkinId;
  focusBet: FocusBet | null; // the open Focus Bet, if any; its key is sealed
};

const CHAT_DEFAULTS: ChatPrefs = { provider: 'auto', ollamaModel: 'llama3.2', geminiKeyEnc: null };

// A saved nested block that is not a plain object (null, string, array) must not wipe its defaults.
const plainObject = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const savedBet = (v: unknown): FocusBet | null => {
  const b = plainObject(v) as Partial<FocusBet>;
  return typeof b.betId === 'string' && typeof b.keyEnc === 'string' && Number.isFinite(b.focusMs) ? (b as FocusBet) : null;
};

export function loadSettings(dir: string): Settings {
  const defaults: Settings = {
    tokenId: JUDGE_TOKEN_ID, focusMode: false, today: { day: dayKey(new Date()), totals: emptyTotals() }, chat: { ...CHAT_DEFAULTS },
    judgeMode: false, session: null, secrets: { githubEnc: null, icalEnc: null }, lastUpload: 0, lastOwnershipCheck: 0, yesterday: null, skin: 'classic', focusBet: null,
  };
  try {
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    return { ...defaults, ...saved, chat: { ...CHAT_DEFAULTS, ...plainObject(saved?.chat) }, secrets: { ...defaults.secrets, ...plainObject(saved?.secrets) }, skin: isSkinId(saved?.skin) ? saved.skin : 'classic', focusBet: savedBet(saved?.focusBet) };
  } catch {
    return defaults;
  }
}

export function saveSettings(dir: string, s: Settings): void {
  atomicWrite(join(dir, 'settings.json'), JSON.stringify(s, null, 2));
}
