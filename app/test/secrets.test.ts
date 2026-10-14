import { describe, expect, it } from 'vitest';
import { seal, unseal, type Cipher } from '../src/main/secrets';

const rot: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from([...s].reverse().join('')),
  decrypt: (b) => [...b.toString()].reverse().join(''),
};

describe('seal/unseal', () => {
  it('round-trips', () => expect(unseal(rot, seal(rot, 'secret'))).toBe('secret'));
  it('returns null when encryption is unavailable', () => expect(seal({ ...rot, available: () => false }, 'x')).toBeNull());
  it('returns null for missing or corrupt input instead of throwing', () => {
    expect(unseal(rot, null)).toBeNull();
    expect(unseal({ ...rot, decrypt: () => { throw new Error('bad'); } }, 'AAAA')).toBeNull();
  });
});
