import { describe, expect, it } from 'vitest';
import { hashToken } from '@/lib/session';

describe('hashToken', () => {
  it('stores a SHA-256 hex digest, never the token itself', () => {
    const token = '3f1c2b7e-0000-4000-8000-123456789abc';
    const h = hashToken(token);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(token);
    expect(hashToken(token)).toBe(h);
  });
});
