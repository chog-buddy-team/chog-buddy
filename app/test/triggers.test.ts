import { describe, expect, it, vi } from 'vitest';
import { fetchGithubUnread, githubShouldFire } from '../src/main/triggers/github';
import { nextMeetingWithin, parseIcsStarts } from '../src/main/triggers/ical';

describe('github', () => {
  it('counts unread notifications with a bearer token and a User-Agent', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify([{}, {}, {}]), { status: 200 }));
    expect(await fetchGithubUnread('ghp_x', f)).toBe(3);
    expect(f.mock.calls[0][0]).toBe('https://api.github.com/notifications?per_page=50');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer ghp_x');
    expect(f.mock.calls[0][1].headers['User-Agent']).toBe('chog-buddy');
  });
  it('returns null on any error', async () => {
    expect(await fetchGithubUnread('x', vi.fn().mockResolvedValue(new Response('no', { status: 401 })))).toBeNull();
    expect(await fetchGithubUnread('x', vi.fn().mockRejectedValue(new Error('net')))).toBeNull();
  });
  it('fires only on an increase after the first poll', () => {
    expect(githubShouldFire(null, 4)).toBe(false);
    expect(githubShouldFire(4, 4)).toBe(false);
    expect(githubShouldFire(4, 2)).toBe(false);
    expect(githubShouldFire(2, 5)).toBe(true);
    expect(githubShouldFire(2, null)).toBe(false);
  });
});

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'SUMMARY:Standup', 'DTSTART:20261009T150000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;TZID=Europe/London:20261009T170000', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261010', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:garbage', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ical', () => {
  it('parses UTC and floating/TZID times, skips all-day and garbage', () => {
    const starts = parseIcsStarts(ICS);
    expect(starts).toContain(Date.UTC(2026, 9, 9, 15, 0, 0));
    expect(starts).toHaveLength(2);
  });
  it('never throws on junk', () => {
    expect(parseIcsStarts('not a calendar')).toEqual([]);
  });
  it('warns once per meeting inside the window', () => {
    const start = Date.UTC(2026, 9, 9, 15, 0, 0);
    const warned = new Set<number>();
    expect(nextMeetingWithin([start], start - 10 * 60_000, 5 * 60_000, warned)).toBeNull();
    expect(nextMeetingWithin([start], start - 4 * 60_000, 5 * 60_000, warned)).toBe(start);
    warned.add(start);
    expect(nextMeetingWithin([start], start - 3 * 60_000, 5 * 60_000, warned)).toBeNull();
    expect(nextMeetingWithin([start], start + 60_000, 5 * 60_000, new Set())).toBeNull();
  });
});

const ev = (...lines: string[]) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const now = Date.UTC(2026, 9, 15, 8, 0, 0); // Thu 2026-10-15 08:00Z

describe('ical recurrence', () => {
  it('expands a weekly standup created months ago', () => {
    const s = parseIcsStarts(ev('DTSTART:20260105T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH'), now); // started on a Monday
    expect(s).toContain(Date.UTC(2026, 9, 15, 9, 0, 0)); // Thu today
    expect(s).not.toContain(Date.UTC(2026, 9, 16, 9, 0, 0)); // Friday is not in BYDAY
  });
  it('expands daily with interval', () => {
    const s = parseIcsStarts(ev('DTSTART:20261013T100000Z', 'RRULE:FREQ=DAILY;INTERVAL=2'), now);
    expect(s).toContain(Date.UTC(2026, 9, 15, 10, 0, 0));
    expect(s).not.toContain(Date.UTC(2026, 9, 16, 10, 0, 0));
  });
  it('respects UNTIL, COUNT and EXDATE', () => {
    expect(parseIcsStarts(ev('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY;UNTIL=20261010T000000Z'), now).filter((t) => t > now)).toEqual([]);
    expect(parseIcsStarts(ev('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY;COUNT=3'), now).filter((t) => t > now)).toEqual([]);
    const s = parseIcsStarts(ev('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY', 'EXDATE:20261013T090000Z,20261015T090000Z'), now);
    expect(s).not.toContain(Date.UTC(2026, 9, 15, 9, 0, 0)); // cancelled
    expect(s).toContain(Date.UTC(2026, 9, 16, 9, 0, 0)); // next one still warns
  });
  it('unsupported FREQ keeps just DTSTART and never throws', () => {
    expect(parseIcsStarts(ev('DTSTART:20261020T090000Z', 'RRULE:FREQ=MONTHLY;BYSETPOS=-1'), now)).toEqual([Date.UTC(2026, 9, 20, 9, 0, 0)]);
    expect(() => parseIcsStarts(ev('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY;INTERVAL=0'), now)).not.toThrow();
  });
});

describe('ical recurrence in local time', () => {
  it('keeps a local 09:00 weekly meeting at 09:00 across DST, and expands a years-old series', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const s = parseIcsStarts(ev('DTSTART;TZID=America/New_York:20230105T090000', 'RRULE:FREQ=WEEKLY;BYDAY=TH'), now); // winter, 3+ years ago
      expect(s).toContain(new Date(2026, 9, 15, 9, 0, 0).getTime()); // summer time, still 09:00 local
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });
});

describe('ical recurrence edge cases (review)', () => {
  const ev2 = (...lines: string[]) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const now2 = Date.UTC(2026, 9, 12, 6, 0, 0); // Mon 2026-10-12
  it('fortnightly multi-day weeks align to Monday', () => {
    const s = parseIcsStarts(ev2('DTSTART:20261007T090000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'), now2);
    expect(s).not.toContain(Date.UTC(2026, 9, 12, 9, 0, 0)); // skipped week
  });
  it('garbage UNTIL keeps only DTSTART; garbage BYDAY behaves like none', () => {
    expect(parseIcsStarts(ev2('DTSTART:20261001T090000Z', 'RRULE:FREQ=DAILY;UNTIL=garbage'), now2)).toEqual([Date.UTC(2026, 9, 1, 9, 0, 0)]);
    expect(parseIcsStarts(ev2('DTSTART:20261005T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=XX'), now2)).toContain(Date.UTC(2026, 9, 12, 9, 0, 0));
  });
});
