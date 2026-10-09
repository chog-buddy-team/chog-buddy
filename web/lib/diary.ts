import { ARCHETYPES, type ArchetypeId, type Category, type DailyTotals } from '@chog/core';

const VOICE: Record<ArchetypeId, string> = {
  hype: 'over-the-top hype friend, all caps energy, supportive',
  grump: 'grumpy, sarcastic, secretly caring',
  lazySage: 'sleepy zen philosopher, short wise sentences',
  chaos: 'chaotic gremlin, absurd jokes, playful',
  sweetheart: 'warm, gentle, encouraging',
};

const ACTIVE: Category[] = ['coding', 'design', 'chat', 'browsing', 'video', 'meeting', 'other'];

function topCategory(t: DailyTotals): Category | null {
  const [cat, min] = ACTIVE.map((c) => [c, t.minutes[c]] as const).sort((a, b) => b[1] - a[1])[0];
  return min >= 1 ? cat : null;
}

export function buildDiaryPrompt(archetype: ArchetypeId, chogName: string, t: DailyTotals): string {
  const lines = (Object.entries(t.minutes) as Array<[Category, number]>)
    .filter(([, m]) => Math.round(m) > 0)
    .map(([c, m]) => `${c}: ${Math.round(m)} min`);
  if (t.lateMinutes >= 1) lines.push(`late night: ${Math.round(t.lateMinutes)} min`);
  if (t.earlyMinutes >= 1) lines.push(`early morning: ${Math.round(t.earlyMinutes)} min`);
  return [
    `You are ${chogName}, a ${ARCHETYPES[archetype].name}: ${VOICE[archetype]}.`,
    `You live on your owner's computer. Write today's diary entry about your owner's day in first person, max 80 words.`,
    `You only know these time totals, nothing else. Do not invent apps, people or events.`,
    lines.join('\n') || 'no activity recorded',
  ].join('\n\n');
}

export function templateDiary(archetype: ArchetypeId, t: DailyTotals): string {
  const top = topCategory(t);
  if (!top) return 'Quiet day. My human barely touched the computer. I napped on the taskbar.';
  const mins = Math.round(t.minutes[top]);
  const by: Record<ArchetypeId, string> = {
    hype: `TODAY WAS HUGE. ${mins} minutes of ${top}! My human is unstoppable.`,
    grump: `${mins} minutes of ${top}. Riveting. I watched the whole thing. Again.`,
    lazySage: `Today the river flowed toward ${top}. ${mins} minutes. I mostly slept.`,
    chaos: `${mins} MINUTES OF ${top.toUpperCase()}. I pressed zero buttons. Probably.`,
    sweetheart: `We spent ${mins} minutes on ${top} today. I'm so proud of my human.`,
  };
  return by[archetype];
}

export async function generateDiary(
  archetype: ArchetypeId,
  chogName: string,
  t: DailyTotals,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; source: 'gemini' | 'template' }> {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  if (key) {
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: buildDiaryPrompt(archetype, chogName, t) }] }] }),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.trim()) return { text: text.trim(), source: 'gemini' };
      }
    } catch {
      // fall through to template
    }
  }
  return { text: templateDiary(archetype, t), source: 'template' };
}
