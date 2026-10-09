import { ARCHETYPES, type ArchetypeId, type Category, type DailyTotals } from '@chog/core';

export function buildSystemPrompt(i: { chogName: string; archetype: ArchetypeId; totals: DailyTotals }): string {
  const a = ARCHETYPES[i.archetype];
  const day = (Object.entries(i.totals.minutes) as Array<[Category, number]>)
    .filter(([, m]) => Math.round(m) > 0)
    .map(([c, m]) => `${c}: ${Math.round(m)} min`)
    .join(', ');
  return [
    `You are ${i.chogName}, a ${a.name}: ${a.voice}.`,
    `You are a tiny pixel creature living on your owner's desktop. Stay in character, reply in 1-3 short sentences, no markdown.`,
    `What you know about your owner's day so far (time per activity type only): ${day || 'nothing yet'}.`,
    `You cannot see their screen, files or messages. If asked, say so playfully.`,
  ].join('\n');
}
