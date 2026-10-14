import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DailyTotals } from '@chog/core';
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
};

const DEMO_TOKEN_ID = 5; // replaced by the signed-in Owner's choice in the integration plan
const CHAT_DEFAULTS: ChatPrefs = { provider: 'auto', ollamaModel: 'llama3.2', geminiKeyEnc: null };

// A saved nested block that is not a plain object (null, string, array) must not wipe its defaults.
const plainObject = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function loadSettings(dir: string): Settings {
  const defaults: Settings = {
    tokenId: DEMO_TOKEN_ID, focusMode: false, today: { day: dayKey(new Date()), totals: emptyTotals() }, chat: { ...CHAT_DEFAULTS },
    judgeMode: false, session: null, secrets: { githubEnc: null, icalEnc: null }, lastUpload: 0, lastOwnershipCheck: 0, yesterday: null,
  };
  try {
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    return { ...defaults, ...saved, chat: { ...CHAT_DEFAULTS, ...plainObject(saved?.chat) }, secrets: { ...defaults.secrets, ...plainObject(saved?.secrets) } };
  } catch {
    return defaults;
  }
}

export function saveSettings(dir: string, s: Settings): void {
  const file = join(dir, 'settings.json');
  const json = JSON.stringify(s, null, 2);
  writeFileSync(`${file}.tmp`, json, { flush: true });
  try {
    renameSync(`${file}.tmp`, file); // atomic replace: a crash mid-write leaves the previous settings.json intact
  } catch {
    writeFileSync(file, json); // Windows: another process may block the rename (EPERM/EBUSY); a plain write still saves
  }
}
