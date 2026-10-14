import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './fsutil';
import type { ChatMessage } from './llm/types';
import { seal, unseal, type Cipher } from './secrets';

export type LoggedMessage = ChatMessage & { at: number; tokenId: number };
export const CHATLOG_CAP = 200;
const FILE = 'chat-history.bin';

export function loadChatLog(dir: string, c: Cipher): LoggedMessage[] {
  let sealed: string;
  try {
    sealed = readFileSync(join(dir, FILE), 'utf8');
  } catch {
    return [];
  }
  const plain = unseal(c, sealed);
  if (!plain) return [];
  try {
    const v = JSON.parse(plain);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// The log is only ever written sealed: with no encryption available, nothing is written.
export function appendChatLog(dir: string, c: Cipher, msgs: LoggedMessage[]): void {
  if (!c.available()) return;
  const next = [...loadChatLog(dir, c), ...msgs].slice(-CHATLOG_CAP);
  const sealed = seal(c, JSON.stringify(next));
  if (!sealed) return;
  atomicWrite(join(dir, FILE), sealed);
}

export function wipeChatLog(dir: string): void {
  rmSync(join(dir, FILE), { force: true });
  rmSync(join(dir, `${FILE}.tmp`), { force: true });
}

export const forToken = (log: LoggedMessage[], tokenId: number) => log.filter((m) => m.tokenId === tokenId);
