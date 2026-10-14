import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './fsutil';
import { ARCHETYPES, type ArchetypeId, type Category, type DailyTotals } from '@chog/core';

export type DiaryEntry = { day: string; tokenId: number; text: string };
const FILE = 'diary.json';
const KEEP = 30;

export function loadDiary(dir: string): DiaryEntry[] {
  try {
    const v = JSON.parse(readFileSync(join(dir, FILE), 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function appendDiary(dir: string, e: DiaryEntry): void {
  atomicWrite(join(dir, FILE), JSON.stringify([...loadDiary(dir), e].slice(-KEEP), null, 2));
}

export function wipeDiary(dir: string): void {
  rmSync(join(dir, FILE), { force: true });
  rmSync(join(dir, `${FILE}.tmp`), { force: true });
}

export function localDiaryPrompt(i: { chogName: string; archetype: ArchetypeId; totals: DailyTotals }): string {
  const a = ARCHETYPES[i.archetype];
  const day = (Object.entries(i.totals.minutes) as Array<[Category, number]>)
    .filter(([, m]) => Math.round(m) > 0)
    .map(([c, m]) => `${c}: ${Math.round(m)} min`)
    .join(', ');
  return `You are ${i.chogName}, a ${a.name} (${a.voice}). Write today's diary entry about your owner's day in first person, max 80 words, no markdown. You only know these time totals: ${day || 'no activity'}. Do not invent apps, people or events.`;
}

export async function writeDiary(i: { remote: () => Promise<string>; local: (() => Promise<string>) | null; template: string }): Promise<{ text: string; source: 'server' | 'local' | 'template' }> {
  const attempt = async (fn: () => Promise<string>) => {
    try {
      const t = (await fn()).trim();
      return t || null;
    } catch {
      return null;
    }
  };
  const s = await attempt(i.remote);
  if (s) return { text: s, source: 'server' };
  const l = i.local ? await attempt(i.local) : null;
  if (l) return { text: l, source: 'local' };
  return { text: i.template, source: 'template' };
}
