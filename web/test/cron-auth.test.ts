import { describe, expect, it } from 'vitest';
import { isCronAuthorized } from '@/lib/cron-auth';

describe('isCronAuthorized', () => {
  it('accepts the right secret', () => {
    expect(isCronAuthorized('Bearer s3cret-value', 's3cret-value')).toBe(true);
  });
  it('rejects a wrong or missing header', () => {
    expect(isCronAuthorized('Bearer nope', 's3cret-value')).toBe(false);
    expect(isCronAuthorized(null, 's3cret-value')).toBe(false);
  });
  it('rejects everything when the secret is not configured', () => {
    // `Bearer ${undefined}` must not become a valid password
    expect(isCronAuthorized('Bearer undefined', undefined)).toBe(false);
    expect(isCronAuthorized('Bearer ', '')).toBe(false);
  });
});
