import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../src/main/fsutil';

describe('atomicWrite', () => {
  it('round-trips, overwrites and leaves no .tmp', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'fsutil-')), 'a.json');
    atomicWrite(f, 'one');
    atomicWrite(f, 'two');
    expect(readFileSync(f, 'utf8')).toBe('two');
    expect(existsSync(`${f}.tmp`)).toBe(false);
  });
});
