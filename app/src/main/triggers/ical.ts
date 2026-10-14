// Minimal VEVENT DTSTART reader. TZID times are treated as the machine's local time
// (good enough for a 5-minute warning when owner and calendar share a timezone).
// ponytail: recurring events (RRULE) are ignored, so a weekly standup whose first DTSTART is in the past never warns.
// Upgrade path: expand FREQ=DAILY/WEEKLY.
export function parseIcsStarts(ics: string): number[] {
  const out: number[] = [];
  const lines = ics.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  let inEvent = false;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') inEvent = true;
    else if (line === 'END:VEVENT') inEvent = false;
    else if (inEvent && line.startsWith('DTSTART')) {
      const value = line.slice(line.indexOf(':') + 1).trim();
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
      if (!m) continue; // all-day (DATE) or malformed
      const [, y, mo, d, h, mi, s, z] = m;
      const t = z
        ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
        : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
      if (Number.isFinite(t)) out.push(t);
    }
  }
  return out;
}

export function nextMeetingWithin(starts: number[], now: number, windowMs: number, alreadyWarned: Set<number>): number | null {
  const soon = starts.filter((t) => t > now && t - now <= windowMs && !alreadyWarned.has(t)).sort((a, b) => a - b);
  return soon[0] ?? null;
}
