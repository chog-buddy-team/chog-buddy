// Minimal VEVENT reader. TZID times are treated as the machine's local time
// (good enough for a 5-minute warning when owner and calendar share a timezone).
const DAY_MS = 86_400_000;
const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// `Z` means UTC, otherwise machine-local. Null for all-day (DATE) or malformed values.
function parseIcsTime(value: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const t = z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
  return Number.isFinite(t) ? t : null;
}

// ponytail: DAILY/WEEKLY only; MONTHLY/YEARLY/BYSETPOS keep DTSTART. Steps one day at a time, at most 800 steps
// (with COUNT, counted from DTSTART, so a COUNT series older than ~2 years stops early). RECURRENCE-ID overrides are not
// matched to their series, so a moved single occurrence also warns at its original time.
function expand(start: number, utc: boolean, rule: string, exdates: Set<number>, now: number): number[] {
  const p: Record<string, string> = Object.fromEntries(rule.split(';').map((kv) => kv.split('=') as [string, string]));
  if (p.FREQ !== 'DAILY' && p.FREQ !== 'WEEKLY') return [start];
  const interval = Math.max(1, Number(p.INTERVAL) || 1);
  const until = p.UNTIL ? parseIcsTime(/^\d{8}$/.test(p.UNTIL) ? `${p.UNTIL}T235959` : p.UNTIL) : Infinity;
  if (until === null) return [start]; // unreadable UNTIL: never warn forever, keep just the first start
  const count = p.COUNT ? Number(p.COUNT) || Infinity : Infinity;
  const byday = p.FREQ === 'WEEKLY' && p.BYDAY ? p.BYDAY.split(',').map((d) => BYDAY[d.slice(-2)]).filter((d) => d !== undefined) : [];
  const days = byday.length ? byday : null; // an unreadable BYDAY behaves like none (DTSTART's weekday)
  const from = now - 3600_000, to = now + 48 * 3600_000;
  const out: number[] = [];
  const first = new Date(start);
  const weekOffset = ((utc ? first.getUTCDay() : first.getDay()) + 6) % 7; // weeks start Monday (WKST=MO) for INTERVAL>1
  // Local starts step by calendar day so a 09:00 meeting stays at 09:00 across DST; weekday follows the same clock.
  const at = (i: number) => (utc ? start + i * DAY_MS : new Date(first.getFullYear(), first.getMonth(), first.getDate() + i, first.getHours(), first.getMinutes(), first.getSeconds()).getTime());
  // Without COUNT, nothing before the window matters: jump straight to it, so a years-old series still expands.
  let i = count === Infinity ? Math.max(0, Math.floor((from - start) / DAY_MS) - 1) : 0;
  let n = 0;
  for (const end = i + 800; i < end; i++) {
    const t = at(i);
    if (t > until || t > to || n >= count) break;
    const weekday = utc ? new Date(t).getUTCDay() : new Date(t).getDay();
    const ok = p.FREQ === 'DAILY'
      ? i % interval === 0
      : Math.floor((i + weekOffset) / 7) % interval === 0 && (days ? days.includes(weekday) : i % 7 === 0);
    if (!ok) continue;
    n++;
    if (t >= from && !exdates.has(t)) out.push(t);
  }
  return out;
}

// One-off starts, plus every recurring occurrence in [now - 1h, now + 48h].
export function parseIcsStarts(ics: string, now = Date.now()): number[] {
  const out: number[] = [];
  const lines = ics.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  let ev: { dtstart: number | null; utc: boolean; rrule: string | null; exdates: Set<number> } | null = null;
  for (const line of lines) {
    const value = line.slice(line.indexOf(':') + 1).trim();
    if (line === 'BEGIN:VEVENT') ev = { dtstart: null, utc: false, rrule: null, exdates: new Set() };
    else if (line === 'END:VEVENT' && ev) {
      if (ev.dtstart !== null) {
        try {
          out.push(...(ev.rrule ? expand(ev.dtstart, ev.utc, ev.rrule, ev.exdates, now) : [ev.dtstart]));
        } catch {
          out.push(ev.dtstart); // a rule we cannot read: keep the first start, never break the feed
        }
      }
      ev = null;
    } else if (!ev) continue;
    else if (line.startsWith('DTSTART')) { ev.dtstart = parseIcsTime(value); ev.utc = value.endsWith('Z'); }
    else if (line.startsWith('RRULE:')) ev.rrule = value;
    else if (line.startsWith('EXDATE')) for (const v of value.split(',')) { const t = parseIcsTime(v); if (t !== null) ev.exdates.add(t); }
  }
  return out;
}

export function nextMeetingWithin(starts: number[], now: number, windowMs: number, alreadyWarned: Set<number>): number | null {
  const soon = starts.filter((t) => t > now && t - now <= windowMs && !alreadyWarned.has(t)).sort((a, b) => a - b);
  return soon[0] ?? null;
}
