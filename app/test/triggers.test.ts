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
