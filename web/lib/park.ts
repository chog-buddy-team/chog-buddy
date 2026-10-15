import { ARCHETYPES, fetchChogMetadata, ipfsToHttp, parseDailyTotals, pickArchetype, type ArchetypeId, type Category, type DailyTotals } from '@chog/core';
import { sql } from './db';

export type ParkRow = { tokenId: number; day: string; totals: unknown; demo: boolean; soul: { nightOwl: number; grinder: number; social: number; creator: number; level: number } | null };
export type ParkMeta = { name: string; image: string | null; archetype: ArchetypeId | null };
export type ParkChog = { tokenId: number; name: string; image: string | null; archetypeName: string | null; demo: boolean; soul: ParkRow['soul']; mood: string; focusMinutes: number; day: string };

const ACTIVE: Category[] = ['coding', 'design', 'chat', 'browsing', 'video', 'meeting', 'other'];
const MOOD: Record<ArchetypeId, Partial<Record<Category, string>> & { none: string }> = {
  hype: { coding: 'CODING SPREE! Unstoppable!', design: 'Making beautiful things!!', chat: 'Social butterfly mode!', video: 'Movie marathon energy!', meeting: 'Crushing meetings!', none: 'Charging up for tomorrow!' },
  grump: { coding: 'Watched them code. Fine. It was fine.', design: 'Pixels. So many pixels.', chat: 'So much talking.', video: 'Videos again. Riveting.', meeting: 'Meetings. Ugh.', none: 'Quiet. Finally.' },
  lazySage: { coding: 'The code flows like a river.', design: 'Shapes, colours, stillness.', chat: 'Many words, one silence.', video: 'Watching shadows on a screen.', meeting: 'Circles of talk.', none: 'Resting. As one should.' },
  chaos: { coding: 'Typed SO many semicolons. Maybe.', design: 'Drew a duck. Probably a duck.', chat: 'Gossip goblin hours!', video: 'Ate the popcorn. All of it.', meeting: 'Unmuted at the worst time.', none: 'Hiding in the recycle bin.' },
  sweetheart: { coding: 'So proud of all that coding!', design: 'Made something lovely today.', chat: 'Caught up with friends!', video: 'Cozy video time.', meeting: 'Brave through the meetings!', none: 'Taking it easy. Good.' },
};

export function moodLine(archetype: ArchetypeId | null, t: DailyTotals | null): string {
  const a = archetype ?? 'sweetheart';
  if (!t) return MOOD[a].none;
  const [top, min] = ACTIVE.map((c) => [c, t.minutes[c]] as const).sort((x, y) => y[1] - x[1])[0];
  return (min >= 1 && MOOD[a][top]) || MOOD[a].none;
}

const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export function buildPark(rows: ParkRow[], metas: Map<number, ParkMeta>, today: string) {
  // Owner-local days run up to a day ahead of UTC (east of UTC), so 'today' covers yesterday through tomorrow.
  const oldest = dayBefore(today);
  const chogs: ParkChog[] = rows.map((r) => {
    let t: DailyTotals | null = null;
    try { t = parseDailyTotals(r.totals); } catch { t = null; }
    const m = metas.get(r.tokenId);
    return {
      tokenId: r.tokenId,
      name: m?.name ?? `Chog #${r.tokenId}`,
      image: m?.image ?? null,
      archetypeName: m?.archetype ? ARCHETYPES[m.archetype].name : null,
      demo: r.demo,
      soul: r.soul,
      mood: moodLine(m?.archetype ?? null, t),
      focusMinutes: t ? Math.round(t.minutes.coding + t.minutes.design) : 0,
      day: r.day,
    };
  });
  chogs.sort((a, b) => (b.soul?.level ?? -1) - (a.soul?.level ?? -1) || a.tokenId - b.tokenId);
  const leaderboard = chogs
    .filter((c) => !c.demo && c.day >= oldest && c.focusMinutes > 0) // the demo Chog's day is made up, so it never ranks
    .sort((a, b) => b.focusMinutes - a.focusMinutes || a.tokenId - b.tokenId)
    .slice(0, 10)
    .map(({ tokenId, name, focusMinutes }) => ({ tokenId, name, focusMinutes }));
  return { chogs, leaderboard };
}

// ponytail: one metadata fetch per active Chog every 5 min (page revalidate); cache metadata in the DB if the Park grows past ~200 Chogs. limit 300 cuts by token id, not recency.
export async function loadPark() {
  const rows = (await sql`
    select distinct on (a.token_id) a.token_id, to_char(a.day, 'YYYY-MM-DD') as day, a.totals, a.owner = 'demo' as demo,
      s.night_owl, s.grinder, s.social, s.creator, s.level, to_char(current_date, 'YYYY-MM-DD') as today
    from activity a left join souls s on s.token_id = a.token_id
    where a.day > current_date - 7
    order by a.token_id, a.day desc
    limit 300`) as Array<{ token_id: number; day: string; totals: unknown; demo: boolean; night_owl: number | null; grinder: number | null; social: number | null; creator: number | null; level: number | null; today: string }>;
  const today = rows[0]?.today ?? new Date().toISOString().slice(0, 10);
  const parkRows: ParkRow[] = rows.map((r) => ({
    tokenId: r.token_id, day: r.day, totals: r.totals, demo: r.demo,
    soul: r.level == null ? null : { nightOwl: r.night_owl!, grinder: r.grinder!, social: r.social!, creator: r.creator!, level: r.level },
  }));
  const metas = new Map<number, ParkMeta>();
  await Promise.allSettled(parkRows.map(async (r) => {
    const m = await fetchChogMetadata(r.tokenId);
    metas.set(r.tokenId, { name: m.name, image: m.image ? ipfsToHttp(m.image) : null, archetype: pickArchetype(m) });
  }));
  return buildPark(parkRows, metas, today);
}
