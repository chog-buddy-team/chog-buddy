import { describe, expect, it } from 'vitest';
import { categorize, IDLE_THRESHOLD_SEC } from '../src/categorize';

describe('categorize', () => {
  it.each([
    ['Code', '', 'coding'],
    ['Cursor', '', 'coding'],
    ['Xcode', '', 'coding'],
    ['iTerm2', '', 'coding'],
    ['Figma', '', 'design'],
    ['Slack', '', 'chat'],
    ['Discord', '', 'chat'],
    ['zoom.us', '', 'meeting'],
    ['Google Chrome', '', 'browsing'],
    ['Arc', '', 'browsing'],
    ['Microsoft Edge', '', 'browsing'],
    ['Finder', '', 'other'],
    ['explorer.exe', '', 'other'],
  ])('app %s -> %s', (app, title, expected) => {
    expect(categorize(app, title)).toBe(expected);
  });

  it('title beats app: YouTube in Chrome is video', () => {
    expect(categorize('Google Chrome', 'Lofi beats - YouTube')).toBe('video');
  });

  it('title beats app: Figma in a browser is design', () => {
    expect(categorize('Safari', 'Chog mockups – Figma')).toBe('design');
  });

  it('does not match short names inside words', () => {
    expect(categorize('Code', 'search.ts — chog')).toBe('coding');
    expect(categorize('Notes', 'knowledge base')).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(categorize('SLACK')).toBe('chat');
  });

  it('idle wins over everything', () => {
    expect(categorize('Code', '', IDLE_THRESHOLD_SEC)).toBe('idle');
    expect(categorize('Code', '', IDLE_THRESHOLD_SEC - 1)).toBe('coding');
  });

  it('empty app name is other', () => {
    expect(categorize('')).toBe('other');
  });
});
